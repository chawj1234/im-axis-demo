/**
 * Pure rules shared by the local service and n8n. The entire factory is closed
 * over its own helpers so `(${pairedVerificationRules.toString()})()` can run in
 * a Code node without imports, credentials, network calls or mutable state.
 */
export function pairedVerificationRules() {
  const POLICY = 'contract-request-six-grade-v1';
  const CONTRACT_FIELDS = ['agreement_reference','company_name','business_registration_number','credit_limit_krw','currency','execution_start_date','execution_end_date','allowed_funds_purpose','contract_signed_date','designated_bank_name','designated_account_number','designated_account_holder'];
  const REQUEST_FIELDS = ['request_reference','agreement_reference','company_name','business_registration_number','receiving_bank_name','receiving_account_number','receiving_account_holder','requested_amount_krw','currency','requested_execution_date','funds_purpose','request_date'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const stringValue = value => clean(value).normalize('NFC');
  // Preserve corporate words, punctuation and case. Only whitespace is ignored.
  const company = value => stringValue(value).replace(/\s+/gu, '');
  const account = value => {
    const normalized = clean(value).normalize('NFKC').replace(/[\s\-\u2010-\u2015\u2212]+/gu, '');
    // A masked or malformed account is unknown; never reconstruct hidden digits.
    return /^\d+$/u.test(normalized) ? normalized : '';
  };
  const amount = value => Number.isSafeInteger(value) && value > 0 ? value : null;
  const isKrw = value => clean(value).toUpperCase() === 'KRW';
  const piiTypes = {
    name:'name', person_name:'name', '이름':'name', '성명':'name',
    phone:'phone_number', phone_number:'phone_number', mobile_phone:'phone_number', '전화번호':'phone_number', '휴대전화번호':'phone_number',
    email:'email', email_address:'email', '이메일':'email', address:'address', '주소':'address',
    resident_registration_number:'resident_registration_number', resident_id:'resident_registration_number', '주민등록번호':'resident_registration_number',
    passport_number:'passport_number', '여권번호':'passport_number', driver_license_number:'driver_license_number', '운전면허번호':'driver_license_number',
    foreign_registration_number:'foreign_registration_number', '외국인등록번호':'foreign_registration_number',
    account_number:'account_number', bank_account:'account_number', '계좌번호':'account_number',
    business_registration_number:'business_registration_number', '사업자등록번호':'business_registration_number',
  };
  function piiDetection(fields, explicit) {
    const supplied = object(explicit);
    const nested = object(fields.pii_detection);
    const flag = typeof supplied.detected === 'boolean' ? supplied.detected
      : typeof nested.detected === 'boolean' ? nested.detected
      : typeof fields.personal_identifier_detected === 'boolean' ? fields.personal_identifier_detected : null;
    const rawTypes = Array.isArray(supplied.types) ? supplied.types : Array.isArray(nested.types) ? nested.types : Array.isArray(fields.pii_types) ? fields.pii_types : [];
    const types = [...new Set(rawTypes.map(value => piiTypes[clean(value).toLowerCase()]).filter(Boolean))];
    // Only explicitly returned detection/type fields are used. Corporate names
    // and corporate account numbers do not imply that a person was identified.
    return {detected: flag === true || types.length > 0 ? true : flag, types};
  }
  function evidenceFor(metadata, field) {
    const meta = object(metadata), evidence = object(object(meta.evidence)[field]);
    const page = Number.isInteger(evidence.page) && evidence.page >= 1 ? evidence.page : null;
    const coordinates = Array.isArray(evidence.coordinates) ? evidence.coordinates
      .map(point => object(point)).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
      .slice(0, 8).map(({x,y}) => ({x,y})) : [];
    return {
      type:'document', field, filename:clean(meta.filename) || null,
      document_id:clean(meta.document_id) || null, studio_job_id:clean(meta.studio_job_id) || null,
      page, ...(coordinates.length ? {coordinates} : {}),
      evidence_status:page ? 'provider_returned' : 'not_provided',
    };
  }
  function verifyPairedDocuments({contract: rawContract, request: rawRequest, contractSource, requestSource} = {}) {
    const contract = object(rawContract), request = object(rawRequest), checks = [];
    const compare = (key, label, contractField, requestField, normalize) => {
      const reference = clean(contract[contractField]), requested = clean(request[requestField]);
      const expected = normalize(reference), actual = normalize(requested);
      const status = !expected || !actual ? 'unknown' : expected === actual ? 'match' : 'mismatch';
      checks.push({key,label,status,contract_value:reference || null,request_value:requested || null,
        reference_source:evidenceFor(contractSource,contractField), requested_source:evidenceFor(requestSource,requestField)});
    };
    compare('contract_reference','계약번호','agreement_reference','agreement_reference',stringValue);
    compare('company_name','기업명','company_name','company_name',company);
    compare('payout_account','지급계좌','designated_account_number','receiving_account_number',account);
    const total = amount(contract.credit_limit_krw), requestedAmount = amount(request.requested_amount_krw);
    const moneyKnown = total !== null && requestedAmount !== null && isKrw(contract.currency) && isKrw(request.currency);
    checks.push({key:'contract_limit',label:'계약금액 이내 요청',status:!moneyKnown?'unknown':requestedAmount<=total?'match':'mismatch',
      contract_value:total,request_value:requestedAmount,
      reference_source:evidenceFor(contractSource,'credit_limit_krw'), requested_source:evidenceFor(requestSource,'requested_amount_krw')});
    const confirmed = checks.filter(check => check.status === 'mismatch').map(({key,label}) => ({key,label}));
    const unconfirmed = checks.filter(check => check.status === 'unknown').map(({key,label}) => ({key,label}));
    const ratio = moneyKnown ? requestedAmount / total : null;
    const grade = unconfirmed.length ? null : !confirmed.length ? 6
      : ratio <= .2 ? 5 : ratio <= .4 ? 4 : ratio <= .6 ? 3 : ratio <= .8 ? 2 : 1;
    const contractPii = piiDetection(contract,object(contractSource).pii);
    const requestPii = piiDetection(request,object(requestSource).pii);
    const detected = contractPii.detected === true || requestPii.detected === true ? true
      : contractPii.detected === false && requestPii.detected === false ? false : null;
    const normalizedAccount = account(request.receiving_account_number);
    const warning = confirmed.length > 0;
    return {
      policy_version:POLICY, processing_status:'completed', evaluation_status:unconfirmed.length?'incomplete':'completed',
      classification:unconfirmed.length?'incomplete':warning?'review':'normal',
      agreement_reference:clean(request.agreement_reference), company_name:clean(request.company_name) || clean(contract.company_name),
      contract_amount_krw:total, requested_amount_krw:requestedAmount, execution_ratio:ratio,
      checks, final_grade:grade, warning_required:warning, confirmed_mismatches:confirmed, unconfirmed_items:unconfirmed,
      pii_detection:{detected,types:[...new Set([...contractPii.types,...requestPii.types])]},
      pii_log:[{document_kind:'contract',...contractPii},{document_kind:'request',...requestPii}],
      customer:{warning_required:warning,
        title:warning?'서류 정보 확인 안내':'',
        message:warning?'계약서와 실행 요청서에 일치하지 않는 항목이 있습니다. 담당자에게 확인해 주세요.':'',
        masked_account:normalizedAccount?'•••• '+normalizedAccount.slice(-4):'', issue_labels:confirmed.map(item=>item.label)},
      execution_performed:false,
    };
  }
  function decode(value) {
    let decoded = value;
    for (let index=0; index<2 && typeof decoded==='string'; index++) decoded=JSON.parse(decoded);
    return decoded;
  }
  function additional(value) {
    try {return object(typeof value === 'string' ? JSON.parse(value) : value);} catch {return {};}
  }
  function stageIs(stage,type) {
    if (stage.step_type) return stage.step_type === type;
    return type === 'document-classify' ? /classify/i.test(clean(stage.model)) : /extract/i.test(clean(stage.model));
  }
  function classificationKind(value) {
    const label=clean(value);
    return label==='계약서' || label==='contract' ? 'contract' : label==='요청서' || label==='request' ? 'request' : null;
  }
  function sanitizedEvidence(fields,meta) {
    const result={};
    for (const key of fields) {
      const entry=object(meta[key]);
      if (!Object.keys(entry).length) continue;
      const value=evidenceFor({evidence:{[key]:entry}},key);
      if(value.page) result[key]={page:value.page,...(value.coordinates?{coordinates:value.coordinates}:{})};
    }
    return result;
  }
  /** Parse Studio's all-response shape; a filename or Instruct text cannot route a document. */
  function parseStudioDocument(allResponse) {
    const response=object(allResponse);
    if(response.status!=='completed') throw Error('완료된 Studio 결과가 필요합니다.');
    const stages=Array.isArray(response.output)?response.output:[], kinds=[], extracts=[];
    for(const stageValue of stages) {
      const stage=object(stageValue), classify=stageIs(stage,'document-classify'), extract=stageIs(stage,'information-extract');
      if(!classify&&!extract) continue;
      if(stage.status!=='completed') throw Error('문서 분류 또는 추출 단계가 완료되지 않았습니다.');
      for(const contentValue of Array.isArray(stage.content)?stage.content:[]) {
        const content=object(contentValue);
        if(content.type!=='output_text') continue;
        const meta=additional(content.additional_values);
        if(classify) {
          let label=content.text;
          try {label=decode(label);} catch { /* Studio returns its classify label as plain text. */ }
          const kind=classificationKind(label), evidenceKind=classificationKind(object(meta.document_type)._value);
          if(!kind || evidenceKind && kind!==evidenceKind) throw Error('Studio 문서 분류 결과를 확정하지 못했습니다.');
          kinds.push(kind);continue;
        }
        let value;
        try {value=object(decode(content.text));} catch {throw Error('Studio 추출 결과의 JSON 형식이 올바르지 않습니다.');}
        const contract=CONTRACT_FIELDS.every(key=>Object.hasOwn(value,key));
        const request=REQUEST_FIELDS.every(key=>Object.hasOwn(value,key));
        if(contract===request) throw Error('Studio 추출 스키마를 하나로 확정하지 못했습니다.');
        const fields=contract?CONTRACT_FIELDS:REQUEST_FIELDS;
        for(const key of fields) {
          const numeric=key==='credit_limit_krw'||key==='requested_amount_krw';
          if(numeric?!Number.isSafeInteger(value[key])||value[key]<-1:typeof value[key]!=='string') throw Error('Studio 추출 필드의 자료형이 올바르지 않습니다.');
        }
        extracts.push({kind:contract?'contract':'request',fields:Object.fromEntries(fields.map(key=>[key,value[key]])),
          evidence:sanitizedEvidence(fields,meta),pii:piiDetection(value)});
      }
    }
    if(kinds.length!==1||extracts.length!==1||kinds[0]!==extracts[0].kind) throw Error('Studio 분류와 유형별 추출 결과가 일치하지 않습니다.');
    return extracts[0];
  }
  return {verifyPairedDocuments,parseStudioDocument};
}

export function verifyPairedDocuments(input) {return pairedVerificationRules().verifyPairedDocuments(input);}
export function parseStudioDocument(allResponse) {return pairedVerificationRules().parseStudioDocument(allResponse);}
