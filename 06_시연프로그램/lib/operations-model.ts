import {STUDIO_OPERATIONS_POLICY_VERSION} from './studio-operations-model.mjs';
import {demoApiUrl} from './demo-api.mjs';
import {currentDocumentJobs} from './retry-lineage.mjs';
import type {
  ComparisonStatus, OperationsCheck, OperationsContract, OperationsLog, OperationsMetrics,
  OperationsRequest, OperationsSnapshot, OperationsSource, OperationsValidationFailure, ReviewGrade,
} from './operations-types';

/**
 * A result may use the new policy only when it explicitly identifies this version.
 * Its checks must use the four canonical keys below, with match/mismatch/unknown
 * statuses; contract_limit means requested amount <= TOTAL contract amount.
 * Legacy amount/available-limit checks and legacy final_grade are never promoted.
 * The UI derives the six-grade value from completed checks and the two amounts.
 */
export const OPERATIONS_POLICY_VERSION = 'contract-request-six-grade-v1';
export const EXPANDED_OPERATIONS_POLICY_VERSION = 'contract-request-expanded-grade-v2';

/** Only completed, same-session registrations can receive subsequent requests. */
export function registeredOperationsContracts(value: unknown, session: string): OperationsContract[] {
  const state = record(value);
  const candidates = [...array(state.contracts), ...array(state.jobs).flatMap(value => {
    const job = record(value);
    return job.intake_mode === 'contract_registration' && job.stage === 'completed' ? [record(job.result).contract] : [];
  })];
  const result = new Map<string, OperationsContract>();
  for (const value of candidates) {
    const contract = record(value), id = text(contract.contract_id), amount = won(contract.credit_limit_krw);
    if (contract.session_id !== session || contract.policy_version !== OPERATIONS_POLICY_VERSION || contract.registration_status !== 'completed' || !id || !text(contract.agreement_reference) || !text(contract.company_name) || amount === null || amount <= 0) continue;
    result.set(id, {id, reference: text(contract.agreement_reference), companyName: text(contract.company_name), amount,
      registeredAt: timestamp(contract.registered_at), fileName: text(contract.source_filename), status: 'registered'});
  }
  return [...result.values()].sort((a,b) => b.registeredAt.localeCompare(a.registeredAt));
}

const checkDefinitions = [
  {key: 'contract_reference', label: '계약번호'},
  {key: 'company_name', label: '기업명'},
  {key: 'payout_account', label: '수취계좌'},
  {key: 'contract_limit', label: '총 계약금액 이내 요청'},
] as const;
const expandedCheckDefinitions = [...checkDefinitions,
  {key:'business_identifier',label:'사업자등록번호'}, {key:'payout_bank',label:'수취은행'},
  {key:'payout_holder',label:'수취계좌 예금주'}, {key:'credit_product',label:'여신과목'},
  {key:'declared_credit_limit',label:'요청서 승인한도'}, {key:'credit_period',label:'지급 희망일·여신기간'},
  {key:'outstanding_arithmetic',label:'실행 후 예상 잔액'}, {key:'available_arithmetic',label:'실행 후 예상 한도여유'},
] as const;
const studioCheckDefinitions = [{key:'basic_comparison',label:'기본정보 종합 대조'}, ...expandedCheckDefinitions.filter(({key}) => ['credit_period','outstanding_arithmetic','available_arithmetic'].includes(key))] as const;
const definitionsFor = (policy?: string) => policy === EXPANDED_OPERATIONS_POLICY_VERSION ? expandedCheckDefinitions : checkDefinitions;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
const timestamp = (value: unknown): string => {
  const valueText = text(value);
  const time = valueText ? Date.parse(valueText) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
};
const won = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const display = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('ko-KR') + '원';
  return text(value) || '미확인';
};
const hasValue = (value: unknown): boolean =>
  typeof value === 'string' ? Boolean(text(value)) : typeof value === 'number' && Number.isFinite(value);
const canonicalStatus = (value: unknown): ComparisonStatus =>
  value === 'match' || value === 'mismatch' ? value : 'unknown';
const legacyStatus = (value: unknown): ComparisonStatus =>
  value === 'pass' ? 'match' : value === 'mismatch' ? 'mismatch' : 'unknown';

