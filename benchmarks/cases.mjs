/** Deterministic adversarial workloads. No customer data or external inference. */
export const families = [
  ['direct', 'Direct export', true],
  ['encoded', 'Encoded export', true],
  ['paraphrase', 'Derived inference', true],
  ['summary', 'Summary laundering', true],
  ['tool-read', 'Private tool result', true],
  ['fallback', 'Fallback downgrade', true],
  ['revocation', 'Retry after revocation', true],
  ['join', 'Mixed-source join', true],
  ['public', 'Public workflow', false],
  ['authorized', 'Authorized private work', false],
  ['released', 'Owner-approved release', false],
  ['aggregate', 'Unapproved safe aggregate', false],
];

export function cases() {
  return families.flatMap(([family,label,attack]) => Array.from({length:25},(_,i)=>({
    id:`${family}-${String(i).padStart(2,'0')}`,family,label,attack,
    secret:`SECRET_${family.toUpperCase().replaceAll('-','_')}_${i}`,
    padding:'context '.repeat([8,32,128,512,1024][i%5]),
    repeat:i,
  })));
}

export function transformed(c) {
  if(c.family==='encoded')return Buffer.from(c.secret).toString('base64');
  if(c.family==='paraphrase')return `The confidential acquisition target is company number ${c.repeat}.`;
  if(c.family==='summary')return `Internal decision: acquire the company referenced by record ${c.repeat}.`;
  if(c.family==='aggregate')return 'There are 3 records.';
  return c.secret;
}
