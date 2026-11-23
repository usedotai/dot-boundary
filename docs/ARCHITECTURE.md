# Architecture

Boundary implements destination-based, dynamic information-flow control in a trusted application runtime. Its unit of authority is a protected value handle, not a string classification score.

## Permission algebra

Let `A(v)` be the allowed destination set for value `v`.

```text
A(data)                = explicit policy; default ∅
A(derive(v₁, …, vₙ))   = A(v₁) ∩ … ∩ A(vₙ)
A(model(messages))     = intersection of all content and tool-call handles
A(tool(args))          = A(args) ∩ tool.outputAllow
A(restrict(v, policy)) = A(v) ∩ policy
```

`['*']` is the universal audience; `[]` permits no dispatch. Identifiers resolve to adapters registered at construction. Wildcard policy does not create destinations.

Dispatch to destination `d` is allowed only when `d ∈ A(v)` and `d` is not revoked. That check runs before every attempt and again before publishing a result. `release` is the sole explicit policy-widening operation. It requires an application-owned approval identifier and emits a release event.

The runtime tracks source UUIDs across derivations. A tool read adds a new source, because public arguments can retrieve private contents. A single protected result can retain at most 4,096 source identifiers.

## Value ownership

Handles are frozen objects backed by a private `WeakMap`. Copying a handle ID does not copy its authority. Content is JSON-snapshotted and frozen on entry. Serialization of a handle yields a protected-value marker, not the content. Different Boundary instances reject each other’s handles.

`derive` receives immutable snapshots and returns a synchronously derived protected value. The application must supply every relevant source handle. `reveal` deliberately returns an owner-accessible copy: use it for local UI or another explicitly trusted destination, not to bypass controlled dispatch.

## Dispatch and recovery

1. Validate messages and configured route IDs.
2. Join content and tool-call provenance.
3. Snapshot the outbound messages and permitted generation parameters.
4. Check the destination immediately before each attempt.
5. Call the adapter with a fresh snapshot and a shared deadline signal.
6. Validate the completed response and recheck destination permission.
7. Wrap the result with inherited provenance and return it.

Only retryable failures advance to another attempt or fallback. Retries default to zero. Retryable transport codes are connection failures, incomplete/invalid completions and HTTP 408, 429, 500, 502, 503 or 504. Authentication and invalid-request failures stop immediately. Route order never overrides policy.

The deadline spans the entire call, including all routes. An abort stops further dispatch; adapter callbacks are expected to honor its signal. An already delivered HTTP request or external tool side effect cannot be recalled.

## Atomic output

The upstream adapter accepts JSON and SSE. SSE is decoded with strict UTF-8, bounded in bytes, reassembled and validated for a completion terminator and finish reason. No partial completion is exposed before validation. Function-call fragments are joined by index.

The gateway can emit standard Chat Completions SSE, but does so after the completed result validates. This intentionally trades live token delivery for atomic response recovery. It does not promise exactly-once provider billing: a disconnected upstream request may already have consumed inference.

## Policy sessions

The local gateway binds to loopback through the CLI and authenticates a single owner. A session stores its current audience intersection, expiry, busy state and bounded metadata receipt. It does not store a durable chat transcript. The caller supplies messages on each request.

Session permissions narrow monotonically when route aliases change. One active request per session avoids concurrent widening races. Expired or missing sessions fail with HTTP 410. A new session must be created explicitly; callers must not automatically move old sensitive history into it.

## Operational bounds

| Bound | Default / maximum |
|---|---|
| Protected JSON value | 2,000,000 UTF-8 bytes |
| Messages per completion | 256 |
| Routes per call | 16 |
| Retries per route | 0 / 3 |
| Call deadline | 60 seconds / 600 seconds |
| Receipt buffer | 1,000 / 100,000 events |
| Upstream response bytes | 2,000,000 default |
| Gateway request bytes | 1,000,000 default |
| Gateway concurrency | 8 default |
| Sessions | 100 default; 30-minute fixed expiry |

Transport URLs are configuration-owned, HTTPS-only except exact loopback HTTP hosts. Redirects fail instead of forwarding bearer credentials. Receipts contain symbolic destination IDs and counts, not URLs or response bodies. Generation output necessarily remains visible to the authorized inference provider and the application owner.
