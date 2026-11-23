import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const file = name => new URL(name, import.meta.url);
const json = async name => JSON.parse(await readFile(file(name), 'utf8'));
const hash = async name => createHash('sha256').update(await readFile(file(name))).digest('hex');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n % 2 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
for (const [name, expected] of Object.entries(await json('RUNNER_HASHES.json'))) {
  assert.equal(await hash(name), expected, name);
}
const result = await json('results/comparison.json');
for (const [name, expected] of Object.entries(result.source_hashes)) {
  if (name.startsWith('boundary/')) assert.equal(await hash('../../' + name.slice(9)), expected, name);
}
const cases = await json('shared-cases.json');
assert.equal(cases.length, 4096);
const replay = [];
const runs = {};
for (const engine of ['camel', 'boundary']) {
  const correctness = await json(`results/${engine}-correctness.json`);
  assert.equal(correctness.decisions, 16384);
  assert.deepEqual(correctness.rows, cases.map(c => ({
    id: c.id, allow: c.expectedAllow, value: c.expectedValue, decisions: c.expectedDecisions,
  })));
  replay.push(await json(`results/replay-${engine}.json`));
  runs[engine] = await Promise.all(Array.from({ length: 5 }, (_, i) => json(`results/${engine}-timing-${i}.json`)));
  runs[engine].forEach((r, i) => { assert.equal(r.engine, engine); assert.equal(r.repetition, i); });
}
assert.deepEqual(replay[0].rows, replay[1].rows);
for (const r of replay) {
  assert.equal(r.rows.length, 19);
  assert.equal(r.rows.filter(x => x.allowed).length, 15);
  assert.equal(r.allowed, 15); assert.equal(r.blocked, 4);
}
assert.deepEqual(result.summary.map(r => r.depth), [0, 1, 8, 32, 128, 256]);
for (const row of result.summary) {
  for (const measure of ['build_us', 'query_us', 'build_20_queries_us']) {
    const processMedians = {};
    for (const engine of ['camel', 'boundary']) {
      processMedians[engine] = runs[engine].map(r => {
        const samples = r.rows.find(x => x.depth === row.depth)[measure];
        assert.equal(samples.length, 30);
        assert.ok(samples.every(x => Number.isFinite(x) && x > 0));
        return median(samples);
      });
      near(row[measure][engine], median(processMedians[engine]));
      processMedians[engine].forEach((x, i) => near(row[measure].per_process_medians[engine][i], x));
    }
    const ratios = processMedians.camel.map((x, i) => x / processMedians.boundary[i]);
    near(row[measure].paired_speedup_median, median(ratios));
    near(row[measure].paired_speedup_range[0], Math.min(...ratios));
    near(row[measure].paired_speedup_range[1], Math.max(...ratios));
  }
}
console.log('Reference evidence verified: runner/runtime hashes, oracle decisions, trace replay and all timing aggregates.');

const footprint = await json('results/footprint.json');
for (const row of footprint.rows) {
  assert.equal(Object.keys(row.manifest).length, row.source_files);
  assert.equal(Object.values(row.manifest).reduce((n, f) => n + f.bytes, 0), row.source_bytes);
  assert.equal(row.dependency_declarations.length, row.direct_runtime_dependencies);
  if (row.name === 'Dot Boundary') {
    for (const [name, expected] of Object.entries(row.manifest)) {
      const bytes = await readFile(file('../../' + name));
      assert.equal(bytes.length, expected.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
    }
    assert.equal(Object.keys((await json('../../package.json')).dependencies ?? {}).length, row.direct_runtime_dependencies);
  }
}
console.log('Footprint manifests and Boundary source sizes verified.');
