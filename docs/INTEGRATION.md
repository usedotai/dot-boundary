# Integration guide

## Gateway configuration

```json
{
  "port": 8788,
  "providers": {
    "primary": { "baseURL": "https://your-primary.example/v1", "model": "your-model", "apiKeyEnv": "PRIMARY_KEY" },
    "backup": { "baseURL": "https://your-backup.example/v1", "model": "your-model", "apiKeyEnv": "BACKUP_KEY" }
  },
  "routes": {
    "primary-only": { "destinations": ["primary", "backup"], "allow": ["primary"], "retries": 0 },
    "approved-failover": { "destinations": ["primary", "backup"], "allow": ["primary", "backup"], "retries": 0 }
  }
}
```

`primary-only` can never dispatch to `backup`, even when the primary fails. `approved-failover` may use either. Choose the route that matches the data’s authorization. A route alias is a server-configured policy; it is not a classifier. Clients holding the gateway token are trusted to select an appropriate alias.

For Dot, use the [ready-to-run configuration](../examples/gateway.json). `apiKeyEnv` is the name of an environment variable, never the credential itself. Omit it for a local endpoint that does not require authentication. Set provider `stream: true` to request upstream SSE; Boundary buffers and validates it before release.

## HTTP interface

All endpoints require `Authorization: Bearer <BOUNDARY_TOKEN>`. Direct browser requests with an `Origin` header are rejected. CLI binding is `127.0.0.1`.

| Method / path | Behavior |
|---|---|
| `GET /v1/models` | List configured route aliases |
| `POST /v1/chat/completions` | Run a protected text/function-call completion |
| `POST /v1/boundary/sessions` | Create an isolated policy session |
| `DELETE /v1/boundary/sessions/:id` | Delete an inactive session |

Supported request fields: `model`, `messages`, `stream`, `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `seed`, `stop`, `presence_penalty`, `frequency_penalty`, `response_format`, `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning_effort`. The configured upstream must support the generation parameters you choose. Unknown fields fail closed rather than being silently forwarded.

Messages support `role`, string/null `content`, `tool_calls`, and `tool_call_id`. Roles: system, developer, user, assistant and tool. Version 0.1 targets text and function calls; image/audio inputs and the Responses API are not part of this contract.

Gateway responses include `x-boundary-attempts`. The response model is the selected alias. Arbitrary upstream metadata is removed by the supplied adapter. Usage contains standard token totals when the provider supplies them. SSE emits the validated answer, a finish chunk and `[DONE]` after upstream completion.

## Sessions

```js
const headers = {
  Authorization: `Bearer ${process.env.BOUNDARY_TOKEN}`,
  'Content-Type': 'application/json',
};
const response = await fetch('http://127.0.0.1:8788/v1/boundary/sessions', {
  method: 'POST', headers, body: '{}',
});
if (!response.ok) throw new Error(`Session creation failed: ${response.status}`);
const session = await response.json();

// With an OpenAI client, pass this header on every request in this workflow.
const result = await client.chat.completions.create({
  model: 'primary-only',
  messages: [{ role: 'user', content: 'Private planning notes…' }],
}, { headers: { 'X-Boundary-Session': session.id } });
```

A later request in the same session cannot expand to a backup-only destination. Stateless requests have no cross-request provenance. Deleting a session or starting a new one is an owner decision, not an automatic recovery step for old sensitive history.

## Controlled tools

Register tools in the SDK and keep the dispatcher in trusted application code:

```js
const boundary = new Boundary({
  providers: { dot: configuredAdapter },
  tools: {
    records: {
      execute: async ({ recordId }, { signal }) => database.read(recordId, { signal }),
      outputAllow: ['dot'],
    },
  },
});
const args = boundary.data({ recordId: 'record-7' }, { allow: ['records', 'dot'] });
const record = await boundary.invoke('records', args);
const prompt = boundary.derive([record], r => `Summarize this record: ${JSON.stringify(r)}`);
```

Validate tool arguments and authorization inside the callback. A callback may acquire new private data; its output permissions must reflect those sources. A plain callback without `outputAllow` returns a private-by-default value.

When a model proposes a function call, derive its arguments from the protected completion instead of parsing an untracked raw string:

The original workflow policy must authorize both the inference destination and the intended tool. The model cannot add the tool to that policy by requesting it.

```js
const args = boundary.derive([completion.value], r =>
  JSON.parse(r.choices[0].message.tool_calls[0].function.arguments));
const result = await boundary.invoke('records', args);
```

For a second model turn, protect the assistant’s function-call metadata too:

```js
const calls = boundary.derive([completion.value], r => r.choices[0].message.tool_calls);
const text = boundary.derive([completion.value], r => r.choices[0].message.content);
const assistantMessage = { role: 'assistant', content: text, toolCalls: calls };
```

The gateway returns function calls but does not execute them. Use the SDK for tool execution and provenance across tool results.

## Release, revocation and receipts

```js
boundary.revoke('backup'); // prevents subsequent dispatch and release from that destination
const approved = boundary.release(summary, {
  allow: ['publish'],
  approvalId: 'owner-approval-7',
});
const receipt = boundary.receipt();
```

Only trusted application code should issue a release after its own authorization workflow. The approval ID is a reference, not proof of a human signature. Keep IDs non-sensitive. A receipt is a bounded local event record, not a signed attestation or a server-side logging system.

## Errors and retries

| Code | Meaning |
|---|---|
| `policy_denied` | Destination not authorized or revoked |
| `invalid_request` / `invalid_handle` | Request contract or ownership rejected |
| `cancelled` | Caller cancellation or total deadline elapsed |
| `transport_error` / `incomplete_response` | Connection or response ended before validation |
| `invalid_response` | Upstream completion failed validation |
| `upstream_NNN` | Upstream HTTP status; its response body is suppressed |
| `session_busy` / `busy` | Concurrency limit; no new provider dispatch |
| `session_expired` | Explicit new session required |
| `body_too_large` / `response_too_large` | Configured byte limit exceeded |

Set SDK client retries to zero when Boundary should own retries. A new client request is a new inference attempt; Boundary does not provide billing idempotency or persist completed answers. Configure only backups that are authorized to receive the data and acceptable under your cost policy.
