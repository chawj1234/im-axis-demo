import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StudioRuntime} from '../lib/studio-runtime.mjs';
import {readStudioSnapshot} from '../lib/studio-screen-types.ts';
import {normalizeStudioOperationsState} from '../lib/studio-operations-model.mjs';
const session='v40_runtime_session';
const stage=(model,value,meta)=>({model,status:'completed',content:[{type:'output_text',text:JSON.stringify(value),additional_values:JSON.stringify(meta||{})}]});
const validate=(name,passed)=>stage('Validate - '+name,passed?'green':'red',{verdict:passed?'green':'red',checks:[{name:'입금계좌 일치',passed,reason:'계좌 대조 근거',conditions:{left:{value:'123'},right:{value:passed?'123':'456'}}}]});
function completed(incomplete=false){
 return {id:'job_v40',model:'agt_v40',status:'completed',output:[
  stage('step_2_extract',{request_id:incomplete?'':'R40',contract_id:'C40',requested_amount_krw:10}),
  validate('요청-입력검증',!incomplete),...(!incomplete?[validate('요청-기본대조',true)]:[]),
  stage('Instruct - '+(incomplete?'입력부족-안내':'추가검사-기본일치'),{
   request_id:incomplete?null:'R40',contract_id:'C40',evaluation_status:incomplete?'incomplete':'match',
   checks:incomplete?null:Object.fromEntries(['date','outstanding','available'].map(k=>[k,{status:'match',basis:'실제 추가검사 근거'}])),
   grade_basis:null,purpose_review:null,reason:incomplete?'입력검증 실패':null,
  },{enum:incomplete?'미평가':'6등급'})]};
}
test('v40 actual-shaped responses survive runtime, report, screen and banker privacy boundaries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'axis-v40-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const client={upload(){},create(){},retrieve(){}};
 const runtime=new StudioRuntime({root,client,workflows:{request:{agentId:'agt_v40',configMode:'latest',collectionId:'scol_v40'}}});
 for(const incomplete of [false,true]){
  const now=new Date().toISOString();const job={id:'REQ-v40',receipt_id:'REQ-v40',session_id:session,kind:'request',filename:'request.pdf',document_id:'document-v40',studio_job_id:'job_v40',agent_id:'agt_v40',collection_id:'scol_v40',received_at:now,updated_at:now,configuration_mode:'latest'};
  runtime.applyResponse(session,job,completed(incomplete));assert.equal(job.processing_status,'completed');
  const admin=runtime.projectState(session,'admin',[job]);assert.equal(admin.summary_error,undefined);assert.equal(admin.summary.counts.total,1);
  const normalized=normalizeStudioOperationsState(readStudioSnapshot(admin,session,'admin'),session).requests[0];
  assert.equal(normalized.grade,incomplete?null:6);
  if(incomplete)assert.equal(normalized.validationFailures.length,1);
  else assert.equal(normalized.checks.find(c=>c.key==='payout_account').status,'match');
  const banker=runtime.dto(job,'banker');assert.equal(banker.validation,null);assert.equal(banker.purpose_review,null);
  const defensive=readStudioSnapshot(admin,session,'banker').jobs[0];assert.equal(defensive.validation,null);assert.equal(defensive.request_fields,null);
 }
});

