import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {studioApi, studioWorkflows} from '../lib/studio-api.mjs';
import {StudioRuntime} from '../lib/studio-runtime.mjs';

const workflows = {request: {agentId: 'agt_request', configMode: 'latest', collectionId: 'scol_request'}};
const check = {status: 'match', basis: '원문 기준'};
const body = {request_id: 'PDF-REQ-001', contract_id: 'PDF-CON-001', evaluation_status: 'mismatch',
  basic_comparison_branch: 'mismatch', requested_ratio: 0.9, reason: '문서 불일치', date_check: check,
  outstanding_check: check, available_check: check};
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-http-'));
  const calls = [];
  const client = {
    async upload() {calls.push('upload');return {id: 'file-test'};},
    async create(input) {calls.push(input);return {id: 'job_test', status: 'queued'};},
    async retrieve(id) {calls.push('retrieve');return {id, model: 'agt_request', config_id: '2', status: 'completed', output: [
      {model: 'step_3_extract', status: 'completed', content: [{type: 'output_text', text: JSON.stringify({request_id: body.request_id, contract_id: body.contract_id,
        requester_name: '화면검증기업', requested_amount_krw: 540000000, credit_limit_krw: 123})}]},
      {model: 'step_4_match', status: 'completed', content: [{type: 'output_text', text: JSON.stringify({'등록계약': [{contract_id: body.contract_id, credit_limit_krw: 600000000}]})}]},
      {model: 'Instruct - 추가검사-기본불일치', status: 'completed', content: [{type: 'output_text', text: JSON.stringify(body), additional_values: JSON.stringify({enum: '1등급'})}]},
    ]};},
  };
  const runtime = new StudioRuntime({root, client, workflows});
  let handler;
  const server = createServer((req, res) => {void handler(req, res, () => {res.statusCode = 404;res.end();});});
  const plugin = studioApi({env: {}, runtime, workflows, inspectPages: async () => 1, renderPage: async () => Buffer.from('mock-png'), ...options});
  plugin.configureServer({httpServer: server, config: {logger: {error() {}}}, middlewares: {use(fn) {handler = fn;}}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve));await rm(root, {recursive: true, force: true});});
  return {root, runtime, calls, handler, base: 'http://127.0.0.1:' + server.address().port};
}
const form = (session = 'studio-http-test', content = '%PDF-mock') => {
  const value = new FormData();value.set('session_id', session);
  value.set('file', new File([content], 'request.pdf', {type: 'application/pdf'}));return value;
};

test('environment selects latest explicitly; bad/missing fixed pins never silently fall back', () => {
  const settings = studioWorkflows({});
  assert.equal(settings.request.configMode, 'latest');
  assert.equal(settings.request.agentId, 'agt_CcQNGGZpEr9VYGLj3wmqZm');
  assert.equal(Object.hasOwn(settings.request, 'configId'), false);
  assert.equal(settings.contract, undefined);
  assert.throws(() => studioWorkflows({STUDIO_CONFIG_MODE: 'pinned'}), /configuration_invalid/);
  assert.throws(() => studioWorkflows({STUDIO_REQUEST_CONFIG_ID: '1'}), /latest_config_conflict/);
  assert.equal(studioWorkflows({STUDIO_CONFIG_MODE: 'pinned', STUDIO_REQUEST_CONFIG_ID: '1'}).request.configId, '1');
});

test('HTTP multipart receipt → durable Job → role-sensitive state and authorized PDF', async t => {
  const {base, runtime, calls} = await fixture(t);
  const config = await (await fetch(base + '/api/config')).json();
  assert.equal(config.execution_provider, 'studio');assert.equal(config.studio.kinds.contract, false);
  const response = await fetch(base + '/api/studio/intake?session=studio-http-test&kind=request', {method: 'POST', body: form()});
  assert.equal(response.status, 202);
  const receipt = await response.json();assert.equal(receipt.ok, true);
  let state;
  for (let i = 0; i < 20; i++) {
    await runtime.tick();
    state = await (await fetch(base + '/api/studio/state?session=studio-http-test&role=admin')).json();
    if (state.jobs[0]?.processing_status === 'completed') break;
    await delay(20);
  }
  assert.equal(state.jobs[0].id, receipt.receipt_id);
  assert.equal(state.jobs[0].grade, 1);
  assert.equal(state.jobs[0].collection_status, 'unconfirmed');
  assert.equal(state.jobs[0].resolved_config_id, '2');
  assert.equal(state.jobs[0].request_fields.requester_name, '화면검증기업');
  assert.equal(state.jobs[0].matched_contract.credit_limit_krw, 600000000);
  assert.equal(state.summary.counts.completed, 1);
  const banker = await (await fetch(base + '/api/studio/state?session=studio-http-test&role=banker')).json();
  assert.equal(banker.jobs[0].grade, null);assert.equal(banker.jobs[0].reason, null);
  assert.equal(banker.jobs[0].request_fields, null);assert.equal(banker.jobs[0].matched_contract, null);
  const isolated = await (await fetch(base + '/api/studio/state?session=another-session&role=admin')).json();
  assert.equal(isolated.jobs.length, 0);
  const documentPath = '/api/studio/document?session=studio-http-test&id=' + state.jobs[0].document_id;
  const document = await fetch(base + documentPath);assert.equal(document.status, 200);
  assert.equal(await document.text(), '%PDF-mock');
  const info = await (await fetch(base + documentPath + '&info=1')).json();
  assert.equal(info.pages, 1);assert.equal(info.filename, 'request.pdf');
  const image = await fetch(base + documentPath + '&page=1');assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(await image.text(), 'mock-png');
  assert.equal((await fetch(base + documentPath + '&page=2')).status, 400);
  assert.equal((await fetch(base + documentPath.replace('studio-http-test', 'another-session'))).status, 400);
  const duplicate = await (await fetch(base + '/api/studio/intake?session=studio-http-test&kind=request', {method: 'POST', body: form()})).json();
  assert.equal(duplicate.duplicate, true);assert.equal(duplicate.receipt_id, receipt.receipt_id);
  assert.equal(calls.filter(call => call === 'upload').length, 1);
  const creates = calls.filter(call => typeof call === 'object');assert.equal(creates.length, 1);
  assert.equal(creates[0].configMode, 'latest');assert.equal(Object.hasOwn(creates[0], 'configId'), false);
});

