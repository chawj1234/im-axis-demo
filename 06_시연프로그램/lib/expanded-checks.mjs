export const EXPANDED_POLICY_VERSION='contract-request-expanded-grade-v2';
export const EXPANDED_CHECK_KEYS=['contract_reference','company_name','payout_account','contract_limit','business_identifier','payout_bank','payout_holder','credit_product','declared_credit_limit','credit_period','outstanding_arithmetic','available_arithmetic'];
/** Pure, dependency-free for the n8n Edit Fields expression and independent tests. */
export function expandedChecks(contract,request) {
  const text=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').replace(/^(?:-1|n\/?a|null|none|unknown|미확인|없음|해당\s*없음|[-—–]+)$/i,''):'';
  const identifier=value=>text(value).replace(/[\s-]/g,'');
  const amount=(value,positive=false)=>Number.isSafeInteger(value)&&value>=0&&(!positive||value>0)?value:null;
  const equal=(key,a,b,normalize=text)=>{const x=normalize(a),y=normalize(b);return {key,contract_value:a??null,request_value:b??null,status:!x||!y?'unknown':x===y?'match':'mismatch'};};
  const c=contract,r=request;
  const checks=[
    equal('business_identifier',c.borrower_identifier??c.business_registration_number,r.requester_identifier??r.business_registration_number,identifier),
    equal('payout_bank',c.deposit_bank??c.designated_bank_name,r.destination_bank??r.receiving_bank_name),
    equal('payout_holder',c.account_holder??c.designated_account_holder,r.destination_holder??r.receiving_account_holder),
    equal('credit_product',c.credit_product,r.credit_product),
  ];
  const limit=amount(c.credit_limit_krw,true),declared=amount(r.credit_limit_krw,true);
  checks.push({key:'declared_credit_limit',contract_value:limit,request_value:declared,status:limit===null||declared===null?'unknown':limit===declared?'match':'mismatch'});
  const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null;
  const start=date(c.valid_from),end=date(c.valid_to),day=date(r.desired_payment_date);
  checks.push({key:'credit_period',contract_value:start&&end?start+' ~ '+end:null,request_value:day,status:!start||!end||!day||start>end?'unknown':day>=start&&day<=end?'match':'mismatch'});
  const before=amount(r.outstanding_before_krw),requested=amount(r.requested_amount_krw,true),after=amount(r.expected_outstanding_after_krw);
  const expected=before!==null&&requested!==null&&Number.isSafeInteger(before+requested)?before+requested:null;
  checks.push({key:'outstanding_arithmetic',contract_value:expected,request_value:after,status:expected===null||after===null?'unknown':expected===after?'match':'mismatch'});
  // A negative declared available balance is meaningful. -1 remains the schema's missing sentinel.
  const available=Number.isSafeInteger(r.expected_available_after_krw)&&r.expected_available_after_krw!==-1?r.expected_available_after_krw:null;
  const remaining=declared!==null&&after!==null&&Number.isSafeInteger(declared-after)?declared-after:null;
  checks.push({key:'available_arithmetic',contract_value:remaining,request_value:available,status:remaining===null||available===null?'unknown':remaining===available?'match':'mismatch'});
  const a=text(c.fund_purpose??c.allowed_funds_purpose),b=text(r.fund_purpose??r.funds_purpose);
  return {checks,review_checks:[{key:'fund_purpose',contract_value:a||null,request_value:b||null,status:a&&b&&a===b?'match':'unknown',note:a&&b&&a===b?'자금용도 표기가 일치합니다.':'자금용도의 허용 범위는 담당자가 확인해야 합니다. 표현 차이만으로 불일치를 확정하지 않습니다.'}]};
}