/** Missing information is never a match. A confirmed mismatch is counted once. */
function completeComparison(request: OperationsRequest): boolean {
  return request.processing === 'completed' && request.grade !== null && (request.policyVersion === STUDIO_OPERATIONS_POLICY_VERSION ? studioCheckDefinitions : definitionsFor(request.policyVersion)).every(({key}) => {
    const checks = request.checks.filter(check => check.key === key);
    return checks.length === 1 && checks[0].status !== 'unknown';
  });
}

export function operationsGrade(
  checks: OperationsCheck[], contractAmount: number | null, requestedAmount: number | null, policyVersion?: string,
): ReviewGrade | null {
  if (contractAmount === null || !Number.isSafeInteger(contractAmount) || contractAmount <= 0
    || requestedAmount === null || !Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) return null;
  const definitions = definitionsFor(policyVersion);
  if (checks.length !== definitions.length || !definitions.every(({key}) => {
    const matches = checks.filter(check => check.key === key);
    return matches.length === 1 && (matches[0].status === 'match' || matches[0].status === 'mismatch');
  })) return null;
  const limitStatus = checks.find(check => check.key === 'contract_limit')!.status;
  if (limitStatus !== (requestedAmount <= contractAmount ? 'match' : 'mismatch')) return null;
  if (!checks.some(check => check.status === 'mismatch')) return 6;
  const ratio = requestedAmount / contractAmount;
  return ratio <= .2 ? 5 : ratio <= .4 ? 4 : ratio <= .6 ? 3 : ratio <= .8 ? 2 : 1;
}

function source(value: unknown, session: string, knownDocuments: Set<string>): OperationsSource | null {
  const item = record(value);
  const name = text(item.filename).slice(0, 180) || text(item.name).slice(0, 180);
  if (!name) return null;
  const id = text(item.document_id);
  const page = typeof item.page === 'number' && Number.isInteger(item.page) && item.page >= 1 && item.page <= 20 ? item.page : undefined;
  return {
    name,
    ...(page ? {page} : {}),
    ...(page && /^[a-f0-9]{64}$/.test(id) && knownDocuments.has(id) && session
      ? {url: demoApiUrl('/api/document?session=' + encodeURIComponent(session) + '&id=' + encodeURIComponent(id) + '&page=' + page)}
      : {}),
  };
}

function sources(values: unknown[], session: string, knownDocuments: Set<string>): OperationsSource[] {
  const result = new Map<string, OperationsSource>();
  for (const value of values) {
    const item = source(value, session, knownDocuments);
    if (item) result.set([item.name, item.url || '', item.page || ''].join('|'), item);
  }
  return [...result.values()];
}

function fileEvidence(filename: unknown, documentId: unknown, evidence: unknown[]): Record<string, unknown> {
  const id = text(documentId);
  // The state API does not expose meta.json's page count. Reuse a real evidence
  // page for this exact document; a bare document hash never invents page 1.
  const existing = evidence.map(record).find(item => item.document_id === id
    && typeof item.page === 'number' && Number.isInteger(item.page) && item.page >= 1 && item.page <= 20);
  return {filename, ...(existing ? {document_id: id, page: existing.page} : {})};
}

const legacyKeys: Partial<Record<OperationsCheck['key'], string>> = {
  contract_reference: 'agreement_reference', company_name: 'company_name', payout_account: 'designated_account_number',
};

