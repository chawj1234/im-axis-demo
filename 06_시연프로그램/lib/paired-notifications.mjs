import {customerContractReference} from './document-lifecycle.mjs';
// Customer projection deliberately excludes document contents and technical states.
const mismatchMessage = '계약서와 요청서의 정보가 일치하지 않는 항목이 있습니다. 담당자에게 확인해 주세요.';

export function pairedReceiptNotices(job) {
  return ['contract', 'request'].map(kind => ({
    id: job.id + ':receipt:' + kind, job_id: job.id, kind: 'receipt',
    document_kind: kind, audience: 'customer', created_at: job.created_at,
    message: kind === 'contract' ? '계약서가 접수되었습니다.' : '실행 요청서가 접수되었습니다.',
    // Describes what was submitted, not an AI classification or approval.
    metadata: {receipt_basis: 'submitted_document_pair'}, displayed_at: {},
  }));
}

function pairedWarning(result) {
  if (!['contract-request-six-grade-v1','contract-request-expanded-grade-v2'].includes(result?.policy_version)
    || result.evaluation_status !== 'completed'
    || !Array.isArray(result.checks)
    || !result.checks.some(check => check.status === 'mismatch')) return null;
  return {warning_required: true, message: mismatchMessage};
}

/** A paired receipt has two customer activities; internal progress stays private. */
export function pairedCustomerActivities(job) {
  if (job?.intake_mode !== 'paired' || typeof job.id !== 'string') return [];
  const warning = pairedWarning(job.result);
  const reference = customerContractReference(job);
  return ['contract', 'request'].map(kind => ({
    id: job.id + ':' + kind, contract_id: job.contract_id, ...(reference?{contract_reference:reference}:{}), kind, created_at: job.created_at,
    // Receipt acceptance is complete even when background analysis/storage fails.
    stage: 'received',
    result: kind === 'request' ? warning : null,
  }));
}

/** Staff failures remain separate from customer receipts and customer warnings. */
export function staffAlertProjection(values) {
  if (!Array.isArray(values)) return [];
  const alerts = new Map();
  for (const value of values) {
    if (!value || value.audience !== 'staff' || value.kind !== 'extraction_failure'
      || typeof value.id !== 'string' || !value.id.trim()
      || typeof value.job_id !== 'string' || !value.job_id.trim()) continue;
    const at = typeof value.created_at === 'string' ? Date.parse(value.created_at) : NaN;
    alerts.set(value.id, {
      id:value.id, job_id:value.job_id, created_at:Number.isFinite(at)?new Date(at).toISOString():'',
      message:'문서 자동 확인을 완료하지 못했습니다. 해당 접수를 확인해 주세요.',
      retry_count:value.retry_count === 1 ? 1 : 0,
    });
  }
  return [...alerts.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at));
}
