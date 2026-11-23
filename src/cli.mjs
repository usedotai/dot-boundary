#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { openAICompatible } from './openai.mjs';
import { createGateway } from './gateway.mjs';

async function main() {
  const [command, filename] = process.argv.slice(2);
  if (command !== 'serve' || !filename) {
    process.stdout.write('Usage: dot-boundary serve <config.json>\nSet BOUNDARY_TOKEN to a random access token (24+ characters).\n');
    process.exitCode = command && command !== '--help' ? 1 : 0;
    return;
  }
  const config = JSON.parse(await readFile(filename, 'utf8'));
  const providers = Object.fromEntries(Object.entries(config.providers).map(([name, p]) => {
    if (p.apiKeyEnv && !process.env[p.apiKeyEnv]) throw new Error('credential');
    return [name, openAICompatible({ baseURL: p.baseURL, model: p.model, stream: p.stream ?? false,
      apiKey: p.apiKeyEnv ? () => process.env[p.apiKeyEnv] : undefined })];
  }));
  const server = createGateway({ providers, routes: config.routes, token: process.env.BOUNDARY_TOKEN });
  const port = config.port ?? 8788;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('port');
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Dot Boundary listening on http://127.0.0.1:${port}/v1\n`));
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close();
    setTimeout(() => server.closeAllConnections(), 2000).unref();
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  server.on('error', () => { process.stderr.write('Gateway could not start. Check the configured port.\n'); process.exitCode = 1; });
}
main().catch(() => { process.stderr.write('Configuration rejected. Check provider URLs, model IDs, credential environment variables, routes, and BOUNDARY_TOKEN.\n'); process.exitCode = 1; });