test('legacy Instruct plus actual Validate metadata reaches all 12 chart criteria',async t=>{
 const {operationsMetrics}=await import('../lib/operations-model.ts');
 const root=await mkdtemp(join(tmpdir(),'axis-legacy-validation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new StudioRuntime({root,client:{upload(){},create(){},retrieve(){}},workflows:{request:{agentId:'agt_v40',configMode:'latest',collectionId:'scol_v40'}}});
 const response=completed();
 const names=['약정번호 일치','입금계좌 일치','요청금액 한도 이하','사업자번호 일치','입금은행 일치','여신과목 일치','승인한도 일치','신청인명 일치','입금예금주 일치'];
 response.output[2]=stage('Validate - 요청-기본대조','red',{verdict:'red',checks:names.map(name=>({name,passed:name!=='입금계좌 일치',reason:'실제 비교 근거'}))});
 response.output[3]=stage('Instruct - 추가검사-기본불일치',{
  request_id:'R40',contract_id:'C40',evaluation_status:'mismatch',basic_comparison_branch:'mismatch',requested_ratio:.9,
  date_check:{status:'match',basis:'기간 이내'},outstanding_check:{status:'match',basis:'잔액 일치'},available_check:{status:'match',basis:'한도여유 일치'},reason:'계좌 불일치',
 },{enum:'1등급'});
 const now=new Date().toISOString();
 const job={id:'REQ-legacy',receipt_id:'REQ-legacy',session_id:session,kind:'request',filename:'request.pdf',document_id:'document-v40',studio_job_id:'job_v40',agent_id:'agt_v40',collection_id:'scol_v40',received_at:now,updated_at:now,configuration_mode:'latest'};
 runtime.applyResponse(session,job,response);
 const snapshot=normalizeStudioOperationsState(readStudioSnapshot(runtime.projectState(session,'admin',[job]),session,'admin'),session);
 const metrics=operationsMetrics(snapshot.requests);
 assert.equal(snapshot.requests[0].grade,1);
 assert.equal(metrics.mismatchFields.length,12);
 assert.ok(metrics.mismatchFields.every(field=>field.unavailableCount===0));
 assert.deepEqual(metrics.mismatchFields.filter(field=>field.count).map(field=>field.key),['payout_account']);
});


test('fenced, double-encoded result plus citations survives the full live result pipeline',async t=>{
 const root=await mkdtemp(join(tmpdir(),'axis-cited-output-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new StudioRuntime({root,client:{upload(){},create(){},retrieve(){}},workflows:{request:{agentId:'agt_v40',configMode:'latest',collectionId:'scol_v40'}}});
 const result=completed();
 const output=result.output.at(-1).content[0];
 const fenced='```json\n'+output.text+'\n```\n\n- 문서에서 확인한 결과입니다.【†1】';
 output.text=JSON.stringify(JSON.stringify(fenced));
 const now=new Date().toISOString();
 const job={id:'REQ-cited',receipt_id:'REQ-cited',session_id:session,kind:'request',filename:'request.pdf',document_id:'document-v40',studio_job_id:'job_v40',agent_id:'agt_v40',collection_id:'scol_v40',received_at:now,updated_at:now,configuration_mode:'latest'};
 runtime.applyResponse(session,job,result);
 assert.equal(job.processing_status,'completed');
 const normalized=normalizeStudioOperationsState(readStudioSnapshot(runtime.projectState(session,'admin',[job]),session,'admin'),session);
 assert.equal(normalized.requests[0].grade,6);
 assert.equal(normalized.requests[0].checks.find(c=>c.key==='payout_account').status,'match');
 // Ambiguous fenced results must bypass the existing partial-evidence fallback.
 result.output.splice(1,0,stage('Match - 매칭-1',{등록계약:[{contract_id:'C40',credit_limit_krw:100}]}));
 output.text=fenced+'\n```json\n{}\n```';
 assert.throws(()=>runtime.applyResponse(session,structuredClone(job),result),/json_ambiguous/);
});

test('contract FLOW #20 separates validation failure, pending export and confirmed registration', async t => {
 const root = await mkdtemp(join(tmpdir(), 'axis-contract-validation-'));
 t.after(() => rm(root, {recursive:true, force:true}));
 const runtime = new StudioRuntime({root, client:{upload(){},create(){},retrieve(){}},
  workflows:{contract:{agentId:'agt_contract',configMode:'latest',collectionId:'scol_contract'}}});
 const now = new Date().toISOString();
 const job = {id:'receipt-contract',kind:'contract',filename:'contract.pdf',document_id:'document-contract',
  received_at:now,updated_at:now,configuration_mode:'latest'};
 const snapshot = () => normalizeStudioOperationsState(readStudioSnapshot(runtime.projectState(session,'banker',[job]),session,'banker'),session);
 for (const passed of [false,true]) {
  runtime.applyResponse(session,job,{status:'completed',output:[validate('계약-필수값검증',passed)]});
  assert.equal(job.processing_status,'completed');
  assert.equal(job.contract_validation,passed?'green':'red');
  job.collection_status = 'unconfirmed';
  assert.equal(snapshot().receipts[0].stateLabel,passed?'분석 완료 · 저장 미확인':'필수 정보 확인 필요 · 등록 안 됨');
  job.collection_status = 'stored';
  assert.equal(snapshot().receipts[0].stateLabel,passed?'등록 완료':'필수 정보 확인 필요 · 등록 안 됨');
  assert.equal(snapshot().receipts[0].documentStatus,passed?'completed':'needs_attention');
  assert.equal(snapshot().requests.length,0);
 }
 const contradictory = validate('계약-필수값검증',false);
 contradictory.content[0].text = JSON.stringify('green');
 assert.throws(() => runtime.applyResponse(session,{...job},{status:'completed',output:[contradictory]}),/validation_evidence/);
});

test('the new request shape reaches the dashboard with no artificial purpose check', async t => {
 const root=await mkdtemp(join(tmpdir(),'axis-request-v5-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=new StudioRuntime({root,client:{upload(){},create(){},retrieve(){}},workflows:{request:{agentId:'agt_v40',configMode:'latest',collectionId:'scol_v40'}}});
 const result=completed();
 const content=result.output.at(-1).content[0], value=JSON.parse(content.text);
 delete value.purpose_review;delete value.reason;content.text=JSON.stringify(value);
 const now=new Date().toISOString();
 const job={id:'REQ-v5',receipt_id:'REQ-v5',session_id:session,kind:'request',filename:'request.pdf',document_id:'document-v5',studio_job_id:'job_v40',agent_id:'agt_v40',collection_id:'scol_v40',received_at:now,updated_at:now,configuration_mode:'latest'};
 runtime.applyResponse(session,job,result);
 const state=runtime.projectState(session,'admin',[job]);
 assert.equal(state.summary_error,undefined);
 const [request]=normalizeStudioOperationsState(readStudioSnapshot(state,session,'admin'),session).requests;
 assert.equal(request.grade,6);
 assert.equal(request.purposeReview,undefined);
 assert.equal(request.checks.find(c=>c.key==='payout_account').status,'match');
});
