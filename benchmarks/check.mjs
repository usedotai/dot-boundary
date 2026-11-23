import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const result = JSON.parse(await readFile(new URL('./results/latest.json', import.meta.url), 'utf8'));
const rows = (await readFile(new URL('./results/episodes.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(rows.length, 4500);
assert.equal(result.methodology.episodes, rows.length);
const expected = { direct: [200,100], 'literal-filter': [100,75], 'request-acl': [175,100], 'provenance-entry': [50,75], boundary: [0,75] };
for (const summary of result.summary) {
  assert.deepEqual([summary.forbidden,summary.benignCompleted], expected[summary.strategy]);
  for (let repetition = 0; repetition < 3; repetition++) {
    const subset = rows.filter(r => r.strategy === summary.strategy && r.repetition === repetition);
    assert.equal(subset.length, 300);
    assert.equal(subset.filter(r => r.attack && r.forbidden).length, summary.forbidden);
    assert.equal(subset.filter(r => !r.attack && r.completed).length, summary.benignCompleted);
  }
}
for (const [file, hash] of Object.entries(result.sourceHashes)) {
  const actual = createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex');
  assert.equal(actual, hash, `Recorded benchmark source changed: ${file}`);
}
console.log('Evidence verified: source hashes, 4,500 episodes, repetition consistency and expected outcomes.');