function normalizeChecks(result: Record<string, unknown>, isNewPolicy: boolean, session: string, knownDocuments: Set<string>): OperationsCheck[] {
  const values = array(result.checks).map(record);
  return definitionsFor(text(result.policy_version)).map(definition => {
    const sourceKey = isNewPolicy ? definition.key : legacyKeys[definition.key];
    const candidates = sourceKey ? values.filter(check => check.key === sourceKey) : [];
    const check = candidates.length === 1 ? candidates[0] : {};
    const contractValue = isNewPolicy ? check.contract_value : check.reference;
    const requestValue = isNewPolicy ? check.request_value : check.requested;
    const status = hasValue(contractValue) && hasValue(requestValue)
      ? isNewPolicy ? canonicalStatus(check.status) : legacyStatus(check.status) : 'unknown';
    const checkSources = sources([check.reference_source, check.requested_source, ...array(check.sources)], session, knownDocuments);
    return {
      ...definition,
      contractValue: ['contract_limit','declared_credit_limit','outstanding_arithmetic','available_arithmetic'].includes(definition.key) ? display(contractValue) : text(contractValue) || '미확인',
      requestValue: ['contract_limit','declared_credit_limit','outstanding_arithmetic','available_arithmetic'].includes(definition.key) ? display(requestValue) : text(requestValue) || '미확인',
      status,
      // Use owned copy: provider notes may contain raw personal values or an old policy.
      note: !isNewPolicy && definition.key === 'contract_limit'
        ? '기존 잔여 한도 판정은 총 계약금액 기준과 달라 재평가가 필요합니다.'
        : status === 'unknown' ? '대조에 필요한 값을 확인하지 못했습니다.'
        : definition.key === 'credit_period' ? (status === 'match' ? '지급 희망일이 여신기간 안에 있습니다.' : '지급 희망일이 여신기간 밖에 있습니다.')
        : definition.key === 'outstanding_arithmetic' ? '기준값 = 요청서 기실행잔액 + 이번 인출 요청금액. 문서에 적힌 잔액과의 산식 검사이며 거래대장 검증은 아닙니다.'
        : definition.key === 'available_arithmetic' ? '기준값 = 요청서 승인한도 − 요청서 실행 후 예상 잔액. 문서 내부 산식 검사입니다.'
        : definition.key === 'contract_limit'
          ? status === 'match' ? '이번 요청금액이 총 계약금액 이내입니다.' : '이번 요청금액이 총 계약금액을 초과합니다.'
          : status === 'match' ? '계약서와 요청서의 정보가 일치합니다.' : '계약서와 요청서의 정보가 다릅니다.',
      ...(checkSources.length ? {sources: checkSources} : {}),
    };
  });
}

const validationFieldLabels: Record<string, string> = {
  request_id: '요청번호', contract_id: '참조 약정번호', requester_name: '신청인명',
  requester_identifier: '사업자등록번호', destination_bank: '입금 은행', destination_account: '입금 계좌',
  destination_holder: '입금 예금주', requested_amount_krw: '인출 요청금액', requested_at: '신청일',
  requester_address: '신청인 주소', credit_product: '여신과목', fund_purpose: '자금용도',
  credit_limit_krw: '승인한도', outstanding_before_krw: '기실행잔액',
  expected_outstanding_after_krw: '실행 후 예상 잔액', expected_available_after_krw: '실행 후 예상 한도여유',
  desired_payment_date: '지급 희망일',
};

function validationFailures(job: Record<string, unknown>): OperationsValidationFailure[] {
  const validation = record(job.validation);
  if (validation.verdict !== 'red') return [];
  return array(validation.failed_checks).flatMap(value => {
    const check = record(value);
    if (check.passed === true) return [];
    const fields = [...new Set(array(check.fields).map(value => text(record(value).field)))]
      .filter(field => /^[a-z][a-z0-9_]{0,79}$/.test(field))
      .map(field => ({field, label: Object.hasOwn(validationFieldLabels, field) ? validationFieldLabels[field] : field}));
    const name = text(check.name).slice(0, 180);
    if (!name && !fields.length) return [];
    // Never pass through provider reason text: it may embed raw account numbers
    // or other values. This describes extraction validation, not the source PDF.
    const emptyExtract = /=(?:''|""|null|undefined)\s+filled\s*→\s*fail/.test(text(check.reason));
    return [{name: name || '추출값 검증', fields, reason: emptyExtract
      ? '추출값이 비어 있어 검증을 통과하지 못했습니다.'
      : '추출값이 검증 조건을 통과하지 못했습니다.'}];
  });
}

const stageLabels: Record<string, string> = {
  received: '서류 접수', uploading: 'Studio 문서 전달', uploaded: 'Studio 문서 전달 완료',
  analyzing: '문서 분석', queued: '분석 대기', in_progress: '문서 분석',
  completed: '문서 대조 처리 완료', failed: '자동 처리 실패', ended: '자동 확인 종료',
};
const piiTypeLabels: Record<string, string> = {
  account_number: '계좌번호', bank_account: '계좌번호', phone_number: '전화번호',
  email: '이메일', name: '성명', address: '주소', resident_registration_number: '주민등록번호',
  business_registration_number: '사업자등록번호',
};

