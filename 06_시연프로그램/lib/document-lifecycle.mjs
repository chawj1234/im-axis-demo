export const LIFECYCLE_MODES = ['contract_registration','registered_request'];
export const isLifecycleJob = job => LIFECYCLE_MODES.includes(job?.intake_mode);
export const isFeedbackJob = job => job?.intake_mode==='paired'||isLifecycleJob(job);
export const isRegisteredContract = (contract,session) => contract?.session_id===session&&contract?.policy_version==='contract-request-six-grade-v1'&&contract?.registration_status==='completed'&&contract?.extracted&&Number.isSafeInteger(contract.extracted.credit_limit_krw)&&contract.extracted.credit_limit_krw>0&&['agreement_reference','company_name','designated_account_number'].every(key=>typeof contract.extracted[key]==='string'&&contract.extracted[key].trim()&&!/^(?:-1|n\/?a|null|none|unknown|미확인|없음|해당\s*없음|[-—–]+)$/i.test(contract.extracted[key].trim()));
export function lifecycleReceiptNotice(job) {
  return {id:job.id+':receipt:'+job.kind,job_id:job.id,kind:'receipt',document_kind:job.kind,audience:'customer',created_at:job.created_at,message:job.kind==='contract'?'계약서가 접수되었습니다.':'실행 요청서가 접수되었습니다.',metadata:{receipt_basis:'submitted_document'},displayed_at:{}};
}
export function customerContractReference(job) {
  const contract=job?.intake_mode==='contract_registration'?job.result?.contract:job?.contract_snapshot||job?.result?.contract;
  const value=contract?.extracted?.contract_id||contract?.agreement_reference||job?.result?.agreement_reference;
  return typeof value==='string'&&value.trim()?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80):undefined;
}
export function lifecycleCustomerActivity(job) {
  const mismatch=job.kind==='request'&&job.result?.evaluation_status==='completed'&&job.result?.checks?.some(check=>check.status==='mismatch');
  const reference=customerContractReference(job);
  return {id:job.id,contract_id:job.contract_id,...(reference?{contract_reference:reference}:{}),kind:job.kind,created_at:job.created_at,stage:'received',result:mismatch?{warning_required:true,message:'계약서와 요청서의 정보가 일치하지 않는 항목이 있습니다. 담당자에게 확인해 주세요.'}:null};
}
