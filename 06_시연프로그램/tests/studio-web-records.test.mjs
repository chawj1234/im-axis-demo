import test from 'node:test';
import assert from 'node:assert/strict';
import {studioWebRecords} from '../lib/studio-web-records.mjs';

test('current pending, failed, uncertain, wrong-document and unexported receipts remain visible', async () => {
  const own = ['received', 'queued', 'failed', 'uncertain', 'completed'].map((status, i) => ({
    id: 'own-' + i, kind: 'request', processing_status: status, studio_job_id: status === 'received' ? null : 'job_own' + i,
    document_id: 'document-' + i, collection_status: 'unconfirmed',
  }));
  own.push({id: 'wrong-doc', kind: 'request', processing_status: 'completed', document_routing_required: true});
  const other = [{id: 'other-stored', kind: 'request', processing_status: 'completed', studio_job_id: 'job_stored', document_id: 'hidden'},
    {id: 'other-pending', kind: 'request', processing_status: 'queued', studio_job_id: 'job_pending'}];
  const records = {own: {session_id: 'own', jobs: own}, other: {session_id: 'other', jobs: other}};
  const runtime = {store: {async sessions() {return Object.keys(records);}, async read(id) {return records[id];}},
    projectState(session, role, jobs) {return {session, role, jobs};}};
  const client = {async collectionFiles(id) {return id === 'scol_result' ? [{status: 'completed', studio: {job_id: 'job_stored'}}] : [];}};
  const read = studioWebRecords({runtime, client, env: {STUDIO_RESULT_COLLECTION_ID: 'scol_result', STUDIO_REGISTERED_CONTRACT_COLLECTION_ID: 'scol_contract'}});
  const state = await read('own', 'admin');
  assert.deepEqual(state.jobs.map(job => job.id), [...own.map(job => job.id), 'other-stored']);
  assert.ok(state.jobs.slice(0, own.length).every(job => job.collection_status === 'unconfirmed'));
  assert.equal(state.jobs.at(-1).document_id, '');
  assert.equal(state.jobs.at(-1).collection_status, 'stored');
});

test('a collection read failure is an error, never an apparently successful empty result', async () => {
  const read = studioWebRecords({env: {}, runtime: {store: {async sessions() {return [];}}},
    client: {async collectionFiles() {throw Error('studio_authentication_failed');}}});
  await assert.rejects(read('own'), /studio_authentication_failed/);
});
