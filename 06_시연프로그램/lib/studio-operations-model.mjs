import {demoApiUrl} from './demo-api.mjs';

export const STUDIO_OPERATIONS_POLICY_VERSION = 'studio-enum-comparison-v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
const timestamp = value => Number.isFinite(Date.parse(text(value))) ? new Date(value).toISOString() : '';
const won = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const status = value => ['match','mismatch'].includes(value) ? value : 'unknown';
const safeUrl = value => {
  try {const url = new URL(value); return url.origin === 'https://studio.upstage.ai' && /^\/agents\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname) && !url.username && !url.password ? url.href : null;} catch {return null;}
};
const definitions = [
  ['date_check','credit_period','지급 희망일·여신기간'],
  ['outstanding_check','outstanding_arithmetic','실행 후 예상 잔액'],
  ['available_check','available_arithmetic','실행 후 예상 한도여유'],
];
const basicDefinitions = [
  ['약정번호 일치','contract_reference'], ['입금계좌 일치','payout_account'],
  ['요청금액 한도 이하','contract_limit'], ['사업자번호 일치','business_identifier'],
  ['입금은행 일치','payout_bank'], ['여신과목 일치','credit_product'],
  ['승인한도 일치','declared_credit_limit'], ['신청인명 일치','company_name'], ['입금예금주 일치','payout_holder'],
];
const comparisonValue = value => typeof value === 'string' ? text(value) || '미확인'
  : typeof value === 'number' && Number.isFinite(value) ? String(value) : '미확인';
const processingLabels = {received:'접수 완료 · 처리 대기',uploading:'문서 전송 중',creating:'분석 연결 중',queued:'분석 대기',in_progress:'분석 중',failed:'처리 실패 · 담당자 확인 필요',uncertain:'접수 연결 확인 필요 · 자동 재실행 안 함'};

