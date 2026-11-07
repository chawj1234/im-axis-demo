import {acceptStudioDecision} from './studio-decision.mjs';

const text = value => typeof value === 'string' && value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Admin-facing view contract, independent of the legacy n8n policy/check schema.
 * This projection does not assert that a completed Job was exported to a collection.
 * Customer notifications must not use its unmasked evidence/reason fields.
 */
export function projectStudioDecision({session, receipt, result}) {
  if (!text(session) || !/^[A-Za-z0-9_-]{8,90}$/.test(session)
    || !object(receipt) || receipt.session_id !== session || !text(receipt.receipt_id)
    || !Object.hasOwn(receipt, 'document_request_id') || !Object.hasOwn(receipt, 'document_contract_id')
    || !(text(receipt.document_request_id) || receipt.document_request_id === null)
    || !(text(receipt.document_contract_id) || receipt.document_contract_id === null)
    || !/^job_[A-Za-z0-9_-]+$/.test(receipt.studio_job_id || '')
    || !/^scol_[A-Za-z0-9_-]+$/.test(receipt.collection_id || '')
    || !text(receipt.received_at) || !Number.isFinite(Date.parse(receipt.received_at))) {
    throw Error('studio_view_receipt_invalid');
  }
  if (!object(result)) throw Error('studio_view_result_missing');
  const accepted = acceptStudioDecision({decision: result.studio_decision, body: result.body,
    expectedRequestId: receipt.document_request_id, expectedContractId: receipt.document_contract_id, partialEvidence: result.partial_evidence === true});
  // Catch stale/tampered projections instead of letting a second grade authority in.
  if (Object.hasOwn(result, 'final_grade') && result.final_grade !== accepted.final_grade) {
    throw Error('studio_view_grade_conflict');
  }
  if (Object.hasOwn(result, 'policy_version') && result.policy_version !== accepted.policy_version) {
    throw Error('studio_view_policy_conflict');
  }
  const body = accepted.body;
  const additionalChecks = [
    ['date_check', '지급 희망일·여신기간'],
    ['outstanding_check', '실행 후 예상 잔액'],
    ['available_check', '실행 후 예상 한도여유'],
  ].map(([key, label]) => {
    const check = object(body[key]) ? body[key] : {};
    return {key, label, status: ['match', 'mismatch'].includes(check.status) ? check.status : 'unknown',
      basis: typeof check.basis === 'string' ? check.basis : ''};
  });
  return {
    receiptId: receipt.receipt_id,
    documentRequestId: body.request_id,
    documentContractId: body.contract_id,
    receivedAt: new Date(receipt.received_at).toISOString(),
    processing: 'completed', // Analysis completed; evaluation may still be incomplete.
    evaluationStatus: accepted.evaluation_status,
    comparisonStatus: accepted.comparison_status,
    grade: accepted.final_grade,
    decisionLabel: accepted.studio_decision,
    reason: body.reason,
    // Basic comparison is an aggregate branch, NOT nine invented item-level checks.
    basicComparison: ['match', 'mismatch'].includes(body.basic_comparison_branch) ? body.basic_comparison_branch : 'unknown',
    additionalChecks,
    policyVersion: accepted.policy_version,
    provenance: {source: 'studio_enum', jobId: receipt.studio_job_id, collectionId: receipt.collection_id,
      collectionStatus: 'unconfirmed', scope: 'tracked_receipt'},
  };
}
