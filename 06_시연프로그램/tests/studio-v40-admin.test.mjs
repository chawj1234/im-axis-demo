import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as format from '../lib/operations-format.ts';
import * as model from '../lib/operations-model.ts';
import {normalizeStudioOperationsState} from '../lib/studio-operations-model.mjs';
const file=new URL('../components/admin-dashboard.tsx',import.meta.url),local=createRequire(file);
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',compiled+'\nmodule.exports.TestDetail = RequestDetail;')(id=>id.endsWith('.css')?{}:id==='../lib/operations-format'?format:id==='../lib/operations-model'?model:id==='./document-viewer'?()=>null:local(id),mod,mod.exports);
test('v40 incomplete validation opens the existing required-information panel with actual failures',()=>{
 const session='v40_admin_session';const job={id:'receipt-v40',kind:'request',filename:'request.pdf',document_id:'document-v40',received_at:new Date().toISOString(),updated_at:new Date().toISOString(),processing_status:'completed',evaluation_status:'incomplete',grade:null,configuration_mode:'latest',basic_comparison:'unknown',validation:{input:{verdict:'red',checks:[{name:'등록계약 contract_id 존재',passed:false,reason:'등록계약 조회값이 비어 있습니다.'}]},basic:null}};
 const request=normalizeStudioOperationsState({provider:'studio',session_id:session,configuration_mode:'latest',jobs:[job]},session).requests[0];
 const html=renderToStaticMarkup(createElement(mod.exports.TestDetail,{request,onBack(){}}));
 assert.match(html,/등록계약 조회값이 비어 있습니다/);assert.match(html,/등록계약 contract_id 존재/);
 assert.match(html,/id="adm-comparison-tab" aria-selected="true"/);
 assert.doesNotMatch(html,/id="adm-comparison-panel"[^>]*hidden/);
 assert.doesNotMatch(html,/Studio 검증 결과에서 확인해 주세요/);
});


test('dashboard keeps chart visible with remaining criteria collapsed',async()=>{
 const {operationsMetrics}=await import('../lib/operations-model.ts');
 const metrics=operationsMetrics([]);
 const html=renderToStaticMarkup(createElement(mod.exports.default,{requests:[],metrics,selectedId:null,onSelectRequest(){}}));
 assert.match(html,/문서 대조 등급별 요청 분포/);
 assert.match(html,/<section class="adm-panel adm-field-panel" aria-labelledby="adm-field-chart-title">/);
 assert.match(html,/<details class="adm-field-more">/);
 assert.match(html,/나머지 12개 항목 펼치기/);
 assert.doesNotMatch(html,/기본 대조 9개 · 추가 검사 3개|adm-field-track|adm-field-intro|전체 요청 기준|adm-metrics-scope|adm-charts-scope/);
 assert.equal((html.match(/class="adm-field-row"/g)||[]).length,12);
 assert.doesNotMatch(html,/<details class="adm-analytics"/);
});

function dashboardHarness(requests) {
 const React=local('react'), states=[];let cursor=0;
 const mockReact={...React,useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useMemo:fn=>fn(),useRef:initial=>({current:initial}),useEffect(){}};
 const loaded={exports:{}};
 new Function('require','module','exports',compiled)(id=>id==='react'?mockReact:id.endsWith('.css')?{}:id==='../lib/operations-format'?format:id==='../lib/operations-model'?model:id==='./document-viewer'?()=>null:local(id),loaded,loaded.exports);
 return {render(){cursor=0;return loaded.exports.default({requests,metrics:model.operationsMetrics(requests),selectedId:null,onSelectRequest(){}});}};
}
function nodes(tree,predicate) {
 if(!tree||typeof tree!=='object')return [];
 return [...(predicate(tree)?[tree]:[]),...[tree.props?.children].flat(Infinity).flatMap(child=>nodes(child,predicate))];
}
function chartRequest(id,grade,mismatches=[],overrides={}) {
 const definitions=[['basic_comparison','기본정보 종합 대조'],...model.operationsMetrics([]).mismatchFields.map(f=>[f.key,f.label])];
 return {id,receiptId:id,contractId:'contract-a',contractReference:'A',companyName:id,receivedAt:'2026-11-09T00:00:00Z',
  grade,processing:'completed',requestedAmount:100,contractAmount:1000,ratio:10,files:[],logs:[],policyVersion:'studio-enum-comparison-v1',
  studio:{decision:grade===null?'미평가':`${grade}등급`},
  checks:definitions.map(([key,label])=>({key,label,status:(key==='basic_comparison'&&mismatches.length)||mismatches.includes(key)?'mismatch':'match',contractValue:'값',requestValue:'값'})),...overrides};
}
const gradeButton=(tree,grade)=>nodes(tree,n=>n.type==='button'&&n.props.className?.startsWith('adm-grade-column')&&n.props['aria-label'].startsWith(`${grade}등급 `))[0];
const fieldButton=(tree,key)=>nodes(tree,n=>n.type==='button'&&n.props.className==='adm-field-row'&&n.props['aria-label'].startsWith(key+':'))[0];
const requestRows=tree=>nodes(tree,n=>n.type==='tr'&&n.props.className?.startsWith('adm-request-row')).map(row=>row.key);

