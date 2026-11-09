import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStudioOperationsState} from '../lib/studio-operations-model.mjs';
const session='studio_session_01';
const job=(overrides={})=>({id:'receipt-1',kind:'request',filename:'request.pdf',document_id:'document-1',received_at:'2026-11-03T01:00:00Z',updated_at:'2026-11-03T01:01:00Z',processing_status:'completed',evaluation_status:'completed',grade:6,decision_label:'6등급',reason:'실제 대조 근거',basic_comparison:'match',checks:[{key:'date_check',label:'기간',status:'match',basis:'약정 기간 이내'},{key:'outstanding_check',label:'잔액',status:'match',basis:'기실행 + 요청'},{key:'available_check',label:'여유',status:'match',basis:'한도 - 잔액'}],document_routing_required:false,configuration_mode:'latest',collection_status:'unconfirmed',...overrides});
const state=(jobs)=>({provider:'studio',session_id:session,configuration_mode:'latest',jobs});
test('Studio adapter preserves enum grade and only supplied aggregate checks without synthetic contracts',()=>{
 const snapshot=normalizeStudioOperationsState(state([job({grade:1,decision_label:'1등급',basic_comparison:'mismatch',request_fields:{requester_name:'신청인',requested_amount_krw:50,credit_limit_krw:900},matched_contract:{contract_id:'C1',credit_limit_krw:100},requested_ratio:.5})]),session);
 assert.deepEqual(snapshot.contracts,[]); const request=snapshot.requests[0];
 assert.equal(request.grade,1); assert.equal(request.companyName,'신청인'); assert.equal(request.contractAmount,100); assert.equal(request.requestedAmount,50); assert.equal(request.ratio,50);
 assert.deepEqual(request.checks.map(c=>c.key),['basic_comparison','credit_period','outstanding_arithmetic','available_arithmetic']);
 assert.equal(request.checks[1].note,'약정 기간 이내'); assert.equal(request.studio.collectionStatus,'unconfirmed');
 assert.equal(request.files[0].page,1); assert.match(request.files[0].url,/\/api\/studio\/document\?session=studio_session_01&id=document-1/);
 assert.equal(request.customerNotification,undefined);
});
test('absent metadata stays unknown and declared limit never becomes matched contract amount',()=>{
 const r=normalizeStudioOperationsState(state([job({checks:[],basic_comparison:undefined,request_fields:{credit_limit_krw:999},requested_ratio:Infinity})]),session).requests[0];
 assert.equal(r.companyName,'request.pdf');assert.equal(r.contractAmount,null);assert.equal(r.requestedAmount,null);assert.equal(r.contractReference,'미확인');assert.equal(r.ratio,null);assert.deepEqual(r.checks,[]);
});
test('routing and contract jobs stay receipts, never request metrics or registered contracts',()=>{
 const snapshot=normalizeStudioOperationsState(state([job({document_routing_required:true}),job({id:'contract',kind:'contract'})]),session);
 assert.equal(snapshot.receipts.length,2);assert.equal(snapshot.requests.length,0);assert.deepEqual(snapshot.contracts,[]);assert.equal(snapshot.receipts[0].routing.canContinue,false);
});
test('pending failed uncertain and incomplete cannot promote stale grades',()=>{
 for(const [override,expected] of [[{processing_status:'queued'},'processing'],[{processing_status:'failed'},'failed'],[{processing_status:'uncertain'},'unknown'],[{evaluation_status:'incomplete'},'completed']]){
  const r=normalizeStudioOperationsState(state([job(override)]),session).requests[0];assert.equal(r.grade,null);assert.equal(r.processing,expected);
 }
});
test('rejects unknown and cross-session scope and unsafe links',()=>{
 for(const input of [{jobs:[]},state([]),{...state([]),session_id:'another_session'},{...state([job({session_id:'another_session'})])}]){
  if(input.session_id===session && input.jobs.length===0)continue;
  assert.throws(()=>normalizeStudioOperationsState(input,session),/state_invalid/);
 }
 for(const url of ['javascript:alert(1)','https://studio.upstage.ai.evil.test/agents/a','https://studio.upstage.ai/agentsx/a','https://user@studio.upstage.ai/agents/a'])assert.equal(normalizeStudioOperationsState(state([job({studio_url:url})]),session).requests[0].studio.url,null);
 assert.equal(normalizeStudioOperationsState(state([job({studio_url:'https://studio.upstage.ai/agents/a/jobs/1'})]),session).requests[0].studio.url,'https://studio.upstage.ai/agents/a/jobs/1');
});