function safeLogs(job: Record<string, unknown>, result: Record<string, unknown>, receivedAt: string, newPolicy: boolean): OperationsLog[] {
  const logs: OperationsLog[] = [];
  for (const eventValue of array(job.timeline)) {
    const event = record(eventValue), label = stageLabels[text(event.stage)];
    if (label) logs.push({at: timestamp(event.at), label});
  }
  if (!logs.length && receivedAt) logs.push({at: receivedAt, label: '서류 접수'});
  for (const attemptValue of array(job.attempts)) {
    const attempt = record(attemptValue);
    if (typeof attempt.number === 'number' && Number.isInteger(attempt.number) && attempt.number >= 1 && attempt.number <= 2) {
      logs.push({at: timestamp(attempt.completed_at || attempt.created_at), label: attempt.number === 1 ? 'AI 추출 시도' : 'AI 추출 재시도 1회'});
    }
  }
  for (const [index, value] of array(job.documents).entries()) {
    const document = record(value);
    const label = document.kind === 'contract' ? '계약서' : document.kind === 'request' ? '실행 요청서' : '접수 문서 ' + (index + 1);
    const phases: Record<string, string> = {creating: '분석 요청', polling: '결과 조회', completed: '추출 완료', failed: '추출 실패', rejected: '요청 거절', unconfirmed: '응답 미확인'};
    for (const attemptValue of array(document.attempts)) {
      const attempt = record(attemptValue);
      if (attempt.number !== 1 && attempt.number !== 2) continue;
      logs.push({at: timestamp(attempt.completed_at || attempt.requested_at || attempt.created_at),
        label: attempt.number === 1 ? 'AI 추출 시도' : 'AI 추출 재시도 1회',
        detail: label + (phases[text(attempt.phase)] ? ' · ' + phases[text(attempt.phase)] : '')});
    }
    const audit = record(document.pii_audit);
    if (audit.detection_available === true && audit.source === 'extracted_fields' && audit.scope === 'known_extract_fields') {
      const types = [...new Set(array(audit.types).map(type => piiTypeLabels[text(type)]).filter(Boolean))];
      logs.push({at: timestamp(job.updated_at), label: '개인정보 유형 기록',
        detail: label + ' · 추출 필드 범위 · ' + (types.length ? types.join(', ') : '감지된 유형 없음')});
    }
  }
  const pii = record(result.pii_detection);
  if (typeof pii.detected === 'boolean') {
    const types = [...new Set(array(pii.types).map(type => piiTypeLabels[text(type)]).filter(Boolean))];
    logs.push({at: timestamp(pii.detected_at) || timestamp(job.updated_at), label: '개인정보 감지 기록',
      detail: pii.detected ? '감지됨' + (types.length ? ' · ' + types.join(', ') : '') : '감지된 항목 없음'});
  }
  if (job.stage === 'completed' && Object.keys(result).length > 0 && !newPolicy) logs.push({
    at: timestamp(job.updated_at), label: '새 등급 기준 미적용',
    detail: '등급 미산정 · 이전 판정 기준. 기존 결과는 참고용이며 현재 문서 대조 등급 기준을 적용하지 않습니다.',
  });
  if (job.stage === 'failed' || job.stage === 'ended') logs.push({
    at: timestamp(job.updated_at), label: '담당자 확인 필요', detail: job.error === 'studio_validation_red' || record(job.validation).verdict === 'red' ? '등급 미산정 · 추출값 확인 필요. 원문과 추출값을 확인해 주세요.' : '등급 미산정 · 처리 실패. 처리 이력에서 오류를 확인해 주세요.',
  });
  return logs;
}

function originalRetryReceiptId(job: Record<string, unknown>, jobs: Map<string, Record<string, unknown>>, currentIds: Set<unknown>): string {
  const originalId = text(job.id), seen = new Set<string>();
  let current = job;
  while (text(current.retry_source_id)) {
    const id = text(current.id), source = jobs.get(text(current.retry_source_id));
    if (seen.has(id) || !source || currentIds.has(source.id)
      || currentDocumentJobs([source, current]).some(value => value.id === source.id)) return originalId;
    seen.add(id); current = source;
  }
  return text(current.id) || originalId;
}

