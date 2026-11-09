import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptStudioDecision, readStudioDecision} from '../lib/studio-decision.mjs';
const ids = {expectedRequestId:'R40',expectedContractId:'C40'};
const check = {status:'match',basis:'문서값 일치'};
const body = () => ({request_id:'R40',contract_id:'C40',evaluation_status:'match',checks:{date:{...check},outstanding:{...check},available:{...check}},grade_basis:null,purpose_review:null,reason:null});
const validate = (name, verdict) => ({model:`Validate - ${name}`,status:'completed',content:[{type:'output_text',text:JSON.stringify(verdict),additional_values:JSON.stringify({verdict,checks:[{name:'검사항목',passed:verdict==='green',reason:'실제 비교 근거',conditions:{kind:'condition',passed:verdict==='green'}}]})}]});
const response = (value=body(),decision='6등급',basic='green',input='green') => ({status:'completed',output:[validate('요청-입력검증',input),...(basic?[validate('요청-기본대조',basic)]:[]),{model:`Instruct - ${input==='red'?'입력부족-안내':basic==='green'?'추가검사-기본일치':'추가검사-기본불일치'}`,status:'completed',content:[{type:'output_text',text:JSON.stringify(value),additional_values:JSON.stringify({enum:decision})}]}]});
const read = (...args) => readStudioDecision(response(...args),ids);
test('v40 normal keeps null reason and no fabricated ratio; canonical projection revalidates',()=>{
 const accepted=read();assert.equal(accepted.final_grade,6);assert.equal(accepted.body.reason,null);assert.equal(accepted.body.requested_ratio,null);assert.equal(accepted.body.basic_comparison_branch,'match');assert.deepEqual(accepted.body.date_check,check);assert.equal(accepted.body.validation.basic.checks[0].reason,'실제 비교 근거');
 assert.equal(acceptStudioDecision({decision:'6등급',body:accepted.body,...ids}).final_grade,6);
});
test('v40 mismatch uses Validate branch and retains supplied enum without regrading',()=>{
 const value={...body(),evaluation_status:'mismatch',grade_basis:{requested_amount_krw:10,contract_limit_krw:100,ratio:.1,applied_rule:'20% 이하'}};
 assert.equal(read(value,'4등급','red').final_grade,4);assert.equal(read(value,'4등급','red').body.requested_ratio,.1);
});
test('v40 graded unknown, contradictory branches, missing output fields fail closed',()=>{
 const unknown=body();unknown.checks.date.status='unknown';assert.throws(()=>read(unknown),/evidence/);
 assert.throws(()=>read(body(),'6등급','red'),/evidence/);
 const missing=body();delete missing.purpose_review;assert.throws(()=>read(missing),/incomplete/);
 const noValidation=response();noValidation.output.shift();assert.throws(()=>readStudioDecision(noValidation,ids),/validation/);
});
test('v40 input failure permits null identifiers and preserves actual failed checks',()=>{
 const value={...body(),request_id:null,contract_id:null,evaluation_status:'incomplete',checks:null,reason:'입력검증을 통과하지 못했습니다.'};
 const accepted=readStudioDecision(response(value,'미평가',null,'red'),{expectedRequestId:null,expectedContractId:null});
 assert.equal(accepted.final_grade,null);assert.equal(accepted.body.validation.input.checks[0].passed,false);
});
test('v40 metadata verdict conflicts and duplicated stages are rejected',()=>{
 const r=response();r.output[0].content[0].additional_values=JSON.stringify({verdict:'red',checks:[{name:'검사',passed:false,reason:'실패'}]});
 assert.throws(()=>readStudioDecision(r,ids),/validation/);
 const duplicate=response();duplicate.output.push(duplicate.output[0]);assert.throws(()=>readStudioDecision(duplicate,ids),/validation/);
});
test('v40 additional unknown remains incomplete and cannot acquire a grade through aliases',()=>{
 const value={...body(),evaluation_status:'incomplete',reason:'날짜 확인 필요'};value.checks.date.status='unknown';
 const accepted=read(value,'미평가');assert.equal(accepted.evaluation_status,'incomplete');assert.equal(accepted.body.date_check.status,'unknown');
 const normal=read();normal.body.basic_comparison_branch='mismatch';
 assert.throws(()=>acceptStudioDecision({decision:'6등급',body:normal.body,...ids}),/evidence_inconsistent/);
});
test('v40 rejects a null reason on incomplete and unexpected text reason on evaluated output',()=>{
 assert.throws(()=>read({...body(),reason:'정상'}),/evidence_inconsistent/);
 const value={...body(),evaluation_status:'incomplete',reason:null};value.checks.date.status='unknown';
 assert.throws(()=>read(value,'미평가'),/body_incomplete/);
});