test('adapter through incumbent metrics and status keeps aggregate mismatch and incomplete scope accurate', async()=>{
 const {operationsMetrics}=await import('../lib/operations-model.ts');
 const {operationsRequestStatus}=await import('../lib/operations-format.ts');
 const snapshot=normalizeStudioOperationsState(state([
  job(),job({id:'mismatch',grade:1,decision_label:'1등급',basic_comparison:'mismatch'}),
  job({id:'incomplete',evaluation_status:'incomplete',grade:6,basic_comparison:'unknown'}),
  job({id:'routing',document_routing_required:true}),job({id:'contract',kind:'contract'}),
  job({id:'missing-checks',checks:[]}),job({id:'failed',processing_status:'failed'}),
 ]),session);
 const metrics=operationsMetrics(snapshot.requests);
 assert.equal(metrics.totalRequests,5);assert.equal(metrics.comparedRequests,2);assert.equal(metrics.mismatchRequests,1);assert.equal(metrics.mismatchRate,50);assert.equal(metrics.unevaluatedRequests,3);
 assert.equal(metrics.mismatchFields.find(field=>field.key==='basic_comparison'),undefined);
 assert.equal(metrics.mismatchFields.find(field=>field.key==='payout_account').unavailableCount,2);
 assert.deepEqual(snapshot.requests.map(operationsRequestStatus),['match','mismatch','review','review','failed']);
});
test('same receipt deduplicates by real update and preserves input without mutation',()=>{
 const input=state([job({processing_status:'queued',updated_at:'2026-11-03T01:00:00Z'}),job()]);const before=structuredClone(input);
 const snapshot=normalizeStudioOperationsState(input,session);
 assert.equal(snapshot.requests.length,1);assert.equal(snapshot.requests[0].grade,6);assert.equal(snapshot.updatedAt,'2026-11-03T01:01:00.000Z');assert.deepEqual(input,before);
});


test('enum label and four supplied checks must agree before displaying a confirmed grade',()=>{
 for (const overrides of [
  {grade:1,decision_label:'6등급',basic_comparison:'mismatch'},
  {grade:6,basic_comparison:'mismatch'},
  {grade:2,decision_label:'2등급'},
  {decision_label:null}, {checks:[]}, {basic_comparison:'unknown'},
  {checks:[{key:'date_check',status:'match',basis:'기간 이내'}]},
 ]) {
  const snapshot=normalizeStudioOperationsState(state([job(overrides)]),session);
  assert.equal(snapshot.requests[0].grade,null);
  assert.equal(snapshot.receipts[0].stateLabel,'결과 확인 필요');
  assert.equal(snapshot.requests[0].logs.at(-1).label,'결과 확인 필요');
 }
 // Evidence never derives a numeric grade from ratio or downgrades to another grade.
 const request=normalizeStudioOperationsState(state([job({grade:2,decision_label:'2등급',basic_comparison:'mismatch',requested_ratio:.01})]),session).requests[0];
 assert.equal(request.grade,2);assert.equal(request.ratio,1);
});
test('actual incomplete decision survives while stale grade cannot survive',()=>{
 const request=normalizeStudioOperationsState(state([job({evaluation_status:'incomplete',decision_label:'미평가',basic_comparison:'unknown'})]),session).requests[0];
 assert.equal(request.grade,null);assert.equal(request.studio.decision,'미평가');assert.equal(request.studio.reason,'실제 대조 근거');
});


test('filter grouping uses actual document contract identity without creating registered contracts',async()=>{
 const {operationsRequestScope}=await import('../lib/operations-format.ts');
 const snapshot=normalizeStudioOperationsState(state([job({id:'a',document_contract_id:'AGREEMENT-1'}),job({id:'b',document_contract_id:'AGREEMENT-2'}),job({id:'c',document_contract_id:null,request_fields:{contract_id:'extracted-only'}})]),session);
 assert.equal(snapshot.requests[0].contractId,'AGREEMENT-1');
 assert.equal(snapshot.requests[2].contractId,undefined);
 assert.deepEqual(operationsRequestScope(snapshot.requests,{contractId:'AGREEMENT-1'}).map(request=>request.id),['a']);
 assert.deepEqual(snapshot.contracts,[]);
});


test('explicit banker role keeps redacted completion distinct from genuine incomplete and routing',()=>{
 const redacted=job({grade:null,decision_label:null,basic_comparison:'unknown',checks:[]});
 const snapshot=normalizeStudioOperationsState({...state([redacted,job({...redacted,id:'incomplete',evaluation_status:'incomplete'}),job({...redacted,id:'routing',document_routing_required:true})]),role:'banker'},session);
 assert.equal(snapshot.receipts[0].stateLabel,'처리 완료 · 저장 미확인');
 assert.equal(snapshot.receipts[1].stateLabel,'미평가 · 정보 확인 필요');
 assert.equal(snapshot.receipts[2].stateLabel,'문서 종류 확인 필요 · 대조 대상 아님');
 assert.equal(snapshot.requests[0].grade,null);
 assert.equal(normalizeStudioOperationsState({...state([redacted]),role:'admin'},session).receipts[0].stateLabel,'결과 확인 필요');
 assert.equal(normalizeStudioOperationsState(state([redacted]),session).receipts[0].stateLabel,'결과 확인 필요');
});


