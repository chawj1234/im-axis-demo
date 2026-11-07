import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readStudioConfig,readStudioSnapshot,studioJobStatus,studioNavigation,validStudioSession} from '../lib/studio-screen-types.ts';
const session='studio-test-session';
const job={id:'REQ-test',kind:'request',filename:'request.pdf',document_id:'doc-test',received_at:'2026-11-03T01:00:00Z',updated_at:'2026-11-03T01:00:00Z',processing_status:'completed',evaluation_status:'completed',collection_status:'unconfirmed',grade:5,decision_label:'불일치',reason:'private reason',checks:[{key:'amount',label:'이번 요청금액',status:'mismatch',basis:'private basis'}],basic_comparison:'mismatch',document_routing_required:false,document_request_id:'private-request',document_contract_id:'private-contract',studio_job_id:'job_original',studio_url:'https://studio.upstage.ai/agents/agt_original',configuration_mode:'latest',resolved_config_id:'3',error_code:null};
const state=(jobs=[job])=>({provider:'studio',session_id:session,jobs,summary:null,configuration_mode:'latest'});
test('session convention is strict and config keeps latest explicit without fallback on malformed Studio',()=>{
  for(const value of ['12345678','a'.repeat(90),'demo-123_abc'])assert.equal(validStudioSession(value),true);
  for(const value of [null,'short','a'.repeat(91),'../session','12345678\n'])assert.equal(validStudioSession(value),false);
  assert.equal(readStudioConfig({lifecycle_intake:{enabled:true}}),null);
  assert.throws(()=>readStudioConfig({execution_provider:'studio',studio:{}}),/config_invalid/);
  assert.equal(readStudioConfig({execution_provider:'studio',studio:{configuration_mode:'pinned',enabled:true,kinds:{request:true,contract:false}}}).configuration_mode,'pinned');
  assert.equal(readStudioSnapshot({...state(),configuration_mode:'pinned'},session,'admin').configuration_mode,'pinned');
  assert.deepEqual(readStudioConfig({execution_provider:'studio',studio:{configuration_mode:'latest',enabled:true,kinds:{request:true,contract:false}}}),{configuration_mode:'latest',enabled:true,kinds:{request:true,contract:false}});
});
test('banker projection discards sensitive fields even when server mistakenly supplies admin DTO',()=>{
  const input=state(),before=structuredClone(input);
  const view=readStudioSnapshot(input,session,'banker').jobs[0];
  assert.equal(studioJobStatus(view,'banker'),'처리 완료 · 저장 미확인');
  for(const field of ['grade','reason','decision_label','studio_url','studio_job_id','document_request_id','document_contract_id','error_code'])assert.equal(view[field],null);
  assert.deepEqual(view.checks,[]);assert.equal(view.basic_comparison,'unknown');assert.deepEqual(input,before);
});
test('initial unavailable state cannot be mistaken for empty and different session data is rejected',()=>{
  assert.throws(()=>readStudioSnapshot({},session,'admin'),/state_invalid/);
  assert.throws(()=>readStudioSnapshot(state(),'another-session','admin'),/state_invalid/);
  assert.throws(()=>readStudioSnapshot(state([{}]),session,'admin'),/state_invalid/);
  assert.equal(readStudioSnapshot(state([]),session,'admin').jobs.length,0);
});
test('wrong document, valid incomplete, contract storage, technical failure are distinct',()=>{
  assert.match(studioJobStatus({...job,document_routing_required:true},'admin'),/대조 대상 아님/);
  assert.match(studioJobStatus({...job,evaluation_status:'incomplete',grade:null},'admin'),/미평가/);
  assert.match(studioJobStatus({...job,kind:'contract'},'admin'),/분석 완료 · 저장 미확인/);
  for(const status of ['failed','uncertain','in_progress']){
    const projected=readStudioSnapshot(state([{...job,processing_status:status}]),session,'admin').jobs[0];
    assert.equal(projected.grade,null);assert.equal(projected.reason,null);assert.deepEqual(projected.checks,[]);
    assert.doesNotMatch(studioJobStatus(projected,'admin'),/대조 완료|등급/);
  }
  assert.match(studioJobStatus({...job,grade:null},'admin'),/결과 확인 필요/);
  assert.match(studioJobStatus(job,'admin'),/5등급/);
  assert.match(studioJobStatus({...job,document_routing_required:true},'banker'),/문서 종류 확인 필요/);
  assert.equal(readStudioSnapshot(state([{...job,document_routing_required:true}]),session,'banker').jobs[0].document_routing_required,true);
  assert.match(studioJobStatus({...job,kind:'contract'},'banker'),/분석 완료 · 저장 미확인/);
  for(const grade of [7,0,-1,1.5,'5',NaN])assert.equal(readStudioSnapshot(state([{...job,grade}]),session,'admin').jobs[0].grade,null);
});
test('only actual checks and trusted navigation are exposed; no invented comparison rows',()=>{
  const view=readStudioSnapshot(state(),session,'admin').jobs[0];
  assert.deepEqual(view.checks,job.checks);assert.equal(view.resolved_config_id,'3');assert.equal(view.studio_job_id,'job_original');
  assert.equal(studioNavigation(job.studio_url),job.studio_url);
  for(const url of ['javascript:alert(1)','https://studio.upstage.ai.evil/agents/abc','https://evil/agents/a','https://name:secret@studio.upstage.ai/agents/a'])assert.equal(studioNavigation(url),null);
});
test('summary is absent rather than fabricated zero and rejects collection-wide provenance',()=>{
  assert.equal(readStudioSnapshot(state(),session,'admin').summary,null);
  const summary={reportDate:'2026-11-03',cutoff:'2026-11-03T01:00:00Z',provenance:{scope:'tracked_receipts'},counts:{total:2},gradeCounts:{5:2}};
  assert.deepEqual(readStudioSnapshot({...state(),summary},session,'admin').summary,summary);
  assert.equal(readStudioSnapshot({...state(),summary},session,'banker').summary,null);
  assert.throws(()=>readStudioSnapshot({...state(),summary:{...summary,provenance:{scope:'whole_collection'}}},session,'admin'),/summary_invalid/);
});
test('screen connection preserves full incumbent workspace and minimal Studio integration',async()=>{
  const ui=await readFile(new URL('../components/operations-workspace.tsx',import.meta.url),'utf8');
  const wrapper=await readFile(new URL('../components/connected-operations-workspace.tsx',import.meta.url),'utf8');
  assert.match(wrapper,/AbortSignal/);assert.match(wrapper,/readStudioConfig/);assert.match(wrapper,/OperationsWorkspace.*role/);
  assert.doesNotMatch(wrapper,/StudioWorkspace|studio-workspace.css|studio-gate/);
  assert.match(wrapper,/key=\{config \? 'studio' : config === null \? 'legacy' : 'connecting'\}/);
  assert.match(ui,/다시 연결/);assert.match(ui,/normalizeStudioOperationsState\(readStudioSnapshot\(data, session, role\), session\)/);
  assert.match(ui,/controller.current/);assert.match(ui,/controller.current\?\.abort\(\)/);
  assert.match(ui,/&role=' \+ role/);assert.match(ui,/api\/studio\/intake\?kind=/);
  assert.match(ui,/if \(!studioConfig && contractId\) form.set/);
  assert.match(ui,/if\(studioConfig\|\|preview/);assert.match(ui,/if \(studioConfig \|\| preview/);
  assert.match(ui,/<StudioCoworkerPanel/);
  for(const role of ['banker','admin']){
    assert.match(await readFile(new URL(`../app/${role}/page.tsx`,import.meta.url),'utf8'),/ConnectedOperationsWorkspace/);
    assert.match(await readFile(new URL(`../app/${role}/preview/page.tsx`,import.meta.url),'utf8'),/OperationsWorkspace/);
  }
});
test('screen decoder accepts actual runtime receipt and banker DTO with no external calls',async t=>{
  const {StudioRuntime}=await import('../lib/studio-runtime.mjs');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'studio-screen-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const runtime=new StudioRuntime({root,client:{upload:async()=>{throw Error('unexpected_upload');},create:async()=>{throw Error('unexpected_create');},retrieve:async()=>{throw Error('unexpected_poll');}},workflows:{request:{agentId:'agt_request',configMode:'latest',collectionId:'scol_source'}},clock:()=>new Date('2026-11-03T02:00:00Z')});
  const receipt=await runtime.submit({session,kind:'request',file:{bytes:Buffer.from('%PDF-test'),filename:'request.pdf',pages:1}});
  for(const role of ['banker','admin']){
    const decoded=readStudioSnapshot(await runtime.state(session,{role}),session,role);
    assert.equal(decoded.jobs[0].id,receipt.job.id);
    assert.equal(decoded.jobs[0].processing_status,'received');
    assert.equal(decoded.jobs[0].grade,null);
    assert.equal(decoded.jobs[0].collection_status,'unconfirmed');
  }
});
