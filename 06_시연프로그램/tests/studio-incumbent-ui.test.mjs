import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as format from '../lib/operations-format.ts';
import * as model from '../lib/operations-model.ts';
import * as screen from '../lib/studio-screen-types.ts';
const require=createRequire(import.meta.url), React=require('react');
const Child=()=>null;
function load(name, overrides={}) {
  const file=new URL('../components/'+name+'.tsx',import.meta.url), local=createRequire(file);
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',compiled)(id=>id.endsWith('.css')?{}:id==='../lib/operations-format'?format:overrides[id]||local(id),mod,mod.exports);
  return mod.exports.default;
}
const config={enabled:true,configuration_mode:'latest',kinds:{request:true,contract:false}};
const props={receipts:[],contracts:[],canSubmit:true,onRegisterContract:async()=>{},onSubmitRequest:async()=>{},onContinueDocument:async()=>{}};
const Banker=load('banker-intake');
const render=(Component,props)=>renderToStaticMarkup(createElement(Component,props));
test('Studio preserves full styled intake, defaults request without local contract or fabricated registration',()=>{
  const html=render(Banker,{...props,requestMatching:'studio',enabledKinds:config.kinds});
  for(const text of ['bki-dropzone','bki-workflow','접수번호 또는 파일명 검색','요청서의 계약번호로 Studio','계약 등록 Agent 미설정'])assert.ok(html.includes(text),text);
  assert.match(html,/실행 요청서 PDF를 여기에 놓아주세요/);
  assert.doesNotMatch(html,/bki-contract-empty|bki-contract-picker|먼저 계약서를 접수/);
  assert.match(html,/disabled=""[^>]*>계약 등록/);
  assert.match(render(Banker,props),/계약서 PDF를 여기에 놓아주세요/);
});
test('Studio banker receipt shows truthful processing label and no continuation action',()=>{
  const html=render(Banker,{...props,requestMatching:'studio',enabledKinds:config.kinds,receipts:[{id:'receipt-1',kind:'request',status:'received',fileNames:['wrong.pdf'],receivedAt:'2026-11-03T00:00:00Z',stateLabel:'문서 종류 확인 필요 · 대조 대상 아님',routing:{detectedKind:'contract',canContinue:false,message:'계약서를 확인해 주세요.'}}]});
  assert.match(html,/문서 종류 확인 필요 · 대조 대상 아님/);
  assert.match(html,/자동 전환은 지원하지 않습니다/);
  assert.doesNotMatch(html,/계약 등록으로 이어가기|이 계약으로 요청 접수/);
});
function harness(properties={}) {
  const states=[],refs=[];let cursor=0,refCursor=0,effects=[],callbacks=[];
  const Workspace=load('operations-workspace',{
    react:{...React,useState:initial=>{const i=cursor++;if(!(i in states))states[i]=i===1?'test-session':typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useMemo:fn=>fn(),useCallback:fn=>{callbacks.push(fn);return fn;},useEffect:fn=>effects.push(fn)},
    'next/image':Child,'./admin-dashboard':Child,'./banker-intake':Child,'./staff-alert-banner':Child,'./document-review-actions':{DocumentRetryAction:Child},'./daily-report-panel':Child,'./studio-coworker-panel':{StudioCoworkerPanel:Child},
    '../lib/studio-screen-types':screen,'../lib/operations-model':model,'../lib/operations-fixtures':{operationsPreviewSnapshot:{}},
  });
  return {render(){cursor=0;refCursor=0;effects=[];callbacks=[];return Workspace({role:'banker',studioConfig:config,...properties});},refresh(){return callbacks[0]();},configEffect(){return effects[0]();},states};
}
function find(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const result=find(child,predicate);if(result)return result;}}
const state={provider:'studio',session_id:'test-session',jobs:[],configuration_mode:'latest',summary:null};
test('actual incumbent refresh enforces Studio endpoint and session isolation; stale data survives errors',async t=>{
  const ui=harness();const urls=[];let response=state;
  t.mock.method(globalThis,'fetch',async url=>{urls.push(String(url));return {ok:true,json:async()=>response};});
  ui.render();await ui.refresh();
  assert.equal(ui.states[6],true);assert.equal(ui.states[0].receipts.length,0);assert.match(urls[0],/api\/studio\/state\?session=test-session&role=banker/);
  const snapshot=ui.states[0];response={...state,session_id:'other-session'};
  ui.render();await ui.refresh();assert.equal(ui.states[0],snapshot);assert.equal(ui.states[4],false);assert.match(ui.states[2],/불러오지 못했습니다/);
});
test('config loading and failure keep original navigation and block state and legacy calls',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected');});
  for(const connection of [{connectionPending:true},{connectionError:true}]){
    const ui=harness({...connection,studioConfig:undefined});const tree=ui.render();await ui.refresh();
    assert.ok(find(tree,node=>node.props?.className==='ops-sidebar'));assert.ok(find(tree,node=>node.props?.className==='ops-nav-active'));assert.ok(find(tree,node=>node.props?.className==='ops-role-links'));
  }
  assert.equal(calls,0);
});
test('actual Studio intake posts only PDF and session and blocks unconfigured contract',async t=>{
  const ui=harness(), calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>options?.method==='POST'?{ok:true,receipt_id:'receipt-new',received_at:'2026-11-03T00:00:00Z'}:state};});
  const tree=ui.render(), intake=find(tree,node=>typeof node.props?.onSubmitRequest==='function');
  const file=new File(['%PDF-test'],'request.pdf',{type:'application/pdf'});
  await intake.props.onSubmitRequest(file,'ignored-contract');
  const post=calls.find(call=>call.options?.method==='POST');assert.match(post.url,/api\/studio\/intake\?kind=request&session=test-session/);assert.deepEqual([...post.options.body.keys()],['session_id','file']);
  await assert.rejects(()=>intake.props.onRegisterContract(file),/Studio 연결 설정/);
  await assert.rejects(()=>intake.props.onContinueDocument('receipt-1'),/올바른 경로/);
  assert.equal(calls.filter(call=>call.options?.method==='POST').length,1);
});

test('connected wrapper rejects a non-Studio configuration without mounting an alternate provider',async t=>{
 const states=[];let cursor=0,effect;
 const Connected=load('connected-operations-workspace',{
  react:{...React,useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect:fn=>{effect=fn;}},
  './operations-workspace':Child,'../lib/studio-screen-types':screen,
 });
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({lifecycle_intake:{enabled:true}})}));
 Connected({role:'banker'});const cleanup=effect();await new Promise(resolve=>setImmediate(resolve));cursor=0;
 const tree=Connected({role:'banker'});assert.equal(tree.props.connectionError,true);assert.equal(tree.props.connectionPending,false);assert.equal(tree.props.studioConfig,undefined);assert.equal(tree.key,'connecting');cleanup();
});
