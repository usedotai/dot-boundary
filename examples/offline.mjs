import { Boundary, BoundaryError } from '../src/index.mjs';

const boundary = new Boundary({
  providers: {
    local: { async complete() { throw new BoundaryError('upstream_503', 'Unavailable.', { retryable: true }); } },
    cloud: { async complete() { throw new Error('This destination must never receive the private document.'); } },
  },
  tools: { publish: async value => value },
});
const document = boundary.data('Internal acquisition plan: Project Cedar.', { allow: ['local'] });
const summary = boundary.derive([document], text => ({ summary: text.split(':')[0] }));
try { await boundary.invoke('publish', summary); } catch (e) {
  if (e.code !== 'policy_denied') throw e;
  console.log('PASS: derived summary cannot escape through a publishing tool.');
}
try { await boundary.complete({ messages: [{ role: 'user', content: document }], routes: ['local', 'cloud'] }); } catch (e) {
  if (e.code !== 'policy_denied') throw e;
  console.log('PASS: local provider failure does not authorize cloud fallback.');
}
console.log(JSON.stringify(boundary.receipt(), null, 2));
