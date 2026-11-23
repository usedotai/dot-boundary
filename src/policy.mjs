import { invalid } from './errors.mjs';

export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(value)) throw invalid();
  return value;
}

export function audience(value) {
  if (!Array.isArray(value) || value.length > 128) throw invalid();
  const out = [...new Set(value.map(x => x === '*' ? x : identifier(x)))].sort();
  if (out.includes('*') && out.length !== 1) throw invalid();
  return out;
}

export function intersect(a, b) {
  if (a.includes('*')) return [...b];
  if (b.includes('*')) return [...a];
  return a.filter(x => b.includes(x));
}

export function permitted(allow, destination) {
  return allow.includes('*') || allow.includes(destination);
}

export function snapshot(value, maxBytes = 2_000_000) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw invalid(); }
  if (encoded === undefined || Buffer.byteLength(encoded) > maxBytes) throw invalid();
  return JSON.parse(encoded);
}

export function frozen(value) {
  if (value && typeof value === 'object') {
    for (const x of Object.values(value)) frozen(x);
    Object.freeze(value);
  }
  return value;
}
