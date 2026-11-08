import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export function assertChain(records: any[]) {
  let previous = '0'.repeat(64);
  records.forEach((record, index) => {
    assert.equal(record.seq, index + 1);
    assert.equal(record.prev_hash, previous);
    const { hash, ...body } = record;
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, sha256(`${previous}\n${canonicalJson(body)}`));
    previous = hash;
  });
}

export function assertDecision(record: any, mandate: any, decision: string) {
  assert.equal(record.decision, decision);
  assert.match(record.record_id, /^evd_/);
  assert.equal(record.mandate.id, mandate.id);
  assert.equal(record.mandate.version, mandate.version);
  assert.equal(record.mandate.signature, mandate.signature.sig);
  assert.deepEqual(record.mandate.limits, mandate.limits);
  assert.equal(new Date(record.timestamp).toISOString(), record.timestamp);
  for (const key of ['budget_before', 'budget_after']) assert.match(record[key], /^\d+\.\d{2}$/);
  assert(Array.isArray(record.options_seen));
  assert(Array.isArray(record.breaches));
  assert.equal(typeof record.rationale, 'string');
  assert.equal(typeof record.user_instruction, 'string');
}