test('linked chart grade and field selections share evidence, counts and list membership',t=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>0;t.after(()=>{if(previous)globalThis.requestAnimationFrame=previous;else delete globalThis.requestAnimationFrame;});
 const requests=[chartRequest('account',1,['payout_account']),chartRequest('holder',1,['payout_holder']),chartRequest('lower',5,['payout_account']),chartRequest('match',6)];
 const ui=dashboardHarness(requests);let tree=ui.render();
 assert.equal(fieldButton(tree,'수취계좌').props.children[1].props.children,'2건');
 gradeButton(tree,1).props.onClick();tree=ui.render();
 assert.equal(gradeButton(tree,1).props['aria-pressed'],true);
 assert.equal(fieldButton(tree,'수취계좌').props.children[1].props.children,'1건');
 assert.deepEqual(requestRows(tree),['account','holder']);
 fieldButton(tree,'수취계좌').props.onClick();tree=ui.render();
 assert.deepEqual(requestRows(tree),['account']);
 assert.equal(fieldButton(tree,'수취계좌').props['aria-pressed'],true);
 const chip=nodes(tree,n=>n.props.className==='adm-active-filter'&&n.props.children[0]==='수취계좌')[0];
 assert.ok(chip);chip.props.onClick();tree=ui.render();assert.deepEqual(requestRows(tree),['account','holder']);
 gradeButton(tree,6).props.onClick();tree=ui.render();
 assert.deepEqual(requestRows(tree),['match']);
 assert.equal(fieldButton(tree,'수취계좌').props.disabled,true);
 gradeButton(tree,6).props.onClick();tree=ui.render();assert.equal(requestRows(tree).length,4);
});

test('search and contract scope apply consistently to chart counts and matching requests',()=>{
 const requests=[chartRequest('alpha',1,['payout_account']),chartRequest('beta',5,['payout_holder'],{contractId:'contract-b',contractReference:'B'})];
 const ui=dashboardHarness(requests);let tree=ui.render();
 nodes(tree,n=>n.type==='input'&&n.props.type==='search')[0].props.onChange({target:{value:'beta'}});tree=ui.render();
 assert.equal(gradeButton(tree,1).props.children[0].props.children,'0');
 assert.equal(fieldButton(tree,'수취계좌').props.disabled,true);
 assert.equal(fieldButton(tree,'수취계좌 예금주').props.children[1].props.children,'1건');
 assert.deepEqual(requestRows(tree),['beta']);
 nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'contract-a'}});tree=ui.render();
 assert.equal(requestRows(tree).length,0);
 assert.equal(fieldButton(tree,'수취계좌 예금주').props.disabled,true);
});