test('chart exposes 12 criteria without inventing individual results from aggregate evidence',async()=>{
 const {operationsMetrics}=await import('../lib/operations-model.ts');
 const studio=normalizeStudioOperationsState(state([job()]),session).requests;
 const metrics=operationsMetrics(studio);
 assert.equal(metrics.mismatchFields.length,12);
 assert.equal(new Set(metrics.mismatchFields.map(field=>field.key)).size,12);
 assert.ok(!metrics.mismatchFields.some(field=>field.key==='basic_comparison'));
 assert.equal(metrics.mismatchFields.find(field=>field.key==='payout_account').unavailableCount,1);
 assert.equal(metrics.mismatchFields.find(field=>field.key==='credit_period').unavailableCount,0);
 const legacy={...studio[0],id:'legacy',policyVersion:'contract-request-six-grade-v1'};
 assert.equal(operationsMetrics([legacy]).mismatchFields.length,12);
 assert.equal(operationsMetrics([...studio,legacy]).mismatchFields.length,12);
 assert.ok(operationsMetrics([]).mismatchFields.every(field=>field.count===0 && field.unavailableCount===0));
});

test('individual counts preserve missing evidence and exclude repeated checks and unfinished requests',async()=>{
 const {operationsMetrics}=await import('../lib/operations-model.ts');
 const validation={basic:{checks:[{name:'입금계좌 일치',passed:false},{name:'신청인명 일치',passed:false}]}};
 const requests=normalizeStudioOperationsState(state([
  job({id:'a',grade:5,decision_label:'5등급',basic_comparison:'mismatch',validation}),
  job({id:'b',grade:5,decision_label:'5등급',basic_comparison:'mismatch'}),
  job({id:'pending',processing_status:'queued',validation}),
  job({id:'incomplete',evaluation_status:'incomplete',validation}),
 ]),session).requests;
 const metrics=operationsMetrics([...requests,requests[0]]);
 assert.equal(metrics.comparedRequests,2);assert.equal(metrics.mismatchRequests,2);
 for(const key of ['payout_account','company_name']) {
  const field=metrics.mismatchFields.find(field=>field.key===key);
  assert.equal(field.count,1);assert.equal(field.unavailableCount,1);
 }
 const duplicate={...requests[0],checks:[...requests[0].checks,requests[0].checks.find(check=>check.key==='payout_account')]};
 const field=operationsMetrics([duplicate]).mismatchFields.find(field=>field.key==='payout_account');
 assert.equal(field.count,0);assert.equal(field.unavailableCount,1);
});

test('v40 Validate details and purpose review enrich admin without changing enum authority',()=>{
 const validation={input:{verdict:'green',checks:[]},basic:{verdict:'red',checks:[{name:'입금계좌 일치',passed:false,reason:'계좌 대조 실패',conditions:{left:{value:'123'},right:{value:'456'}}}]}};
 const r=normalizeStudioOperationsState(state([job({grade:5,decision_label:'5등급',basic_comparison:'mismatch',validation,purpose_review:'자금용도 확인 필요'})]),session).requests[0];
 assert.equal(r.grade,5);assert.equal(r.checks.find(c=>c.key==='payout_account').note,'계좌 대조 실패');
 assert.equal(r.checks.find(c=>c.key==='payout_account').requestValue,'123');
 assert.equal(r.purposeReview.note,'자금용도 확인 필요');assert.equal(r.purposeReview.status,'unknown');
});
test('v40 incomplete input keeps failed validation evidence without a grade',()=>{
 const r=normalizeStudioOperationsState(state([job({evaluation_status:'incomplete',grade:null,validation:{input:{verdict:'red',checks:[{name:'등록계약 contract_id 존재',passed:false,reason:'등록계약 없음'}]},basic:null}})]),session).requests[0];
 assert.equal(r.grade,null);assert.equal(r.validationFailures[0].name,'등록계약 contract_id 존재');assert.equal(r.validationFailures[0].reason,'등록계약 없음');
});


test('all 12 supplied field results count actual mismatches without changing grade totals',async()=>{
 const {operationsMetrics}=await import('../lib/operations-model.ts');
 const names=['약정번호 일치','신청인명 일치','입금계좌 일치','요청금액 한도 이하','사업자번호 일치','입금은행 일치','입금예금주 일치','여신과목 일치','승인한도 일치'];
 const validation={basic:{checks:names.map(name=>({name,passed:name!=='입금계좌 일치'}))}};
 const requests=normalizeStudioOperationsState(state([job({grade:5,decision_label:'5등급',basic_comparison:'mismatch',validation,
  checks:[{key:'date_check',status:'mismatch',basis:'기간 밖'},{key:'outstanding_check',status:'match',basis:'일치'},{key:'available_check',status:'match',basis:'일치'}]})]),session).requests;
 const metrics=operationsMetrics(requests);
 assert.equal(metrics.mismatchFields.length,12);
 assert.ok(metrics.mismatchFields.every(field=>field.unavailableCount===0));
 assert.deepEqual(metrics.mismatchFields.filter(field=>field.count>0).map(field=>field.key),['payout_account','credit_period']);
 assert.equal(metrics.gradeCounts.find(item=>item.grade===5).count,1);
 assert.equal(metrics.mismatchRequests,1);
});
