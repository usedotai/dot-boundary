import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fixture, listen, closeServer } from './helpers.mjs';
import { createServer } from 'node:http';

async function processOutput(args, env = {}) {
  const child = spawn(process.execPath, ['src/cli.mjs', ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  child.stdout.on('data', x => output += x);
  child.stderr.on('data', x => output += x);
  const [code] = await once(child, 'exit');
  return { code, output };
}
test('CLI help and missing credentials exit without exposing environment data', async () => {
  assert.equal((await processOutput(['--help'])).code, 0);
  const invalid = await processOutput(['serve','examples/gateway.json'], { BOUNDARY_TOKEN: 'not-long-enough' });
  assert.equal(invalid.code, 1);
  assert.match(invalid.output, /Configuration rejected/);
  assert.doesNotMatch(invalid.output, /not-long-enough/);
});
test('CLI serves configured real HTTP completion and shuts down normally', async t => {
  const upstream = await fixture(); t.after(() => upstream.close());
  const temp = await mkdtemp(join(tmpdir(), 'boundary-cli-test-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const probe = createServer(); t.after(() => probe.close()); await listen(probe); const port = probe.address().port; await closeServer(probe);
  const config = join(temp, 'config.json');
  await writeFile(config, JSON.stringify({ port, providers: { worker: { baseURL: upstream.url, model: 'actual-http-fixture', apiKeyEnv: 'FIXTURE_KEY' } }, routes: { private: { allow: ['worker'], destinations: ['worker'] } } }));
  const token = 'temporary-cli-test-access-token';
  const child = spawn(process.execPath, ['src/cli.mjs','serve',config], { env: { PATH: process.env.PATH, BOUNDARY_TOKEN: token, FIXTURE_KEY: 'fixture-key' }, stdio: ['ignore','pipe','pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; });
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI startup timeout')), 3000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('exit', code => { clearTimeout(timeout); if (code) reject(new Error('CLI exited')); });
  });
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'private', messages: [{ role: 'user', content: 'test' }] }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).choices[0].message.content, 'A complete answer.');
  assert.equal(upstream.requests[0].headers.authorization, 'Bearer fixture-key');
  child.kill('SIGTERM'); await exited;
});
