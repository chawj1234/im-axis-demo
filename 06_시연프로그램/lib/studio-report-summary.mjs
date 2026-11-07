import {acceptStudioDecision} from './studio-decision.mjs';

const statuses = ['completed', 'incomplete', 'processing', 'failed', 'uncertain'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.trim().length > 0;
const reference = value => value === null || identifier(value);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};

function timestamp(value) {
  // Require an explicit offset: a machine's local timezone must never change a report.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw Error('studio_report_timestamp_invalid');
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw Error('studio_report_timestamp_invalid');
  return Date.parse(value);
}

/** Pure summary of a verified snapshot, using the occurrence time supplied by its source.
 * Terminal results are revalidated against original document IDs. Null IDs are
 * allowed only where the existing incomplete-decision codec explicitly accepts them.
 */
export function summarizeStudioReport({reportDate, cutoff, provenance, receipts} = {}) {
  if (typeof reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw Error('studio_report_date_invalid');
  const start = timestamp(`${reportDate}T00:00:00+09:00`);
  const end = start + 24 * 60 * 60 * 1000;
  const cutoffTime = timestamp(cutoff);
  if (cutoffTime < start || cutoffTime > end) throw Error('studio_report_cutoff_outside_day');
  if (!object(provenance) || provenance.source !== 'studio_accepted_results'
    || provenance.scope !== 'tracked_receipts') throw Error('studio_report_provenance_required');
  if (!Array.isArray(receipts)) throw Error('studio_report_receipts_required');

  const unique = new Map();
  for (const receipt of receipts) {
    if (!object(receipt) || !identifier(receipt.receiptId) || !reference(receipt.requestId)
      || !reference(receipt.contractId) || !statuses.includes(receipt.status)) throw Error('studio_report_receipt_invalid');
    const occurred = timestamp(receipt.occurredAt);
    let accepted;
    if (['completed', 'incomplete'].includes(receipt.status)) {
      if (!object(receipt.result)) throw Error('studio_report_result_required');
      accepted = acceptStudioDecision({decision: receipt.result.studio_decision, body: receipt.result.body,
        expectedRequestId: receipt.requestId, expectedContractId: receipt.contractId, partialEvidence: receipt.result.partial_evidence === true});
      if (Object.hasOwn(receipt.result, 'final_grade') && receipt.result.final_grade !== accepted.final_grade) {
        throw Error('studio_report_grade_conflict');
      }
      if (Object.hasOwn(receipt.result, 'policy_version') && receipt.result.policy_version !== accepted.policy_version) {
        throw Error('studio_report_policy_conflict');
      }
      if (accepted.evaluation_status !== receipt.status) throw Error('studio_report_status_inconsistent');
    } else if (receipt.result !== undefined && receipt.result !== null) {
      throw Error('studio_report_unfinished_result');
    }
    const fingerprint = JSON.stringify(canonical({requestId: receipt.requestId, contractId: receipt.contractId,
      occurred, status: receipt.status, result: accepted ?? null}));
    const prior = unique.get(receipt.receiptId);
    if (prior && prior.fingerprint !== fingerprint) throw Error('studio_report_duplicate_conflict');
    unique.set(receipt.receiptId, {fingerprint, occurred, status: receipt.status, accepted});
  }

  const counts = {total: 0, completed: 0, incomplete: 0, processing: 0, failed: 0, uncertain: 0, match: 0, mismatch: 0};
  const gradeCounts = Object.fromEntries([1, 2, 3, 4, 5, 6].map(grade => [grade, 0]));
  let excludedCount = 0;
  for (const receipt of unique.values()) {
    if (receipt.occurred < start || receipt.occurred >= end || receipt.occurred > cutoffTime) {
      excludedCount++;
      continue;
    }
    counts.total++;
    counts[receipt.status]++;
    if (receipt.status === 'completed') {
      gradeCounts[receipt.accepted.final_grade]++;
      counts[receipt.accepted.comparison_status]++;
    }
  }
  // Deliberately project an allowlist; never return IDs, names, accounts or reasons.
  return {reportDate, cutoff: new Date(cutoffTime).toISOString(), timeZone: 'Asia/Seoul',
    provenance: {source: 'studio_accepted_results', scope: provenance.scope}, counts, gradeCounts, excludedCount};
}
