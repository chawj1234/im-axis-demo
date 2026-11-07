import {expandedChecks,EXPANDED_POLICY_VERSION} from './expanded-checks.mjs';
/** Agreed demo comparison policy. No balance, sensitivity or PII risk scoring. */
export const FEEDBACK_POLICY_VERSION = 'contract-request-six-grade-v1';
export function evaluateFeedbackPair(contract, request) {
  const text = value => {const v=typeof value === 'string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';return /^(?:-1|n\/?a|null|none|unknown|미확인|없음|해당\s*없음|[-—–]+)$/i.test(v)?'':v;};
  const account = value => text(value).replace(/[\s-]/g, '');
  const amount = value => Number.isSafeInteger(value) && value > 0 ? value : null;
  const limit = amount(contract.credit_limit_krw), requested = amount(request.requested_amount_krw);
  const compare = (key, a, b, normalizer = text) => {
    const x = normalizer(a), y = normalizer(b);
    return {key, contract_value:a ?? null, request_value:b ?? null, status:!x || !y ? 'unknown' : x === y ? 'match' : 'mismatch'};
  };
  const checks = [
    compare('contract_reference', contract.agreement_reference, request.agreement_reference),
    compare('company_name', contract.company_name, request.company_name),
    compare('payout_account', contract.designated_account_number, request.receiving_account_number, account),
    {key:'contract_limit', contract_value:limit, request_value:requested, status:limit === null || requested === null ? 'unknown' : requested <= limit ? 'match' : 'mismatch'},
  ];
  const expanded=Object.hasOwn(contract,'borrower_name')||Object.hasOwn(request,'requester_name');
  const extra=expanded?expandedChecks(contract,request):null;
  if(extra)checks.push(...extra.checks);
  const complete = checks.every(check => check.status !== 'unknown');
  const mismatch = checks.some(check => check.status === 'mismatch');
  const ratio = limit && requested ? requested / limit : null;
  const grade = !complete ? null : !mismatch ? 6 : ratio <= .2 ? 5 : ratio <= .4 ? 4 : ratio <= .6 ? 3 : ratio <= .8 ? 2 : 1;
  return {policy_version:expanded?EXPANDED_POLICY_VERSION:FEEDBACK_POLICY_VERSION,...(extra?{review_checks:extra.review_checks}:{}), evaluation_status:complete ? 'completed' : 'incomplete',
    company_name:text(request.company_name) || text(contract.company_name), agreement_reference:text(contract.agreement_reference),
    contract_amount_krw:limit, requested_amount_krw:requested, requested_ratio:ratio, final_grade:grade,
    warning_required:complete && mismatch, checks};
}

/** Allowlisted PII type audit only. Values/confidence/sensitivity never enter logs. */
export function feedbackPiiAudit(extracted) {
  const allowed = new Set(['resident_registration_number','business_registration_number','account_number','phone_number','email','address','name']);
  const supplied = Array.isArray(extracted?.pii_types) ? extracted.pii_types : [];
  const present = value => typeof value === 'string' && value.trim() && !/^(?:-1|n\/?a|null|none|unknown|미확인|없음|해당\s*없음|[-—–]+)$/i.test(value.trim());
  const types = supplied.filter(type => allowed.has(type));
  if (present(extracted?.business_registration_number)||present(extracted?.requester_identifier)||present(extracted?.borrower_identifier)) types.push('business_registration_number');
  if (['designated_account_number','receiving_account_number','destination_account','deposit_account','collateral_account','repayment_account'].some(key => present(extracted?.[key]))) types.push('account_number');
  if (['designated_account_holder','receiving_account_holder','destination_holder','requester_name','account_holder','borrower_name','authorized_signer_name','collateral_provider','guarantor_name','repayment_holder'].some(key => present(extracted?.[key]))) types.push('name');
  if (present(extracted?.requester_address)) types.push('address');
  return {event:'pii_detection', types:[...new Set(types)], source:'extracted_fields', scope:'known_extract_fields', detection_available:true};
}

/** Verify the actual Classify value, not merely the presence of a Classify step. */
export function feedbackClassifiedKind(stages) {
  const labels = [];
  for (const stage of stages || []) {
    if (!/classify/i.test(stage.name || '') || stage.status !== 'completed') continue;
    for (const content of stage.contents || []) {
      const label = (typeof content.value === 'string' ? content.value : typeof content.text === 'string' ? content.text : '').trim().replace(/^"|"$/g, '').toLowerCase();
      if (label === '계약서' || label === 'contract') labels.push('contract');
      else if (label === '요청서' || label === 'request') labels.push('request');
    }
  }
  const kinds = [...new Set(labels)];
  if (kinds.length !== 1) throw Error('classify_result_unconfirmed');
  return kinds[0];
}
