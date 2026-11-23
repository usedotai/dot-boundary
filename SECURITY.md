# Security contract

## Protected boundary

Boundary enforces destination permissions on calls made through its registered provider and tool adapters. The application owns this runtime; model outputs are untrusted data. A model cannot grant itself a destination, forge a handle or widen a policy through its response text.

The supplied adapter sends data only to its configured endpoint, rejects redirects, bounds response bytes and sanitizes operational errors. Protected values retain source restrictions through local derivation and model completions. Every attempt is gated, including fallback and retry. Tool outputs have an independent declared audience.

## Trusted components

- Application code that labels sources, selects routes, registers adapters and calls `release` or `reveal`.
- Generation parameters and tool schemas are trusted configuration. Put dynamic sensitive content in protected message/tool handles; parameter objects do not acquire provenance automatically.
- Provider and tool implementations. A callback receives plaintext that it is authorized to process; it must implement only the declared destination and honor cancellation.
- The local process, operating system and administrators with access to it.
- Authorized inference endpoints. Boundary controls which endpoint receives data; that endpoint processes plaintext under its own service policy.

Boundary is a programmatic information-flow runtime. It does not sandbox arbitrary JavaScript, intercept all machine traffic, provide encrypted inference, attest hardware, or automatically detect personal information. A callback that reads an undeclared private source or directly calls `fetch` outside Boundary bypasses its policy boundary. Keep untrusted code in a separate OS/container sandbox and route its approved operations through the trusted dispatcher.

## Data lifecycle

Protected contents live in process memory while their handles remain reachable. Gateway sessions do not persist chat history; each request carries its own messages. Memory is reclaimed by the JavaScript runtime, without a secure-erasure guarantee. No telemetry or network logging service is included. Receipts contain event type, sequence, symbolic destination, source count, attempt and sanitized error code. Destination names and approval IDs should contain no personal or secret information.

The gateway is single-owner and local by default. Its bearer token grants access to configured routes and sessions. It is not a tenant authorization server; do not expose it publicly without an authenticated application boundary, TLS, access policy and operational rate limiting. Anyone possessing the token is part of the trusted caller boundary. Browser `Origin` rejection is defense in depth; it does not replace token authentication.

## Release and recovery

`release` explicitly widens permissions under trusted application authority. The approval identifier is an audit reference; Boundary does not authenticate human approval. Revocation prevents future attempts and delivery of in-flight results, but cannot erase data already delivered to a provider.

Retrying a failed transport can repeat provider work. Boundary defaults to zero retries and does not claim exactly-once billing or tool side effects. Buffered SSE prevents partial output publication; it does not cancel charges already incurred upstream. Expired sessions return an error rather than silently removing restrictions.

## Reporting

Use this repository’s private vulnerability reporting channel when enabled: **Security → Report a vulnerability**. Do not include live keys, private prompts or customer data in public issues. A useful report identifies the protected source, configured policy, unauthorized destination and minimal executable path that crossed it.