/** Adapts verified Studio results and session-scoped processing records. */
/** @returns {import('./operations-types').OperationsSnapshot} */
export function normalizeStudioOperationsState(input, session) {
  const state = record(input);
  if (!/^[a-zA-Z0-9_-]{8,90}$/.test(session) || state.provider !== 'studio' || state.session_id !== session || !Array.isArray(state.jobs)
    || !['latest','pinned'].includes(state.configuration_mode)) throw Error('state_invalid');
  const jobs = new Map();
  for (const value of state.jobs) {
    const job = record(value);
    if (!text(job.id) || !['contract','request'].includes(job.kind) || typeof job.filename !== 'string' || typeof job.document_id !== 'string'
      || !['received','uploading','creating','queued','in_progress','completed','failed','uncertain'].includes(job.processing_status)
      || (Object.hasOwn(job,'session_id') && job.session_id !== session)) throw Error('state_invalid');
    const previous = jobs.get(job.id);
    if (!previous || timestamp(job.updated_at) >= timestamp(previous.updated_at)) jobs.set(job.id,job);
  }
  const receipts = [], requests = [];
  let updatedAt = '';
  for (const job of jobs.values()) {
    const receivedAt = timestamp(job.received_at), updated = timestamp(job.updated_at);
    if (updated > updatedAt) updatedAt = updated;
    const routing = job.document_routing_required === true;
    const completed = job.processing_status === 'completed';
    const contractRejected = completed && job.kind === 'contract' && job.contract_validation === 'red';
    const stored = !contractRejected && job.collection_status === 'stored';
    let grade = completed && !routing && job.evaluation_status === 'completed' && Number.isInteger(job.grade) && job.grade >= 1 && job.grade <= 6 ? job.grade : null;
    const fields = record(job.request_fields), contract = record(job.matched_contract);
    const stateLabel = processingLabels[job.processing_status] || (routing ? '문서 종류 확인 필요 · 대조 대상 아님'
      : job.kind === 'contract' ? (contractRejected ? '필수 정보 확인 필요 · 등록 안 됨' : stored ? '등록 완료' : '분석 완료 · 저장 미확인') : job.evaluation_status === 'incomplete' ? '미평가 · 정보 확인 필요'
      : grade !== null ? `대조 완료 · ${grade}등급` : stored ? '처리 완료 · 저장 확인' : '처리 완료 · 저장 미확인');
    receipts.push({id:job.id,receivedAt,fileNames:[job.filename],kind:job.kind,status:job.processing_status === 'failed' ? 'failed' : 'received',
      stateLabel,documentStatus:routing ? 'routing' : contractRejected ? 'needs_attention' : completed ? 'completed' : ['failed','uncertain'].includes(job.processing_status) ? 'needs_attention' : 'checking',
      ...(routing ? {routing:{detectedKind:job.kind === 'request' ? 'contract' : 'request',message:'문서 종류를 확인해 올바른 경로로 새로 접수해 주세요.',canContinue:false}} : {}),
      ...(job.processing_status === 'failed' ? {error:'문서 자동 처리를 완료하지 못했습니다.'} : {})});
    if (job.kind !== 'request' || routing) continue;
    const checks = [];
    if (completed) {
      if (['match','mismatch','unknown'].includes(job.basic_comparison)) checks.push({key:'basic_comparison',label:'기본정보 종합 대조',contractValue:'미확인',requestValue:'미확인',status:status(job.basic_comparison),note:text(job.reason) || undefined});
      for (const [sourceKey,key,label] of definitions) {
        const candidates = (Array.isArray(job.checks) ? job.checks : []).filter(check => record(check).key === sourceKey);
        if (candidates.length !== 1) continue;
        const check = candidates[0];
        checks.push({key,label,contractValue:'미확인',requestValue:'미확인',status:status(check.status),note:text(check.basis) || undefined});
      }
    }
    // The enum remains the authority; evidence can only invalidate, never re-grade it.
    const completeEvidence = checks.length === 4 && checks.every(check => check.status !== 'unknown');
    const hasMismatch = checks.some(check => check.status === 'mismatch');
    if (grade !== null && (text(job.decision_label) !== `${grade}등급` || (!completeEvidence && job.partial_evidence !== true)
      || (grade === 6 ? hasMismatch : completeEvidence && !hasMismatch))) grade = null;
    if (completed && grade === null && job.evaluation_status === 'completed' && state.role !== 'banker') receipts[receipts.length - 1].stateLabel = '결과 확인 필요';
    const processing = completed ? 'completed' : job.processing_status === 'failed' ? 'failed' : job.processing_status === 'uncertain' ? 'unknown' : 'processing';
    const files = [{name:job.filename,...(text(job.document_id) ? {page:1,url:demoApiUrl('/api/studio/document?session=' + encodeURIComponent(session) + '&id=' + encodeURIComponent(job.document_id))} : {})}];
    const logs = receivedAt ? [{at:receivedAt,label:'서류 접수'}] : [];
    if (updated) logs.push({at:updated,label:stored ? 'Studio 분석 완료 확인' : receipts[receipts.length - 1].stateLabel});
    // Details supplement the aggregate evidence; they never calculate a new grade.
    const validation = state.role === 'banker' ? {} : record(job.validation);
    const basic = record(validation.basic), inputValidation = record(validation.input);
    if (completed && Array.isArray(basic.checks)) {
      for (const [label,key] of basicDefinitions) {
        const candidates = basic.checks.filter(check => record(check).name === label);
        if (candidates.length !== 1 || typeof candidates[0].passed !== 'boolean') continue;
        const detail = candidates[0], condition = record(detail.conditions);
        checks.push({key,label,requestValue:comparisonValue(record(condition.left).value),
          contractValue:comparisonValue(record(condition.right).value),status:detail.passed ? 'match' : 'mismatch',note:text(detail.reason) || undefined});
      }
    }
    const validationFailures = completed && inputValidation.verdict === 'red' && Array.isArray(inputValidation.checks)
      ? inputValidation.checks.filter(check => record(check).passed === false && text(check.name)).map(check => ({
        name: job.input_evidence_recovered && check.name === '예상 잔액 비음수·범위' ? '실행 후 예상 잔액' : text(check.name),
        fields:[],reason:job.input_evidence_recovered ? '문서의 해당 항목과 입력 검증 결과를 확인해 주세요.' : text(check.reason) || 'Studio 검증 결과를 확인해 주세요.',
      })) : [];
    const purpose = state.role === 'banker' ? '' : text(job.purpose_review);
    requests.push({id:job.id,receiptId:stored ? text(job.document_request_id) || job.id : job.id,...(text(job.document_contract_id) ? {contractId:text(job.document_contract_id)} : {}),receivedAt,companyName:text(fields.requester_name) || job.filename,
      contractReference:text(job.document_contract_id) || text(fields.contract_id) || '미확인',contractAmount:won(contract.credit_limit_krw),requestedAmount:won(fields.requested_amount_krw),
      ratio:typeof job.requested_ratio === 'number' && Number.isFinite(job.requested_ratio) && job.requested_ratio >= 0 && Number.isFinite(job.requested_ratio * 100) ? job.requested_ratio * 100 : null,
      grade,processing,checks,files,logs,
      ...(validationFailures.length ? {validationFailures} : {}),
      ...(purpose ? {purposeReview:{key:'fund_purpose',label:'자금용도 별도 검토',contractValue:'미확인',requestValue:'미확인',status:'unknown',note:purpose}} : {}),
      policyVersion:STUDIO_OPERATIONS_POLICY_VERSION,
      ...(grade === null && processing !== 'processing' ? {gradeReason:processing === 'failed' ? '처리 실패' : job.evaluation_status === 'incomplete' ? '추출값 확인 필요' : '대조 결과 없음'} : {}),
      studio:{decision:completed ? text(job.decision_label) || null : null,reason:completed ? text(job.reason) || null : null,jobId:text(job.studio_job_id) || null,url:safeUrl(job.studio_url),collectionStatus:stored ? 'stored' : 'unconfirmed',configurationMode:['latest','pinned'].includes(job.configuration_mode) ? job.configuration_mode : state.configuration_mode,resolvedConfigId:text(job.resolved_config_id) || null}});
  }
  receipts.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
  requests.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
  return {contracts:[],receipts,requests,updatedAt:updatedAt || null,...(state.collection_scope === true ? {collectionScope:true} : {})};
}
