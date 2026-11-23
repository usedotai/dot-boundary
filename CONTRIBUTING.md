# Contributing

Use Node.js 22 or newer. Runtime source has no external dependencies; development dependencies cover the official OpenAI client and TypeScript declaration checks.

```sh
npm ci --ignore-scripts
npm run verify
git diff --check
```

For an enforcement change, include a regression test demonstrating the previously unauthorized dispatch and a test preserving authorized behavior. Observe outbound requests when testing transport. Keep fixture servers bounded and close them in teardown.

For a new adapter, maintain the AbortSignal contract, fixed destination identity, bounded responses and sanitized failures. A custom adapter is trusted code. Provider-specific schemas belong in explicit adapters rather than unrestricted parameter passthrough.

For benchmark changes, retain raw results, explain changes in the workload and regenerate figures with `npm run charts`. Distinguish mechanisms from products and controlled execution from model attack success. Do not present repeated runs of the same template as independent security evidence.

Never commit keys, real user content or environment files. Use private vulnerability reporting for security-sensitive findings.
