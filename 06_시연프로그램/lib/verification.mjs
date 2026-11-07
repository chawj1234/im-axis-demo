// Shared pure rules: executed inside n8n and tested locally against the demo cases.
export function rules() {
  const clean = v => typeof v === 'string' ? v.trim() : '';
  const number = v => {
    if (typeof v === 'string' && /^\d[\d,]*$/.test(v)) v = Number(v.replaceAll(',', ''));
    return Number.isSafeInteger(v) && v >= 0 ? v : null;
  };
  const date = v => {
    const s = clean(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s ? s : null;
  };
  const company = v => clean(v).normalize('NFKC').replace(/주식회사|\(주\)|㈜|\s/g, '').toLowerCase();
  const digits = v => /^[\d\s-]+$/.test(clean(v)) ? clean(v).replace(/[\s-]/g, '') : '';
  const bank = v => clean(v).replace(/\s/g, '').toLowerCase().replace('아이엠뱅크', 'im뱅크');
  const source = (ctx, field) => {
    const evidence=ctx.evidence?.[field];
    return { type: 'document', filename: ctx.filename, document_id: ctx.document_id, studio_job_id: ctx.studio_job_id || null, field,
      page:Number.isInteger(evidence?.page)&&evidence.page>=1?evidence.page:null,
      coordinates:Array.isArray(evidence?.coordinates)?evidence.coordinates:null,
      evidence_status:evidence?'provider_returned':'not_provided' };
  };
  function register(raw, ctx) {
    const required = ['agreement_reference', 'company_name', 'business_registration_number', 'designated_bank_name', 'designated_account_number', 'designated_account_holder'];
    const missing = required.filter(k => !clean(raw[k]));
    const limit = number(raw.credit_limit_krw), balance = number(ctx.initial_balance_krw);
    const start = date(raw.execution_start_date), end = date(raw.execution_end_date);
    if (missing.length || !digits(raw.business_registration_number) || !digits(raw.designated_account_number) || !start || !end || start > end || limit === null || limit === 0 || balance === null || balance > limit || raw.currency !== 'KRW') {
      throw new Error('계약의 기업·계좌·한도·기간·통화 또는 초기 잔액을 확인해 주세요. 누락: ' + (missing.join(', ') || '없음'));
    }
    const provenance = Object.fromEntries(Object.keys(raw).map(k => [k, source(ctx, k)]));
    return {
      contract: { contract_id: ctx.contract_id, session_id: ctx.session_id, ...Object.fromEntries(required.map(k => [k, clean(raw[k])])), credit_limit_krw: limit, execution_start_date: start, execution_end_date: end, allowed_funds_purpose: clean(raw.allowed_funds_purpose), source_filename: ctx.filename, source_document_id: ctx.document_id, payload_json: JSON.stringify({ extracted: raw, provenance, contract_id_source: 'system', registered_at: new Date().toISOString() }) },
      ledger: { contract_id: ctx.contract_id, session_id: ctx.session_id, current_loan_balance_krw: balance, balance_as_of: ctx.balance_as_of, source: '모의 거래대장 · 등록 화면에서 입력한 초기 잔액' }
    };
  }
  function verify(raw, contract, ledger, ctx) {
    const checks = [];
    const add = (key, label, status, reference, requested, note, refSource, reqField) => checks.push({ key, label, status, reference, requested, note, reference_source: refSource, requested_source: source(ctx, reqField) });
    let contractProvenance={};try {contractProvenance=JSON.parse(contract?.payload_json||'{}').provenance||{};}catch{}
    const ref = field => contractProvenance[field] || ({ type: 'document', filename: contract?.source_filename || null, document_id: contract?.source_document_id || null, field,page:null,coordinates:null,evidence_status:'not_provided' });
    const cmp = (key, label, field, expected, normalize = clean) => {
      const actual = clean(raw[field]);
      const a = normalize(actual), b = normalize(expected);
      add(key, label, !a || !b ? 'missing' : a === b ? 'pass' : 'mismatch', expected || null, actual || null, !a ? '요청 문서에서 값을 확인할 수 없습니다.' : a === b ? '기준정보와 일치합니다.' : '기준정보와 다릅니다.', ref(key), field);
    };
    if (!contract?.contract_id || contract.contract_id !== ctx.contract_id || ledger?.contract_id !== ctx.contract_id || contract.session_id !== ctx.session_id || ledger.session_id !== ctx.session_id) throw new Error('선택한 계약 또는 모의 거래대장을 찾지 못했습니다. 계약 등록을 먼저 완료해 주세요.');
    cmp('agreement_reference', '약정 참조번호', 'agreement_reference', contract.agreement_reference);
    cmp('company_name', '기업명', 'company_name', contract.company_name, company);
    cmp('business_registration_number', '사업자등록번호', 'business_registration_number', contract.business_registration_number, digits);
    cmp('designated_bank_name', '지급 은행', 'receiving_bank_name', contract.designated_bank_name, bank);
    cmp('designated_account_number', '입금계좌번호', 'receiving_account_number', contract.designated_account_number, digits);
    cmp('designated_account_holder', '예금주', 'receiving_account_holder', contract.designated_account_holder, company);
    const amount = number(raw.requested_amount_krw), limit = number(contract.credit_limit_krw), balance = number(ledger.current_loan_balance_krw);
    if (limit === null || balance === null || balance > limit) throw new Error('기준 한도 또는 모의 잔액이 유효하지 않습니다.');
    const available = limit - balance;
    add('amount', '잔여 한도', amount === null || amount <= 0 || raw.currency !== 'KRW' ? 'missing' : amount <= available ? 'pass' : 'mismatch', available, amount, amount === null || amount <= 0 ? '요청금액을 확인할 수 없습니다.' : raw.currency !== 'KRW' ? '원화 거래인지 확인이 필요합니다.' : amount > available ? '잔여 한도를 ' + (amount - available).toLocaleString('ko-KR') + '원 초과합니다.' : '잔여 한도 이내입니다.', { type: 'calculated', formula: '약정한도 − 현재 대출잔액', inputs: [{...ref('credit_limit_krw'),value:limit},{type:'mock_ledger',field:'current_loan_balance_krw',value:balance,as_of:ledger.balance_as_of}] }, 'requested_amount_krw');
    const day = date(raw.requested_execution_date), start = date(contract.execution_start_date), end = date(contract.execution_end_date);
    add('period', '실행 가능 기간', !day || !start || !end ? 'missing' : day >= start && day <= end ? 'pass' : 'mismatch', start && end ? start + ' ~ ' + end : null, day, !day ? '실행희망일을 확인할 수 없습니다.' : day < start || day > end ? '약정상 실행 가능 기간을 벗어났습니다.' : '실행 가능 기간 이내입니다.', ref('execution_start_date / execution_end_date'), 'requested_execution_date');
    if(Object.hasOwn(raw,'payout_amount_krw')) {
      const payout=number(raw.payout_amount_krw);
      add('document_amount_consistency','본문·지급표 금액',amount===null||payout===null?'missing':amount===payout?'pass':'mismatch',amount,payout,amount===null||payout===null?'본문 요청금액 또는 지급표 금액을 확인할 수 없습니다. 서로 보충하지 않습니다.':amount===payout?'본문과 지급표 금액이 일치합니다.':'본문과 지급표 금액이 다릅니다. 등급표 밖의 사유로 별도 검토가 필요합니다.',source(ctx,'requested_amount_krw'),'payout_amount_krw');
    }
    const missing = checks.filter(c => c.status === 'missing'), mismatch = checks.filter(c => c.status === 'mismatch');
    const classification = missing.length ? 'incomplete' : mismatch.length ? 'review' : 'normal';
    const labels = [...missing, ...mismatch].map(c => c.label);
    // Processing completion, completeness of evaluation and human review are independent.
    // Grades are this prototype's explicit policy, not a bank's lending decision.
    const outsideMatrix=mismatch.some(c=>c.key==='document_amount_consistency');
    const evaluation_status = missing.length||outsideMatrix ? 'incomplete' : 'completed';
    const size = amount !== null && amount > 0 && raw.currency === 'KRW' && limit > 0
      ? amount / limit < 0.1 ? 'small' : amount / limit < 0.3 ? 'medium' : 'large'
      : null;
    const grade = evaluation_status === 'incomplete' ? null : mismatch.reduce((highest, c) => {
      const condition = c.key === 'amount' || c.key === 'period';
      return Math.min(highest, condition ? ({small:3,medium:2,large:1})[size] : ({small:2,medium:1,large:1})[size]);
    }, 4);
    const confirmed_mismatches = mismatch.map(c => ({ key: c.key, label: c.label }));
    const unconfirmed_items = missing.map(c => ({ key: c.key, label: c.label }));
    const title = mismatch.length ? '이상 징후 발견 · 담당자 검토 필요' : missing.length ? '문서 정보 확인 필요' : '문서 대조 완료';
    const warning = mismatch.length ? mismatch.map(c => c.label).join(', ') + ' 항목이 약정 조건과 달라 담당자 확인이 필요합니다.' : '';
    const incomplete = missing.length ? missing.map(c => c.label).join(', ') + ' 정보를 확인할 수 없어 최종 등급은 미정입니다.' : outsideMatrix?'등급표 밖의 지급 조건 불일치로 최종 등급은 미정입니다.':'';
    const message = [warning, incomplete].filter(Boolean).join(' ') || '제출하신 요청의 기업·계좌·금액·기간을 대조했습니다. 실제 대출 실행이나 승인이 완료된 것은 아닙니다.';
    const statuses = { processing_status: 'completed', evaluation_status, final_grade: grade, review_status: 'pending', confirmed_mismatches, unconfirmed_items, warning_required: mismatch.length > 0 };
    const mask = v => { const s = digits(v); return s ? '•••• ' + s.slice(-4) : '확인 필요'; };
    return { request_id: ctx.request_id, contract_id: ctx.contract_id, session_id: ctx.session_id, request_reference: clean(raw.request_reference) || ctx.request_id, agreement_reference: clean(raw.agreement_reference), company_name: clean(raw.company_name), classification, ...statuses, title, checks, requested_amount_krw: amount, requested_execution_date: day, currency: raw.currency || null, credit_limit_krw: limit, current_loan_balance_krw: balance, available_limit_krw: available, funds_purpose: { reference: contract.allowed_funds_purpose, requested: clean(raw.funds_purpose), status: 'reference_only', note: '참고 정보 · 자동 판정 보류', reference_source: ref('allowed_funds_purpose'), requested_source: source(ctx, 'funds_purpose') }, extracted: raw, source_filename: ctx.filename, source_document_id: ctx.document_id, studio_job_id: ctx.studio_job_id || null, created_at: ctx.received_at || new Date().toISOString(), customer: { request_id: ctx.request_id, request_reference: clean(raw.request_reference) || ctx.request_id, classification, ...statuses, title, message, company_name: clean(raw.company_name), requested_amount_krw: amount, requested_execution_date: day, bank_name: clean(raw.receiving_bank_name), masked_account: mask(raw.receiving_account_number), issue_labels: labels }, execution_performed: false, ledger_updated: false };
  }
  return { register, verify };
}
