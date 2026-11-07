import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StudioRuntime} from '../lib/studio-runtime.mjs';

const session = 'session_1234';
const workflows = {request: {agentId: 'agt_request', configMode: 'latest', collectionId: 'scol_execution'}};
const file = {bytes: Buffer.from('%PDF-test'), filename: '요청.pdf', pages: 1};
const clock = () => new Date('2026-11-03T02:00:00Z');
const body = {request_id: 'request-A', contract_id: 'contract-A', reason: '일치',
  evaluation_status: 'match', basic_comparison_branch: 'match', requested_ratio: 0.2,
  ...Object.fromEntries(['date_check', 'outstanding_check', 'available_check'].map(key => [key, {status: 'match', basis: '원문 근거'}]))};
const stage = (model, value, additional_values) => ({model, status: 'completed', content: [{type: 'output_text', text: JSON.stringify(value), additional_values}]});
const completed = () => ({id: 'job_test', model: 'agt_request', config_id: '3', status: 'completed',
  output: [stage('extract-request', {request_id: 'request-A', contract_id: 'contract-A'}), stage('instruct-compare', body, {enum: '6등급'})]});
async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-runtime-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const calls = {upload: 0, create: 0, retrieve: []};
  const client = {async upload() { calls.upload++; return {id: 'file_test'}; },
    async create(options) { calls.create++; assert.equal(options.configMode, 'latest'); assert.equal(Object.hasOwn(options, 'configId'), false); return {id: 'job_test', status: 'queued'}; },
    async retrieve(id) { calls.retrieve.push(id); return completed(); }, ...overrides};
  return {root, calls, client, runtime: new StudioRuntime({root, client, workflows, clock})};
}
test('receipt-only intake, concurrent dedup, authorized documents and safe banker projection', async t => {
  const {runtime, calls} = await setup(t);
  const results = await Promise.all([runtime.submit({session, kind: 'request', file}), runtime.submit({session, kind: 'request', file})]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal(calls.upload, 0);
  const receipt = results[0].job;
  assert.match(receipt.id, /^REQ-/);
  assert.equal((await runtime.readDocument(session, receipt.document_id)).bytes.toString(), '%PDF-test');
  await assert.rejects(runtime.readDocument('other_session', receipt.document_id), /studio_document_not_found/);
  await runtime.tick(); await runtime.tick();
  const admin = await runtime.state(session);
  assert.equal(admin.jobs[0].id, receipt.id);
  assert.equal(admin.jobs[0].grade, 6);
  assert.equal(admin.jobs[0].checks.length, 3);
  assert.equal(admin.jobs[0].collection_status, 'unconfirmed');
  assert.equal(admin.jobs[0].resolved_config_id, '3');
  assert.equal(admin.summary.counts.total, 1);
  assert.equal(admin.summary.counts.match, 1);
  const banker = await runtime.state(session, {role: 'banker'});
  assert.equal(banker.jobs[0].grade, null); assert.equal(banker.jobs[0].reason, null);
  assert.equal(banker.jobs[0].document_contract_id, null); assert.deepEqual(banker.jobs[0].checks, []);
  assert.equal(banker.summary, null);
  assert.equal(JSON.stringify(admin).includes('output_text'), false);
});
test('journals each external mutation before call and saves job before polling', async t => {
  const env = await setup(t);
  env.client.upload = async () => {
    const job = (await env.runtime.store.read(session)).jobs[0];
    assert.equal(job.processing_status, 'uploading'); return {id: 'file_test'};
  };
  env.client.create = async () => {
    const job = (await env.runtime.store.read(session)).jobs[0];
    assert.equal(job.processing_status, 'creating'); assert.equal(job.file_id, 'file_test');
    return {id: 'job_test', status: 'queued'};
  };
  env.client.retrieve = async () => {
    assert.equal((await env.runtime.store.read(session)).jobs[0].studio_job_id, 'job_test');
    return completed();
  };
  await env.runtime.submit({session, kind: 'request', file}); await env.runtime.tick(); await env.runtime.tick();
  assert.equal((await env.runtime.state(session)).jobs[0].grade, 6);
});
test('restart unresolved upload/create never mutates again', async t => {
  for (const status of ['uploading', 'creating']) {
    const {runtime, calls} = await setup(t);
    await runtime.submit({session, kind: 'request', file});
    await runtime.store.update(session, record => { record.jobs[0].processing_status = status; });
    await runtime.tick(); await runtime.tick();
    assert.equal((await runtime.state(session)).jobs[0].processing_status, 'uncertain');
    assert.equal(calls.create + calls.upload, 0);
  }
});
test('restart polls known job with original workflow despite changed deployment', async t => {
  const {runtime, root, calls, client} = await setup(t);
  await runtime.submit({session, kind: 'request', file}); await runtime.tick();
  const replacement = new StudioRuntime({root, client, clock, workflows: {request: {agentId: 'agt_new', configMode: 'latest'}}});
  await replacement.tick(); await replacement.tick();
  assert.equal((await replacement.state(session)).jobs[0].grade, 6);
  assert.equal(calls.create, 1); assert.deepEqual(calls.retrieve, ['job_test']);
});
test('unknown mutation, per-job isolation, safe errors, and retryable poll transport', async t => {
  const {runtime, calls, client} = await setup(t);
  await runtime.submit({session, kind: 'request', file});
  client.upload = async () => { throw Error('secret provider PII'); };
  await runtime.tick(); await runtime.tick();
  let state = await runtime.state(session);
  assert.equal(state.jobs[0].processing_status, 'uncertain');
  assert.equal(JSON.stringify(state).includes('secret'), false);
  client.upload = async () => ({id: 'file_test'});
  await runtime.submit({session, kind: 'request', file: {...file, bytes: Buffer.from('%PDF-other')}});
  await runtime.tick();
  client.retrieve = async () => { throw Error('provider secret'); };
  await runtime.tick();
  state = await runtime.state(session);
  assert.equal(state.jobs.filter(job => job.processing_status === 'queued').length, 1);
  client.retrieve = async () => completed();
  await runtime.tick();
  assert.equal((await runtime.state(session)).jobs.filter(job => job.grade === 6).length, 1);
  assert.equal(calls.create, 1);
});
test('wrong document routing is not graded or counted and needs no Extract', async t => {
  const {runtime, client} = await setup(t);
  client.retrieve = async () => ({id: 'job_test', status: 'completed', output: [
    stage('instruct-문서종류-안내', {request_id: null, contract_id: null, reason: '요청서를 제출하세요',
      reason_code: 'wrong_document_type', evaluation_status: 'incomplete'}, {enum: '미평가'}),
  ]});
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  const state = await runtime.state(session);
  assert.equal(state.jobs[0].document_routing_required, true);
  assert.equal(state.jobs[0].grade, null); assert.equal(state.jobs[0].evaluation_status, 'not_applicable');
  assert.equal(state.summary.counts.total, 0);
});
test('Extract identity independent of decision, missing IDs are never guessed', async t => {
  const {runtime, client} = await setup(t);
  client.retrieve = async () => {
    const response = completed(); response.output[0] = stage('extract-request', {request_id: 'different', contract_id: 'contract-A'});
    return response;
  };
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  const job = (await runtime.state(session)).jobs[0];
  assert.equal(job.processing_status, 'failed'); assert.equal(job.grade, null);
});
test('input limits and optional contract kind, no invalid receipt', async t => {
  const {runtime} = await setup(t);
  for (const invalid of [{...file, pages: 21}, {...file, pages: 0}, {...file, filename: '../x.pdf'}, {...file, bytes: Buffer.from('not-pdf')}]) {
    await assert.rejects(runtime.submit({session, kind: 'request', file: invalid}), /studio_pdf_invalid/);
  }
  await assert.rejects(runtime.submit({session: '../escape', kind: 'request', file}), /studio_session_invalid/);
  await assert.rejects(runtime.submit({session, kind: 'contract', file}), /studio_kind_unconfigured/);
  assert.equal((await runtime.state(session)).jobs.length, 0);
});
test('tick coalesces callers and cross-instance lock prevents duplicate mutation', async t => {
  const {runtime, root, client, calls} = await setup(t);
  await runtime.submit({session, kind: 'request', file});
  const other = new StudioRuntime({root, client, workflows, clock});
  await Promise.all([runtime.tick(), runtime.tick(), other.tick()]);
  assert.equal(calls.upload, 1); assert.equal(calls.create, 1);
});
test('contract analysis does not assert collection storage or request grading', async t => {
  const env = await setup(t);
  const runtime = new StudioRuntime({root: env.root, client: {...env.client,
    create: async () => ({id: 'job_contract', status: 'completed'})},
    workflows: {contract: {agentId: 'agt_contract', configMode: 'latest'}}, clock});
  await runtime.submit({session, kind: 'contract', file}); await runtime.tick();
  const state = await runtime.state(session);
  assert.equal(state.jobs[0].evaluation_status, 'not_applicable');
  assert.equal(state.jobs[0].processing_status, 'completed');
  assert.equal(state.jobs[0].collection_status, 'unconfirmed');
  assert.equal(state.summary.counts.total, 0);
});
test('pinned workflow remains pinned and explicit null IDs remain unevaluated', async t => {
  const {root, client} = await setup(t);
  client.create = async options => {
    assert.equal(options.configId, '2'); assert.equal(options.configMode, undefined);
    return {id: 'job_test', status: 'queued', config_id: '2'};
  };
  client.retrieve = async () => ({id: 'job_test', status: 'completed', config_id: '2', output: [
    stage('extract-request', {request_id: null, contract_id: null}),
    stage('instruct-compare', {request_id: null, contract_id: null, reason: '필수 항목 누락', evaluation_status: 'incomplete'}, {enum: '미평가'}),
  ]});
  const runtime = new StudioRuntime({root, client, clock, workflows: {request: {...workflows.request, configMode: 'pinned', configId: '2'}}});
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  const state = await runtime.state(session);
  assert.equal(state.jobs[0].evaluation_status, 'incomplete');
  assert.equal(state.jobs[0].document_request_id, null); assert.equal(state.jobs[0].grade, null);
  assert.equal(state.summary.counts.incomplete, 1);
});
test('mismatched returned job/workflow/config never becomes successful', async t => {
  for (const change of [{id: 'job_wrong'}, {model: 'agt_wrong'}, {config_id: 'bad-config'}]) {
    const {runtime, client} = await setup(t);
    client.retrieve = async () => ({...completed(), ...change});
    await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
    const state = await runtime.state(session);
    assert.equal(state.jobs[0].processing_status, 'failed');
    assert.equal(state.jobs[0].grade, null); assert.equal(state.summary.counts.failed, 1);
  }
});
test('definitive create rejection retains file ID but never retries', async t => {
  const {runtime, client} = await setup(t);
  let creates = 0;
  client.create = async () => { creates++; throw Object.assign(Error('private'), {definitive: true, code: 'studio_authentication_failed'}); };
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  const stored = (await runtime.store.read(session)).jobs[0];
  assert.equal(stored.file_id, 'file_test'); assert.equal(stored.processing_status, 'failed');
  assert.equal(creates, 1);
});
test('unexecuted routing branch cannot suppress valid Extract identity', async t => {
  const {runtime, client} = await setup(t);
  client.retrieve = async () => {
    const response = completed();
    response.output.push({model: 'instruct-문서종류-안내', status: 'skipped', content: []});
    return response;
  };
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  assert.equal((await runtime.state(session)).jobs[0].grade, 6);
});
test('mocked HTTP client upload → latest creation → retrieval → decision/report', async t => {
  const {createStudioClient} = await import('../lib/studio-client.mjs');
  const {root} = await setup(t);
  const requests = [];
  const client = createStudioClient({apiKey: 'test-only-not-a-real-key', fetchImpl: async (url, options) => {
    requests.push({url, options});
    if (url.endsWith('/files')) return Response.json({id: 'file_test'});
    if (options.method === 'POST') {
      const value = JSON.parse(options.body);
      assert.equal(value.model, 'agt_request');
      assert.equal(Object.hasOwn(value, 'config_id'), false);
      return Response.json({id: 'job_test', status: 'queued'});
    }
    assert.match(url, /responses\/job_test\?/);
    return Response.json(completed());
  }});
  const runtime = new StudioRuntime({root, client, workflows, clock});
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  const state = await runtime.state(session);
  assert.equal(state.jobs[0].grade, 6); assert.equal(state.summary.counts.match, 1);
  assert.equal(requests.length, 3);
});
test('document ID is a stable session/kind-scoped SHA256 matching HTTP gate', async t => {
  const {runtime} = await setup(t);
  const first = await runtime.submit({session, kind: 'request', file});
  const duplicate = await runtime.submit({session, kind: 'request', file});
  const other = await runtime.submit({session: 'session_other', kind: 'request', file});
  assert.match(first.job.document_id, /^[a-f0-9]{64}$/);
  assert.equal(first.job.document_id, duplicate.job.document_id);
  assert.notEqual(first.job.document_id, other.job.document_id);
});
test('corrupt session and lock/update failure cannot starve another session', async t => {
  const {runtime} = await setup(t);
  const {writeFile} = await import('node:fs/promises');
  await runtime.submit({session: 'z_good_session', kind: 'request', file});
  await writeFile(runtime.store.path('a_corrupt_session'), '{broken');
  await runtime.tick(); await runtime.tick();
  assert.equal((await runtime.state('z_good_session')).jobs[0].grade, 6);
  await assert.rejects(runtime.state('a_corrupt_session'));
  await runtime.submit({session: 'b_locked_session', kind: 'request', file});
  await runtime.submit({session: 'z_next_session', kind: 'request', file});
  const originalUpdate = runtime.store.update.bind(runtime.store);
  runtime.store.update = (name, action) => name === 'b_locked_session' ? Promise.reject(Error('lock unavailable')) : originalUpdate(name, action);
  await runtime.tick(); await runtime.tick();
  assert.equal((await runtime.state('z_next_session')).jobs[0].grade, 6);
});
test('exact empty Extract IDs normalize to null only for unevaluated decisions', async t => {
  const {runtime, client} = await setup(t);
  client.retrieve = async () => ({id: 'job_test', status: 'completed', output: [
    stage('extract-request', {request_id: '', contract_id: ''}),
    stage('instruct-compare', {request_id: null, contract_id: null, reason: '누락', evaluation_status: 'incomplete'}, {enum: '미평가'}),
  ]});
  await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
  const state = await runtime.state(session);
  assert.equal(state.jobs[0].evaluation_status, 'incomplete');
  assert.equal(state.jobs[0].document_request_id, null);
  assert.equal(state.summary.counts.incomplete, 1);
});
test('top-level mode reflects fixed workflow selection', async t => {
  const {root, client} = await setup(t);
  const runtime = new StudioRuntime({root, client, workflows: {request: {agentId: 'agt_fixed', configId: '2'}}, clock});
  assert.equal((await runtime.state(session)).configuration_mode, 'pinned');
});
test('nonempty malformed IDs and missing IDs on graded results fail closed', async t => {
  for (const requestId of ['', ' ', 0, {}]) {
    const {runtime, client} = await setup(t);
    client.retrieve = async () => {
      const response = completed();
      response.output[0] = stage('extract-request', {request_id: requestId, contract_id: 'contract-A'});
      return response;
    };
    await runtime.submit({session, kind: 'request', file}); await runtime.tick(); await runtime.tick();
    const job = (await runtime.state(session)).jobs[0];
    assert.equal(job.processing_status, 'failed'); assert.equal(job.grade, null);
  }
});

test('malformed Instruct body keeps a verified enum and marks missing evidence', async t => {
  const response = completed();
  response.output[0] = stage('extract-request', {request_id: 'request-A', contract_id: 'contract-A', requested_amount_krw: 35000000});
  const match = stage('Match - 매칭-1', {등록계약: [{contract_id: 'contract-A', credit_limit_krw: 600000000}]});
  const instruct = stage('Instruct - 추가검사-기본일치', {}, {enum: '6등급'});
  instruct.content[0].text = '{"reason":"닫히지 않은 설명}';
  response.output.splice(1, 1, match, stage('Validate - 요청-기본대조', 'green'), instruct);
  const {runtime} = await setup(t, {retrieve: async () => response});
  await runtime.submit({session, kind: 'request', file});
  await runtime.tick();
  await runtime.tick();
  const {jobs: [job], summary} = await runtime.state(session);
  assert.equal(job.grade, 6);
  assert.equal(job.partial_evidence, true);
  assert.equal(job.reason, '추가 검사 근거 확인 필요');
  assert.equal(job.matched_contract.credit_limit_krw, 600000000);
  assert.ok(job.checks.every(check => check.status === 'unknown'));
  assert.equal(summary.counts.match, 1);

  match.content[0].text = JSON.stringify({등록계약: [{contract_id: 'unrelated'}]});
  assert.throws(() => runtime.applyResponse(session, {kind: 'request'}, response), /studio_output_json_invalid/);
});
