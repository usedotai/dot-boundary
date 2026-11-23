import test from 'node:test';
import assert from 'node:assert/strict';
import { Boundary, BoundaryError } from '../src/index.mjs';
for (const code of ['transport_error', 'upstream_503', 'PRIVATE_CUSTOM_ERROR']) {
  test(`adapter exceptions cannot leak contents via error code or message: ${code}`, async () => {
    const b = new Boundary({ providers: { worker: { complete: async () => { throw new BoundaryError(code, 'PRIVATE_PAYLOAD'); } } } });
    await assert.rejects(b.complete({ messages: [{ role: 'user', content: b.data('hello', { allow: ['worker'] }) }], routes: ['worker'] }), e => !/PRIVATE/.test(e.message + e.code));
    assert.doesNotMatch(JSON.stringify(b.receipt()), /PRIVATE/);
  });
}