test('observed v40 normal output omits non-applicable fields and echoes the dedicated enum',()=>{
 const value=body();delete value.grade_basis;delete value.reason;value.studio_decision='6등급';
 const result=read(value);assert.equal(result.final_grade,6);assert.equal(result.body.grade_basis,null);assert.equal(result.body.reason,null);
 assert.equal(Object.hasOwn(result.body,'studio_decision'),false);
 value.studio_decision='1등급';assert.throws(()=>read(value),/duplicate_grade_source/);
});
test('v40 omission normalization never fills purpose review, mismatch ratio evidence or incomplete reason',()=>{
 const normal=body();delete normal.purpose_review;assert.throws(()=>read(normal),/body_incomplete/);
 const mismatch={...body(),evaluation_status:'mismatch'};delete mismatch.grade_basis;delete mismatch.reason;
 assert.throws(()=>read(mismatch,'1등급','red'),/body_incomplete/);
 const incomplete={...body(),evaluation_status:'incomplete',checks:null};delete incomplete.reason;
 assert.throws(()=>read(incomplete,'미평가',null,'red'),/body_incomplete/);
});

test('cloned agent can echo status and grade only when both agree with dedicated enum',()=>{
 const value={...body(),studio_decision:'match',grade:'6등급'};
 assert.equal(read(value).final_grade,6);
 assert.equal(Object.hasOwn(read(value).body,'grade'),false);
 value.grade='1등급';assert.throws(()=>read(value),/duplicate_grade_source/);
 value.grade='6등급';value.studio_decision='mismatch';assert.throws(()=>read(value),/duplicate_grade_source/);
});


const legacyBody=()=>({request_id:'R40',contract_id:'C40',evaluation_status:'mismatch',basic_comparison_branch:'mismatch',requested_ratio:.9,
 date_check:{...check},outstanding_check:{...check},available_check:{...check},reason:'기본정보 불일치'});
const legacyResponse=()=>response(legacyBody(),'1등급','red');
test('legacy Instruct shape retains per-field Validate metadata from actual API stages',()=>{
 const result=readStudioDecision(legacyResponse(),ids);
 assert.equal(result.final_grade,1);
 assert.equal(result.body.validation.basic.checks[0].passed,false);
 assert.equal(result.body.validation.input.verdict,'green');
 assert.equal(acceptStudioDecision({decision:'1등급',body:result.body,...ids}).final_grade,1);
 const contradictory=structuredClone(result.body);contradictory.basic_comparison_branch='match';
 assert.throws(()=>acceptStudioDecision({decision:'1등급',body:contradictory,...ids}),/evidence_inconsistent/);
});
test('legacy Validate conflicts and duplicate metadata fail without fabricating field results',()=>{
 const conflict=legacyResponse();conflict.output[1].content[0].text=JSON.stringify('green');
 assert.throws(()=>readStudioDecision(conflict,ids),/validation_evidence/);
 const duplicate=legacyResponse();duplicate.output.push(duplicate.output[1]);
 assert.throws(()=>readStudioDecision(duplicate,ids),/validation_stage/);
 const malformed=legacyResponse();malformed.output[1].content[0].additional_values=JSON.stringify({verdict:'red',checks:[]});
 assert.throws(()=>readStudioDecision(malformed,ids),/validation_evidence/);
 const absent=legacyResponse();absent.output=absent.output.filter(s=>s.model.startsWith('Instruct'));
 assert.equal(readStudioDecision(absent,ids).body.validation,undefined);
});


test('cited prose after a single JSON fence and nested string encoding preserve the validated decision',()=>{
 const fenced='```json\n'+JSON.stringify(body())+'\n```\n\n- 문서 대조 근거입니다.【†1】';
 for(const text of [fenced,JSON.stringify(fenced),JSON.stringify(JSON.stringify(fenced))]) {
  const value=response();value.output.at(-1).content[0].text=text;
  const accepted=readStudioDecision(value,ids);
  assert.equal(accepted.final_grade,6);assert.equal(accepted.body.date_check.status,'match');
  assert.equal(accepted.body.validation.basic.checks.length,1);
 }
});

test('multiple JSON blocks and conflicting decoded evidence never acquire a confirmed result',()=>{
 const fenced='```json\n'+JSON.stringify(body())+'\n```';
 for(const trailing of ['\n```json\n'+JSON.stringify(body())+'\n```','\n'+JSON.stringify(body())]) {
  const value=response();value.output.at(-1).content[0].text=fenced+trailing;
  assert.throws(()=>readStudioDecision(value,ids),/json_ambiguous/);
 }
 const conflict=body();conflict.checks.date.status='mismatch';
 const value=response();value.output.at(-1).content[0].text='```json\n'+JSON.stringify(conflict)+'\n```\n- 설명입니다.';
 assert.throws(()=>readStudioDecision(value,ids),/evidence_inconsistent/);
 const wrongId=body();wrongId.contract_id='another-contract';
 value.output.at(-1).content[0].text='```json\n'+JSON.stringify(wrongId)+'\n```\n- 설명입니다.';
 assert.throws(()=>readStudioDecision(value,ids),/identity_mismatch/);
});
