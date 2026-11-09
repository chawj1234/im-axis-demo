import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createServer} from 'node:net';
import {readTeamSettings, assertFreePort} from '../scripts/team-demo.mjs';
import {createStudioClient} from '../lib/studio-client.mjs';

const template = parseEnv(await readFile(new URL('../.env.team.example', import.meta.url), 'utf8'));
const settings = () => ({...template, UPSTAGE_API_KEY: 'test-only-never-a-real-key'});

test('both submitted workflows create new jobs without a pinned config_id', async () => {
  const chosen = readTeamSettings(settings());
  const calls = [];
  const client = createStudioClient({apiKey: chosen.env.UPSTAGE_API_KEY, projectId: chosen.env.STUDIO_PROJECT_ID,
    fetchImpl: async (url, options) => {
      calls.push({url, body: JSON.parse(options.body), project: options.headers['x-project-id']});
      return Response.json({id: 'job_test', status: 'queued'});
    }});
  for (const workflow of Object.values(chosen.workflows)) {
    await client.create({fileId: 'file-test', agentId: workflow.agentId, configMode: workflow.configMode});
  }
  assert.deepEqual(calls.map(call => call.body.model), ['agt_dfaNnfcPV4YFViycgD62ou', 'agt_knWWp6FZnD4fqgUewAFNNG']);
  for (const call of calls) {
    assert.equal(Object.hasOwn(call.body, 'config_id'), false);
    assert.equal(call.project, template.STUDIO_PROJECT_ID);
  }
  assert.equal(chosen.workflows.request.collectionId, template.STUDIO_RESULT_COLLECTION_ID);
  assert.equal(chosen.workflows.contract.collectionId, template.STUDIO_REGISTERED_CONTRACT_COLLECTION_ID);
});

test('missing credentials, malformed references, ports and stale pins fail with field names only', () => {
  for (const [key, value] of [['UPSTAGE_API_KEY', ''], ['STUDIO_REQUEST_AGENT_ID', 'wrong'],
    ['STUDIO_CONTRACT_AGENT_ID', ''], ['STUDIO_RESULT_COLLECTION_ID', 'wrong'],
    ['STUDIO_REGISTERED_CONTRACT_COLLECTION_ID', ''], ['STUDIO_WEB_PORT', '0'],
    ['STUDIO_PROJECT_ID', 'wrong'], ['STUDIO_CONFIG_MODE', 'pinned'], ['STUDIO_REQUEST_CONFIG_ID', '27']]) {
    assert.throws(() => readTeamSettings({...settings(), [key]: value}), error => {
      assert.ok(!error.message.includes('test-only-never-a-real-key'));
      assert.match(error.message, new RegExp(key));
      return true;
    });
  }
});

test('file upload, job create/retrieve and collection reads keep the same Studio project scope', async () => {
  const headers = [];
  const client = createStudioClient({apiKey: 'test-only', projectId: template.STUDIO_PROJECT_ID, fetchImpl: async (url, options) => {
    headers.push(options.headers);
    if (url.endsWith('/files') && options.method === 'POST') return Response.json({id: 'file_test'});
    if (url.includes('/vector_stores/')) return Response.json({data: [], has_more: false});
    return Response.json({id: 'job_test', status: 'queued'});
  }});
  await client.upload(Buffer.from('%PDF-test'));
  await client.create({fileId: 'file_test', agentId: template.STUDIO_REQUEST_AGENT_ID, configMode: 'latest'});
  await client.retrieve('job_test');
  await client.collectionFiles(template.STUDIO_RESULT_COLLECTION_ID);
  assert.equal(headers.length, 4);
  assert.ok(headers.every(header => header['x-project-id'] === template.STUDIO_PROJECT_ID));
  assert.throws(() => createStudioClient({apiKey: 'test', projectId: 'bad\r\nheader'}), /studio_project_id_invalid/);
});

test('team server uses a local private store and local API even if the shell selected public sharing', () => {
  const chosen = readTeamSettings({...settings(), DEMO_PUBLIC_API: 'enabled', NEXT_PUBLIC_DEMO_API_BASE: 'https://wrong.example',
    STUDIO_PRIVATE_ROOT: '/unexpected', STUDIO_COWORKER_ID: ''});
  assert.equal(chosen.env.DEMO_PUBLIC_API, 'disabled');
  assert.equal(chosen.env.NEXT_PUBLIC_DEMO_API_BASE, '');
  assert.match(chosen.env.STUDIO_PRIVATE_ROOT, /\.local-private\/team-demo$/);
  assert.equal(chosen.coworkerEnabled, false);
});

test('occupied port is reported instead of silently opening a different address', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(assertFreePort(server.address().port), /포트를 사용 중/);
});
