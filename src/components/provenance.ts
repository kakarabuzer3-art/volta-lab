// -----------------------------------------------------------------------------
// Catalogue provenance. This module answers two questions about a CATALOGUE FACT, and keeps them apart:
//
//   1. EVIDENCE ORIGIN: where does the fact come from?   (EvidenceOrigin + SourceRef)
//   2. VERIFICATION STATUS: how thoroughly has that evidence been reviewed?   (ReviewRecord)
//
// A third, different idea lives in the simulator and is NOT modelled here: the origin of a number typed into a simulation
// (`DataSource` in src/sim/loads.ts: 'user-specified' | 'illustrative-fixture'). It is unchanged and unrelated to these types.
//
// A manufacturer datasheet is a manufacturer-PUBLISHED specification. Nothing in this model says it was physically tested or independently
// verified; the review status only records whether a person has read the cited source and whether a second person cross-checked it.
//
// No imports (no simulator, no UI, no three.js).
// -----------------------------------------------------------------------------

export type EvidenceOrigin =
  | 'manufacturer-datasheet'   // published by the manufacturer of one specific product
  | 'published-standard'       // a published standard or specification document
  | 'engineering-reference'    // a general engineering reference or textbook relationship
  | 'illustrative-educational' // written or chosen for teaching in Volta Lab; not a claim about a real product
  | 'user-provided';           // supplied by the person using the app

export type VerificationStatus =
  | 'unverified'               // nobody has reviewed the evidence against its source
  | 'source-reviewed'          // one named person has read the cited source and compared it with the record
  | 'cross-checked';           // two different named people have each done that independently

export type SourceKind = 'manufacturer-datasheet' | 'standard' | 'reference-book' | 'web-page' | 'other';

export interface SourceRef {
  readonly kind: SourceKind;
  /** The manufacturer (for a datasheet) or the publishing body (for a standard). */
  readonly publisher: string;
  readonly title: string;
  readonly url?: string;
  readonly partNumber?: string;
  readonly revision?: string;
  readonly page?: string;
  /** ISO date (YYYY-MM-DD) the source was read. */
  readonly retrievedOn?: string;
  /** ISO date (YYYY-MM-DD) the source says it was published, when known. */
  readonly publishedOn?: string;
}

export interface ReviewRecord {
  readonly status: VerificationStatus;
  /** ISO date (YYYY-MM-DD) of the review. Required for 'source-reviewed' and 'cross-checked'. */
  readonly reviewedOn?: string;
  /** Named reviewers: at least one for 'source-reviewed', at least two different people for 'cross-checked'. */
  readonly reviewedBy?: readonly string[];
  readonly note?: string;
}

export interface EvidenceRecord {
  readonly origin: EvidenceOrigin;
  readonly source?: SourceRef;
  readonly review: ReviewRecord;
  /** Free-text explanation, required when an engineering reference names no source. */
  readonly note?: string;
}

export const EVIDENCE_ORIGINS: readonly EvidenceOrigin[] = ['manufacturer-datasheet', 'published-standard', 'engineering-reference', 'illustrative-educational', 'user-provided'];
export const VERIFICATION_STATUSES: readonly VerificationStatus[] = ['unverified', 'source-reviewed', 'cross-checked'];
export const SOURCE_KINDS: readonly SourceKind[] = ['manufacturer-datasheet', 'standard', 'reference-book', 'web-page', 'other'];

export const ORIGIN_LABEL: Readonly<Record<EvidenceOrigin, string>> = {
  'manufacturer-datasheet': 'Manufacturer-published specification',
  'published-standard': 'Published standard',
  'engineering-reference': 'General engineering reference',
  'illustrative-educational': 'Illustrative educational content',
  'user-provided': 'User-provided',
};
export const VERIFICATION_LABEL: Readonly<Record<VerificationStatus, string>> = {
  'unverified': 'Not reviewed',
  'source-reviewed': 'Source reviewed',
  'cross-checked': 'Independently cross-checked',
};
/** One honest line for a future UI, for example “Manufacturer-published specification · Not reviewed”. */
export function describeEvidence(e: EvidenceRecord): string { return `${ORIGIN_LABEL[e.origin]} · ${VERIFICATION_LABEL[e.review.status]}`; }