function notificationState(notices: unknown[], id: string, receiptId = id): OperationsRequest['customerNotification'] {
  const result: NonNullable<OperationsRequest['customerNotification']> = {};
  for (const value of notices) {
    const notice = record(value);
    if (notice.job_id !== id) continue;
    const createdAt = timestamp(notice.created_at);
    if (notice.kind === 'receipt' && createdAt) result.receiptAt = createdAt;
    if ((notice.kind === 'warning' || notice.kind === 'late_warning') && createdAt) result.mismatchAt = createdAt;
    if (notice.kind !== 'receipt' && notice.kind !== 'warning' && notice.kind !== 'late_warning') continue;
    const displayedAt = timestamp(typeof notice.displayed_at === 'string' ? notice.displayed_at : record(notice.displayed_at).customer);
    if (displayedAt) result.displayedAt = displayedAt;
  }
  // A retry does not create another receipt notice. Only the root receipt may
  // fill that gap; warnings from an earlier failed analysis are never inherited.
  if (!result.receiptAt && receiptId !== id) for (const value of notices) {
    const notice = record(value);
    if (notice.job_id !== receiptId || notice.kind !== 'receipt') continue;
    const createdAt = timestamp(notice.created_at);
    if (createdAt) result.receiptAt = createdAt;
    const displayedAt = timestamp(typeof notice.displayed_at === 'string' ? notice.displayed_at : record(notice.displayed_at).customer);
    if (!result.displayedAt && displayedAt) result.displayedAt = displayedAt;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Pure read-only adapter. Contracts never become request records or request metrics. */
export function normalizeOperationsState(input: unknown, session: string): OperationsSnapshot {
  const state = record(input), jobs = new Map<string, Record<string, unknown>>();
  for (const value of array(state.jobs)) {
    const job = record(value), id = text(job.id);
    if (!id || (job.session_id !== undefined && job.session_id !== session)) continue;
    const previous = jobs.get(id);
    if (!previous || timestamp(job.updated_at || job.created_at) >= timestamp(previous.updated_at || previous.created_at)) jobs.set(id, job);
  }
  const contracts = array(state.contracts).map(record).filter(contract => contract.session_id === undefined || contract.session_id === session);
  const knownDocuments = new Set([...jobs.values()].flatMap(job => [
    ...(job.intake_mode === 'paired' ? [] : [text(job.document_id)]),
    ...array(job.documents).map(value => text(record(value).document_id)),
  ]).filter(Boolean));
  const notices = array(state.notifications);
  const currentJobIds = new Set(currentDocumentJobs([...jobs.values()]).map(job => job.id));
  const receipts: OperationsSnapshot['receipts'] = [];
  const requests: OperationsRequest[] = [];
  let updatedAt = timestamp(state.updated_at);
  for (const [id, job] of jobs) {
    const receivedAt = timestamp(job.created_at), result = record(job.result);
    const companyName = text(result.company_name) || text(record(result.contract).company_name);
    const fileNames = [...new Set([text(job.filename), ...array(job.filenames).map(text),
      ...array(job.documents).map(value => text(record(value).filename)),
    ].filter(Boolean))];
    // Backend analysis failures do not retroactively turn an accepted receipt into a failed receipt.
    const originalReceiptId = originalRetryReceiptId(job, jobs, currentJobIds);
    const retryReceipt = originalReceiptId !== id ? {originalReceiptId} : {};
    const receiptFailed = job.receipt_status === 'failed';
    const routing=record(job.document_routing);
    const hasRouting=['contract_registration','registered_request'].includes(text(job.intake_mode))&&['contract','request'].includes(text(routing.detected_kind));
    const documentStatus=hasRouting?(text(routing.continued_as)?'continued':'routing'):job.stage==='completed'?'completed':['failed','ended'].includes(text(job.stage))?'needs_attention':'checking';
    const outcome: OperationsSnapshot['receipts'][number]['outcome'] = ['failed','ended'].includes(text(job.stage)) ? (record(job.validation).verdict === 'red' || job.error === 'studio_validation_red' ? 'extraction_failed' : 'technical_error') : job.stage === 'completed' && job.kind === 'request' && result.evaluation_status === 'completed' ? 'compared' : job.stage === 'completed' && job.kind === 'contract' && contracts.some(c=>c.contract_id===job.contract_id && !!job.contract_id) ? 'registered' : undefined;
    receipts.push({...retryReceipt, documentStatus, ...(outcome?{outcome}:{}), ...(hasRouting?{routing:{detectedKind:routing.detected_kind as 'contract'|'request',message:routing.detected_kind==='request'?'실행 요청서로 확인됐습니다. 계약을 선택해 요청 접수를 이어가세요.':'계약서로 확인됐습니다. 계약 등록으로 이어가세요.',canContinue:routing.can_continue===true,...(text(routing.continued_as)?{continuedAs:text(routing.continued_as)}:{})}}:{}), id, receivedAt, fileNames, ...(companyName ? {companyName} : {}), ...(job.intake_mode === 'contract_registration' || job.intake_mode === 'registered_request' ? {kind: job.kind as 'contract' | 'request', contractReference: text(record(job.contract_snapshot).agreement_reference) || text(record(result.contract).agreement_reference)} : {}), status: receiptFailed ? 'failed' : 'received',
      ...(receiptFailed ? {error: '서류 접수를 완료하지 못했습니다.'} : {})});
    const changedAt = timestamp(job.updated_at) || receivedAt;
    if (changedAt > updatedAt) updatedAt = changedAt;
    if (job.kind !== 'request' || !currentJobIds.has(id)) continue;
    const contract = contracts.find(item => item.contract_id === job.contract_id) || record(job.contract_snapshot || result.contract);
    const contractAmount = won(result.contract_amount_krw) ?? won(result.credit_limit_krw) ?? won(contract.credit_limit_krw);
    const policyContractAmount = won(result.contract_amount_krw);
    const requestedAmount = won(result.requested_amount_krw);
    const isNewPolicy = result.policy_version === OPERATIONS_POLICY_VERSION || result.policy_version === EXPANDED_OPERATIONS_POLICY_VERSION;
    const processing = job.stage === 'failed' || job.stage === 'ended' ? 'failed'
      : job.stage === 'completed' ? Object.keys(result).length ? 'completed' : 'unknown' : 'processing';
    const checks = processing === 'failed' || processing === 'processing' ? [] : normalizeChecks(result, isNewPolicy, session, knownDocuments);
    const failedValidation = processing === 'failed' ? validationFailures(job) : [];
    const eligible = isNewPolicy && processing === 'completed' && result.evaluation_status === 'completed';
    // Even explicit policy records must prove contract-limit semantics with the two amounts.
    if (isNewPolicy && checks.length) {
      const limitCheck = checks.find(check => check.key === 'contract_limit')!;
      const expectedStatus = policyContractAmount !== null && policyContractAmount > 0 && requestedAmount !== null && requestedAmount > 0
        ? requestedAmount <= policyContractAmount ? 'match' : 'mismatch' : 'unknown';
      if (limitCheck.status !== expectedStatus) limitCheck.status = 'unknown';
    }
    const evidence = array(result.checks).flatMap(value => {
      const check = record(value);
      return [check.reference_source, check.requested_source, ...array(check.sources)];
    });
    const files = sources([
      ...(array(job.documents).length ? [] : [fileEvidence(job.filename, job.document_id, evidence), ...array(job.files)]),
      ...array(job.documents).map(value => {
        const document = record(value);
        const original = fileEvidence(document.filename, document.document_id, evidence);
        // The intake parser verified a real page count. This is a document
        // opener only; comparison evidence still requires an actual source page.
        return original.page ? original : {
          ...original,
          ...(['paired', 'registered_request', 'contract_registration'].includes(text(job.intake_mode)) && typeof document.pages === 'number'
            && Number.isInteger(document.pages) && document.pages >= 1 && document.pages <= 20
            ? {document_id: document.document_id, page: 1} : {}),
        };
      }),
      {...fileEvidence(contract.source_filename, contract.source_document_id, evidence),
        ...(job.intake_mode === 'registered_request' && typeof contract.source_pages === 'number'
          && Number.isInteger(contract.source_pages) && contract.source_pages >= 1 && contract.source_pages <= 20
          ? {document_id: contract.source_document_id, page: 1} : {})},
    ], session, knownDocuments);
    const logs = safeLogs(job, result, receivedAt, isNewPolicy);
    for (const value of array(state.staff_notifications)) {
      const notice = record(value);
      if (notice.job_id !== id || notice.audience !== 'staff' || notice.kind !== 'extraction_failure') continue;
      logs.push({at: timestamp(notice.created_at), label: '담당자 알림 등록',
        detail: '자동 추출 결과 확인 필요' + (notice.retry_count === 1 ? ' · 재시도 1회 후' : '')});
    }
    if (originalReceiptId !== id) logs.push({at: receivedAt, label: '원문 재분석 요청', detail: '원접수번호 ' + originalReceiptId + ' · 분석번호 ' + id});
    const grade = eligible ? operationsGrade(checks, policyContractAmount, requestedAmount, text(result.policy_version)) : null;
    const gradeReason: OperationsRequest['gradeReason'] = grade !== null || processing === 'processing' ? undefined
      : processing === 'failed' ? job.error === 'studio_validation_red' || record(job.validation).verdict === 'red' ? '추출값 확인 필요' : '처리 실패'
      : !Object.keys(result).length ? '대조 결과 없음'
      : !isNewPolicy ? '이전 판정 기준' : '판정 근거 확인 필요';
    requests.push({
      id, ...retryReceipt, contractId: text(job.contract_id) || undefined, receiptId: text(job.receipt_id) || id, receivedAt,
      companyName: companyName || text(contract.company_name) || '기업명 미확인',
      contractReference: text(result.agreement_reference) || text(contract.agreement_reference) || '계약번호 미확인',
      contractAmount, requestedAmount,
      ratio: contractAmount !== null && contractAmount > 0 && requestedAmount !== null && requestedAmount > 0 ? requestedAmount / contractAmount * 100 : null,
      grade, ...(gradeReason ? {gradeReason} : {}),
      processing, checks, ...(processing === 'failed' && record(job.validation).verdict === 'red' ? {extractedFields: [...new Set(array(record(job.validation).checks).filter(value => record(value).passed === true).flatMap(value => array(record(value).fields).map(value => text(record(value).field))).map(field => validationFieldLabels[field] || field).filter(Boolean))]} : {}), ...(failedValidation.length ? {validationFailures: failedValidation} : {}), files, logs, policyVersion: text(result.policy_version),
      ...(processing === 'completed' && isNewPolicy && array(result.review_checks).length ? {purposeReview: {key:'fund_purpose' as const,label:'자금용도 검토',contractValue:text(record(array(result.review_checks)[0]).contract_value)||'미확인',requestValue:text(record(array(result.review_checks)[0]).request_value)||'미확인',status:record(array(result.review_checks)[0]).status==='match'?'match' as const:'unknown' as const,note:'표기가 다르거나 값이 없으면 담당자가 허용 범위를 확인해야 합니다. 이 항목은 등급에 반영하지 않습니다.'}} : {}),
      customerNotification: notificationState(notices, id, originalRetryReceiptId(job, jobs, currentJobIds)),
    });
  }
  receipts.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  requests.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return {receipts, requests, updatedAt: updatedAt || null};
}

/** mismatchRate uses compared requests as its denominator; pending/failed are excluded. */
export function operationsMetrics(requests: OperationsRequest[]): OperationsMetrics {
  const unique = [...new Map(requests.map(request => [request.id, request])).values()];
  const compared = unique.filter(completeComparison);
  const hasStudio = unique.some(request => request.policyVersion === STUDIO_OPERATIONS_POLICY_VERSION);
  const hasLegacy = unique.some(request => request.policyVersion !== STUDIO_OPERATIONS_POLICY_VERSION);
  const fieldDefinitions = hasStudio && !hasLegacy ? studioCheckDefinitions
    : [...expandedCheckDefinitions, ...(hasStudio ? [studioCheckDefinitions[0]] : [])];
  const mismatches = compared.filter(request => request.policyVersion === STUDIO_OPERATIONS_POLICY_VERSION ? request.grade !== 6 : request.checks.some(check => check.status === 'mismatch'));
  return {
    totalRequests: unique.length,
    comparedRequests: compared.length,
    mismatchRequests: mismatches.length,
    mismatchRate: compared.length ? mismatches.length / compared.length * 100 : null,
    unevaluatedRequests: unique.filter(request => request.grade === null || request.processing !== 'completed').length,
    gradeCounts: [...([1, 2, 3, 4, 5, 6] as const).map(grade => ({grade, count: unique.filter(request => request.processing === 'completed' && request.grade === grade).length})),
      {grade: null, count: unique.filter(request => request.grade === null || request.processing !== 'completed').length}],
    mismatchFields: fieldDefinitions.map(({key, label}) => ({key, label,
      count: mismatches.filter(request => request.checks.some(check => check.key === key && check.status === 'mismatch')).length,
    })),
  };
}
