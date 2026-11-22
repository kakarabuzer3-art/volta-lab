import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence, describeEvidence, illustrativeEvidence, isIsoDate } from './provenance.ts';
import type { EvidenceRecord } from './provenance.ts';

const datasheet: EvidenceRecord = {
  origin: 'manufacturer-datasheet', review: { status: 'unverified' },
  source: { kind: 'manufacturer-datasheet', publisher: 'ExampleCo (test fixture)', title: 'Test datasheet', url: 'https://example.invalid/ds.pdf', page: '3', revision: 'B' },
};
test('a complete datasheet record is valid and is described as published, not verified', () => {
  assert.deepEqual(checkEvidence(datasheet), []);
  assert.equal(describeEvidence(datasheet), 'Manufacturer-published specification · Not reviewed');
});
test('a datasheet record needs https url, page and revision or retrieval date', () => {
  const s = datasheet.source!;
  assert.ok(checkEvidence({ ...datasheet, source: undefined }).length > 0);
  assert.ok(checkEvidence({ ...datasheet, source: { ...s, url: 'http://x.invalid/a.pdf' } }).some((p) => /https/.test(p)));
  assert.ok(checkEvidence({ ...datasheet, source: { ...s, page: undefined } }).some((p) => /page/.test(p)));
  assert.ok(checkEvidence({ ...datasheet, source: { ...s, revision: undefined } }).some((p) => /revision|retrievedOn/.test(p)));
  assert.deepEqual(checkEvidence({ ...datasheet, source: { ...s, revision: undefined, retrievedOn: '2026-01-31' } }), []);
});
test('review status needs a date and enough different named reviewers', () => {
  assert.ok(checkEvidence({ ...datasheet, review: { status: 'source-reviewed' } }).length > 0);
  assert.deepEqual(checkEvidence({ ...datasheet, review: { status: 'source-reviewed', reviewedOn: '2026-02-01', reviewedBy: ['A'] } }), []);
  assert.ok(checkEvidence({ ...datasheet, review: { status: 'cross-checked', reviewedOn: '2026-02-01', reviewedBy: ['A', 'a'] } }).length > 0, 'same person twice is not a cross-check');
  assert.deepEqual(checkEvidence({ ...datasheet, review: { status: 'cross-checked', reviewedOn: '2026-02-01', reviewedBy: ['A', 'B'] } }), []);
});
test('illustrative and engineering-reference evidence', () => {
  assert.deepEqual(checkEvidence(illustrativeEvidence('teaching text')), []);
  assert.ok(checkEvidence({ origin: 'engineering-reference', review: { status: 'unverified' } }).length > 0);
  assert.deepEqual(checkEvidence({ origin: 'engineering-reference', review: { status: 'unverified' }, note: 'textbook relation' }), []);
});
test('ISO dates are strict', () => { assert.ok(isIsoDate('2026-02-28')); for (const d of ['2026-02-30', '2026-2-3', 'x', 5]) assert.equal(isIsoDate(d), false); });