/** Educational content written for Volta Lab and not yet reviewed against a cited source. */
export function illustrativeEvidence(note: string): EvidenceRecord {
  return { origin: 'illustrative-educational', review: { status: 'unverified' }, note };
}

export function isIsoDate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const blank = (s: unknown): boolean => typeof s !== 'string' || s.trim() === '';

export function checkSourceRef(s: SourceRef): string[] {
  const p: string[] = [];
  if (!SOURCE_KINDS.includes(s.kind)) p.push(`source.kind '${String(s.kind)}' is not valid`);
  if (blank(s.publisher)) p.push('source.publisher is required');
  if (blank(s.title)) p.push('source.title is required');
  if (s.url !== undefined && !/^https?:\/\/\S+$/.test(s.url)) p.push('source.url must be an http(s) URL');
  if (s.retrievedOn !== undefined && !isIsoDate(s.retrievedOn)) p.push('source.retrievedOn must be an ISO date (YYYY-MM-DD)');
  if (s.publishedOn !== undefined && !isIsoDate(s.publishedOn)) p.push('source.publishedOn must be an ISO date (YYYY-MM-DD)');
  for (const k of ['partNumber', 'revision', 'page'] as const) if (s[k] !== undefined && blank(s[k])) p.push(`source.${k} must not be blank when present`);
  return p;
}

/** Integrity of an evidence record. Returns problems (empty = valid). */
export function checkEvidence(e: EvidenceRecord): string[] {
  const p: string[] = [];
  if (!EVIDENCE_ORIGINS.includes(e.origin)) p.push(`origin '${String(e.origin)}' is not valid`);
  if (e.source) p.push(...checkSourceRef(e.source));
  if (e.note !== undefined && blank(e.note)) p.push('note must not be blank when present');

  switch (e.origin) {
    case 'manufacturer-datasheet': {
      // A manufacturer-published specification must be traceable to one official, dated, located document.
      const s = e.source;
      if (!s) { p.push('a manufacturer-published specification needs a source reference'); break; }
      if (s.kind !== 'manufacturer-datasheet') p.push("source.kind must be 'manufacturer-datasheet'");
      if (!s.url || !/^https:\/\//.test(s.url)) p.push('source.url (an https link to the official datasheet) is required');
      if (blank(s.page)) p.push('source.page is required so the value can be located');
      if (blank(s.revision) && blank(s.retrievedOn)) p.push('source.revision or source.retrievedOn is required');
      break;
    }
    case 'published-standard':
      if (!e.source) p.push('a published-standard record needs a source reference');
      else if (e.source.kind !== 'standard') p.push("source.kind must be 'standard'");
      break;
    case 'engineering-reference':
      if (!e.source && blank(e.note)) p.push('an engineering-reference record needs a source or an explanatory note');
      break;
    default: break;
  }

  const r = e.review;
  if (!r || !VERIFICATION_STATUSES.includes(r.status)) { p.push(`review.status '${String(r?.status)}' is not valid`); return p; }
  if (r.reviewedOn !== undefined && !isIsoDate(r.reviewedOn)) p.push('review.reviewedOn must be an ISO date (YYYY-MM-DD)');
  const people = (r.reviewedBy ?? []).map((x) => (typeof x === 'string' ? x.trim() : ''));
  if (people.some((x) => x === '')) p.push('review.reviewedBy must not contain blank names');
  if (r.status !== 'unverified') {
    if (!isIsoDate(r.reviewedOn)) p.push(`review.reviewedOn (an ISO date) is required for '${r.status}'`);
    const distinct = new Set(people.filter((x) => x !== '').map((x) => x.toLowerCase()));
    const needed = r.status === 'cross-checked' ? 2 : 1;
    if (distinct.size < needed) p.push(`review.reviewedBy needs ${needed} different named reviewer${needed > 1 ? 's' : ''} for '${r.status}'`);
  }
  return p;
}