test('incomplete, failed and unresolved results cannot appear in field drill-down',t=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>0;t.after(()=>{if(previous)globalThis.requestAnimationFrame=previous;else delete globalThis.requestAnimationFrame;});
 const requests=[chartRequest('known',1,['payout_account']),chartRequest('incomplete',null,['payout_account']),chartRequest('failed',null,['payout_account'],{processing:'failed'}),chartRequest('pending',null,['payout_account'],{processing:'processing'})];
 const ui=dashboardHarness(requests);let tree=ui.render();
 assert.equal(fieldButton(tree,'수취계좌').props.children[1].props.children,'1건');
 fieldButton(tree,'수취계좌').props.onClick();tree=ui.render();assert.deepEqual(requestRows(tree),['known']);
 const status=nodes(tree,n=>n.type==='button'&&n.props.children?.[0]==='전체')[0];status.props.onClick();tree=ui.render();
 assert.equal(requestRows(tree).length,4);assert.equal(fieldButton(tree,'수취계좌').props['aria-pressed'],false);
});


test('only fields with confirmed mismatches appear outside the collapsed remainder',()=>{
 const ui=dashboardHarness([chartRequest('account',1,['payout_account']),chartRequest('match',6)]);
 const tree=ui.render();
 const lists=nodes(tree,n=>n.props.role==='list');
 const visible=lists.find(n=>n.props['aria-label']==='불일치가 발생한 대조 항목');
 const other=lists.find(n=>n.props['aria-label']==='불일치가 확인되지 않은 나머지 대조 항목');
 assert.equal(nodes(visible,n=>n.props.className==='adm-field-row').length,1);
 assert.equal(fieldButton(visible,'수취계좌').props.children[1].props.children,'1건');
 assert.equal(nodes(other,n=>n.props.className==='adm-field-row').length,11);
 const details=nodes(tree,n=>n.type==='details'&&n.props.className==='adm-field-more')[0];
 assert.equal(details.props.open,undefined);
 assert.equal(nodes(details,n=>n.props.className==='adm-field-show')[0].props.children.join(''),'나머지 11개 항목 펼치기');
});

test('zero mismatches and missing evidence remain distinct in the field summary',()=>{
 for(const [requests,message] of [[[], '아직 집계할 대조 결과가 없습니다.'],[[chartRequest('match',6)],'선택한 범위에 불일치 항목이 없습니다.']]) {
  const tree=dashboardHarness(requests).render();
  assert.equal(nodes(tree,n=>n.props.className==='adm-field-empty')[0].props.children,message);
  assert.equal(nodes(tree,n=>n.props['aria-label']==='불일치가 발생한 대조 항목').length,0);
 }
 const missing=chartRequest('missing',1,[]);missing.checks=missing.checks.filter(c=>c.key==='basic_comparison'||['credit_period','outstanding_arithmetic','available_arithmetic'].includes(c.key));missing.checks[0].status='mismatch';
 const tree=dashboardHarness([missing]).render();
 assert.equal(nodes(tree,n=>n.props.className==='adm-field-empty')[0].props.children,'확인된 항목에서 불일치가 없습니다.');
});


test('detail shows actual mismatched values without aggregate judgment or provider expressions',()=>{
 const request=chartRequest('account',1,['payout_account']);
 request.studio.reason='요청금액 90000000, 등록계약 한도 100000000, 비율 0.9 최종 상태 mismatch';
 request.checks.find(c=>c.key==='basic_comparison').note='요청금액 90000000, 등록계약 한도 100000000, 비율 0.9 최종 상태 mismatch';
 Object.assign(request.checks.find(c=>c.key==='payout_account'),{label:'입금계좌 일치',contractValue:'9906100101011',requestValue:'9906100101099',note:'request-extract-v2.destination_account → 매칭-1.target.deposit_account → fail'});
 request.checks.find(c=>c.key==='company_name').status='unknown';
 const html=renderToStaticMarkup(createElement(mod.exports.TestDetail,{request,onBack(){}}));
 assert.match(html,/<h3>수취계좌<\/h3>/);
 assert.match(html,/9906100101011/);assert.match(html,/9906100101099/);
 assert.doesNotMatch(html,/기본정보 종합 대조|최종 상태 mismatch|request-extract-v2|target.deposit_account|Studio 전용 결정값/);
 assert.match(html,/확인 필요 항목 1개/);
 assert.match(html,/일치 항목 10개/);
 assert.match(html,/항목별 대조<span>12<\/span>/);
});