test('origin/session/shape/PDF validation and unavailable contract stop before provider calls', async t => {
  const {base, calls} = await fixture(t);
  const intake = base + '/api/studio/intake?session=studio-http-test&kind=request';
  assert.equal((await fetch(intake, {method: 'POST', headers: {Origin: 'https://unrelated.test'}, body: form()})).status, 403);
  assert.equal((await fetch(intake, {method: 'POST', body: form('different-session')})).status, 400);
  assert.equal((await fetch(intake, {method: 'POST', body: form('studio-http-test', 'not-pdf')})).status, 400);
  const extra = form();extra.set('contract_id', 'legacy-uuid');
  assert.equal((await fetch(intake, {method: 'POST', body: extra})).status, 400);
  assert.equal((await fetch(intake.replace('kind=request', 'kind=contract'), {method: 'POST', body: form()})).status, 503);
  assert.equal((await fetch(base + '/api/studio/state?session=studio-http-test&role=customer')).status, 400);
  assert.equal((await fetch(base + '/api/studio/document?session=studio-http-test&id=../private')).status, 404);
  assert.deepEqual(calls, []);
});

test('missing server key is unavailable, not a successful empty state or legacy fallback', async t => {
  const {base} = await fixture(t, {runtime: undefined, env: {}});
  const config = await (await fetch(base + '/api/config')).json();
  assert.equal(config.execution_provider, 'studio');assert.equal(config.studio.enabled, false);
  assert.equal((await fetch(base + '/api/studio/state?session=studio-http-test')).status, 503);
});

test('malformed request URL is caught as a safe response, not an unhandled middleware rejection', async t => {
  const {handler} = await fixture(t);
  const response = {statusCode: 0, setHeader() {}, end(body) {this.body = body;}};
  await handler({url: 'http://[', method: 'GET', headers: {}}, response, () => assert.fail('must not fall through'));
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.stringify(response).includes('ERR_INVALID_URL'), false);
});

test('review questions and reports query linked contract/results even with no local receipts', async t => {
  const prompts = [];
  const {base} = await fixture(t, {
    env: {STUDIO_COWORKER_ID: 'cw_team'},
    askCoworker: async ({input}) => {prompts.push(input); return '[조회 범위]\n검색한 일부 자료\n[계약·요청 확인]\nREQ-001 요청금액 원문 확인 필요\n[원문 확인 필요]\nREQ-001의 요청금액을 원문에서 확인하세요.';},
  });
  for (const mode of ['coworker', 'report']) {
    const response = await fetch(base + '/api/studio/' + mode + '?session=studio-http-test', {
      method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'},
      body: JSON.stringify({question: '원문 확인이 필요한 필드를 알려줘'}),
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).answer, /REQ-001/);
  }
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.match(prompt, /현재 이 동료에 연결된 등록계약과 등급결정결과/);
    assert.doesNotMatch(prompt, /vs_|scol_/);
    assert.match(prompt, /날짜 조건 없이/);
    assert.doesNotMatch(prompt, /컬렉션이나 검색 도구를 사용하지|저장일 필터/);
  }
});

test('collection report errors do not become successful empty reports and cross-origin calls are blocked', async t => {
  let calls = 0;
  const {base} = await fixture(t, {
    env: {STUDIO_COWORKER_ID: 'cw_team'},
    askCoworker: async () => {calls++; throw Error('coworker_turn_failed');},
  });
  const path = base + '/api/studio/report?session=studio-http-test';
  assert.equal((await fetch(path, {method: 'POST', headers: {Origin: 'https://unrelated.test'}})).status, 403);
  assert.equal(calls, 0);
  const response = await fetch(path, {method: 'POST', headers: {Origin: base}});
  assert.equal(response.status, 502);
  assert.ok((await response.json()).error);
  assert.equal(calls, 1);
});


test('incomplete model output is rejected as a failed report rather than shown as success', async t => {
  const {base} = await fixture(t, {
    env: {STUDIO_COWORKER_ID: 'cw_team'},
    askCoworker: async () => '[조회 범위] 불완전한 응답',
  });
  const response = await fetch(base + '/api/studio/report?session=studio-http-test', {method: 'POST', headers: {Origin: base}});
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /보고서 응답이 불완전/);
  assert.equal(body.answer, undefined);
});
