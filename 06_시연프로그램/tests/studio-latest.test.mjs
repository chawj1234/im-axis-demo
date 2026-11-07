import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioClient} from '../lib/studio-client.mjs';
import {createStudioConnection} from '../lib/studio-connection.mjs';

const workflows = () => ({
  contract: {agentId: 'agt_contract', configId: '1', collectionId: 'scol_contract'},
  request: {agentId: 'agt_request', configMode: 'latest', collectionId: 'scol_request'},
});
const pdf = new TextEncoder().encode('%PDF-test');

test('explicit latest mode omits config_id instead of sending null, empty or latest', async () => {
  const requests = [];
  const client = createStudioClient({apiKey: 'mock-only', fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body)); return Response.json({id: 'job_test', status: 'queued'});
  }});
  await client.create({fileId: 'file-test', agentId: 'agt_request', configMode: 'latest'});
  assert.equal(Object.hasOwn(requests[0], 'config_id'), false);
  assert.equal(requests[0].model, 'agt_request');
  assert.deepEqual(requests[0].include, ['all']);
  await client.create({fileId: 'file-test', agentId: 'agt_request', configId: '1'});
  assert.equal(requests[1].config_id, '1');
});

test('missing or invalid fixed config never silently enables latest', async () => {
  let calls = 0;
  const client = createStudioClient({apiKey: 'mock-only', fetchImpl: async () => {calls++;}});
  for (const options of [{}, {configMode: 'typo'}, {configId: ''}, {configId: 'latest'},
    {configMode: 'latest', configId: '1'}, {configMode: 'latest', configId: null}]) {
    await assert.rejects(client.create({fileId: 'file-test', agentId: 'agt_request', ...options}), /configuration_invalid/);
  }
  assert.equal(calls, 0);
});

test('latest Job references track selected mode and server-reported version without assuming it', async () => {
  const calls = [];
  const client = {
    async upload() {return {id: 'file-test'};},
    async create(options) {calls.push(options); return {id: 'job_test', status: 'queued'};},
    async retrieve(id) {return {id, model: 'agt_request', config_id: '2', status: 'completed'};},
  };
  const connection = createStudioConnection({client, workflows: workflows()});
  const reference = await connection.start({kind: 'request', bytes: pdf});
  assert.equal(reference.config_mode, 'latest');
  assert.equal(reference.config_id, null);
  assert.equal(reference.resolved_config_id, null);
  assert.deepEqual(calls, [{fileId: 'file-test', agentId: 'agt_request', configMode: 'latest'}]);
  const result = await connection.retrieve(JSON.parse(JSON.stringify(reference)));
  assert.equal(result.resolved_config_id, '2');
  assert.equal(reference.resolved_config_id, null); // Persist the returned reference explicitly.
  assert.equal(result.collection_status, 'unconfirmed');
});

test('absent/null returned version stays unknown, not guessed from last verified version', async () => {
  for (const metadata of [{}, {config_id: null}]) {
    const client = {
      async upload() {return {id: 'file-test'};},
      async create() {return {id: 'job_test', status: 'queued', ...metadata};},
      async retrieve(id) {return {id, status: 'completed', ...metadata};},
    };
    const connection = createStudioConnection({client, workflows: workflows()});
    const result = await connection.retrieve(await connection.start({kind: 'request', bytes: pdf}));
    assert.equal(result.resolved_config_id, null);
  }
});

test('new latest jobs may use a newer version; polling an existing job never creates another', async () => {
  let creations = 0, uploads = 0;
  const client = {
    async upload() {uploads++;return {id: 'file-test'};},
    async create() {creations++;return {id: `job_${creations}`, status: 'queued', config_id: String(creations)};},
    async retrieve(id) {return {id, status: 'completed', config_id: id === 'job_1' ? '1' : '2'};},
  };
  const connection = createStudioConnection({client, workflows: workflows()});
  const old = await connection.start({kind: 'request', bytes: pdf});
  const newer = await connection.start({kind: 'request', bytes: pdf});
  assert.equal(newer.resolved_config_id, '2');
  assert.equal((await connection.retrieve(old)).resolved_config_id, '1');
  assert.equal(uploads, 2);
  assert.equal(creations, 2);
  client.retrieve = async id => ({id, config_id: '3', status: 'completed'});
  await assert.rejects(connection.retrieve(old), /workflow_mismatch/);
  assert.equal(creations, 2);
});

test('latest selection is validated before upload, including conflicting config and invalid mode', () => {
  const client = {upload() {throw Error('must not run');}, create() {}, retrieve() {}};
  for (const overrides of [{configMode: 'typo'}, {configMode: 'latest', configId: '1'},
    {configMode: 'latest', configId: null}]) {
    const inputs = workflows();Object.assign(inputs.request, overrides);
    assert.throws(() => createStudioConnection({client, workflows: inputs}), /configuration_invalid/);
  }
});

test('only configured document kinds are available; contract is not silently aliased to request', async () => {
  const client = {async upload() {return {id: 'file-test'};}, async create() {return {id: 'job_test'};}, async retrieve() {}};
  const connection = createStudioConnection({client, workflows: {request: workflows().request}});
  await assert.rejects(connection.start({kind: 'contract', bytes: pdf}), /kind_invalid/);
  assert.equal((await connection.start({kind: 'request', bytes: pdf})).config_mode, 'latest');
  assert.throws(() => createStudioConnection({client, workflows: {}}), /configuration_invalid/);
});
