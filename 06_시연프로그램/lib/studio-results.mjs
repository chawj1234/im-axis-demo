export const AGENT_ID='agt_NwAUNFvvZTG8RhWam5A9Mh';
export const CONTRACT_FIELDS=['agreement_reference','company_name','business_registration_number','credit_limit_krw','currency','execution_start_date','execution_end_date','allowed_funds_purpose','contract_signed_date','designated_bank_name','designated_account_number','designated_account_holder'];
export const REQUEST_FIELDS=['request_reference','agreement_reference','company_name','business_registration_number','receiving_bank_name','receiving_account_number','receiving_account_holder','requested_amount_krw','currency','requested_execution_date','funds_purpose','request_date'];

export const REQUEST_V2_FIELDS=["request_id", "contract_id", "requester_name", "requester_identifier", "destination_bank", "destination_account", "destination_holder", "requested_amount_krw", "requested_at", "requester_address", "credit_product", "fund_purpose", "credit_limit_krw", "outstanding_before_krw", "expected_outstanding_after_krw", "expected_available_after_krw", "desired_payment_date"];
export const REQUEST_V2_AMOUNT_FIELDS=["requested_amount_krw", "credit_limit_krw", "outstanding_before_krw", "expected_outstanding_after_krw", "expected_available_after_krw"];
export const REQUEST_V2_ALIASES={"request_reference": "request_id", "agreement_reference": "contract_id", "company_name": "requester_name", "business_registration_number": "requester_identifier", "receiving_bank_name": "destination_bank", "receiving_account_number": "destination_account", "receiving_account_holder": "destination_holder", "request_date": "requested_at", "funds_purpose": "fund_purpose", "requested_execution_date": "desired_payment_date"};

export const CONTRACT_V2_FIELDS=["deposit_account", "account_holder", "borrower_identifier", "borrower_name", "credit_limit_krw", "deposit_bank", "valid_to", "valid_from", "contract_id", "currency", "credit_product", "transaction_type", "fund_purpose", "execution_method", "repayment_method", "agreement_date", "lending_bank", "authorized_signer_name", "authorized_signer_title", "interest_type", "interest_rate_percent", "interest_payment_day", "repayment_account", "repayment_holder", "repayment_bank"];
export const CONTRACT_V2_INTEGER_FIELDS=["credit_limit_krw"];
export const CONTRACT_V2_RATE_FIELDS=["interest_rate_percent"];
export const CONTRACT_V2_ALIASES={"agreement_reference": "contract_id", "company_name": "borrower_name", "business_registration_number": "borrower_identifier", "designated_bank_name": "deposit_bank", "designated_account_number": "deposit_account", "designated_account_holder": "account_holder", "allowed_funds_purpose": "fund_purpose", "contract_signed_date": "agreement_date"};

function decode(text) {
  let value=text;
  for(let i=0;i<2&&typeof value==='string';i++)value=JSON.parse(value);
  return value;
}
export function stageResults(response) {
  return (response.output||[]).map(item=>({
    id:item.id||null,name:item.model||null,status:item.status||null,
    contents:(item.content||[]).filter(c=>c.type==='output_text').map(c=>{
      let value=null,additional=null,parse_error=null;
      try {value=decode(c.text);} catch {parse_error='invalid_json';}
      try {additional=typeof c.additional_values==='string'?JSON.parse(c.additional_values):c.additional_values??null;} catch {additional=null;}
      return {text:c.text,value,additional_values:additional,parse_error};
    })
  }));
}
export function extractResult(response) {
  if(response.status!=='completed')throw Error('완료되지 않은 작업을 대조할 수 없습니다.');
  const stages=stageResults(response);
  // Select the Extract step by the returned step name AND its schema. Never
  // take the last text: the last message normally belongs to Instruct.
  const candidates=[];
  for(const stage of stages) {
    if(typeof stage.name!=='string'||!/extract/i.test(stage.name))continue;
    for(const c of stage.contents) {
      const v=c.value;
      if(!v||typeof v!=='object'||Array.isArray(v))continue;
      const contractV2=Object.hasOwn(v,'borrower_name')||Object.hasOwn(v,'deposit_account');
      const requestV2=Object.hasOwn(v,'request_id')||Object.hasOwn(v,'requester_name');
      if(contractV2&&!CONTRACT_V2_FIELDS.every(k=>Object.hasOwn(v,k)))throw Error('계약서 새 스키마 필드가 누락되었습니다.');
      if(requestV2&&!REQUEST_V2_FIELDS.every(k=>Object.hasOwn(v,k)))throw Error('요청서 새 스키마 필드가 누락되었습니다.');
      const contract=(contractV2?CONTRACT_V2_FIELDS:CONTRACT_FIELDS).every(k=>Object.hasOwn(v,k));
      const request=(requestV2?REQUEST_V2_FIELDS:REQUEST_FIELDS).every(k=>Object.hasOwn(v,k));
      if(contract===request)continue;
      const v2=contract?contractV2:requestV2;
      const fields=contract?(v2?CONTRACT_V2_FIELDS:CONTRACT_FIELDS):(v2?REQUEST_V2_FIELDS:REQUEST_FIELDS);
      for(const key of fields) {
        const rate=contractV2&&CONTRACT_V2_RATE_FIELDS.includes(key);
        const integer=key==='credit_limit_krw'||key==='requested_amount_krw'||(requestV2&&REQUEST_V2_AMOUNT_FIELDS.includes(key))||(contractV2&&CONTRACT_V2_INTEGER_FIELDS.includes(key));
        const invalid=rate?typeof v[key]!=='number'||!Number.isFinite(v[key])||Math.abs(v[key])>Number.MAX_SAFE_INTEGER:integer?!Number.isSafeInteger(v[key])||(!v2&&v[key]<-1):typeof v[key]!=='string';
        if(invalid)throw Error('Extract 필드 자료형이 올바르지 않습니다: '+key);
      }
      if(!contract&&Object.hasOwn(v,'payout_amount_krw')&&(!Number.isSafeInteger(v.payout_amount_krw)||v.payout_amount_krw< -1))throw Error('지급표 금액의 자료형이 올바르지 않습니다.');
      let extracted=v;
      if(v2){
        extracted={...Object.fromEntries(fields.map(key=>[key,v[key]])),...(!contract?{currency:''}:{})};
        const aliases=contract?CONTRACT_V2_ALIASES:REQUEST_V2_ALIASES;
        for(const [alias,key] of Object.entries(aliases)){
          if(Object.hasOwn(v,alias)&&v[alias]!==v[key])throw Error((contract?'계약서':'요청서')+' 신·구 필드 값이 충돌합니다: '+key);
          extracted[alias]=v[key];
        }
      }
      candidates.push({kind:contract?'contract':'request',extracted,stage_name:stage.name,additional_values:c.additional_values});
    }
  }
  if(candidates.length!==1)throw Error('유형별 Extract 결과를 하나로 확정하지 못했습니다. 실제 단계 이름과 응답 구조를 확인해 주세요.');
  const selected=candidates[0];
  // Parse can contain the entire document. Retain its returned identity here,
  // not repeated copies of the whole document on every poll.
  const retained=stages.map(s=>/parse/i.test(s.name||'')?{id:s.id,name:s.name,status:s.status,content_retained:false}:s);
  return {...selected,stages:retained};
}
export function confirmedTransientFailure(response) {
  // A transport/HTTP failure is not a confirmed analysis failure. This function
  // is only for an existing job explicitly reported as failed by Studio.
  return response.status==='failed'&&['too_many_requests','studio_subscription_gate_unavailable'].includes(response.error?.code);
}
