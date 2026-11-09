/** Collection membership confirms storage. The web intake journal establishes origin. */
export function studioWebRecords({runtime, client, env}) {
  const collections = {
    request: env.STUDIO_RESULT_COLLECTION_ID || 'scol_AOhAgiu2xEtdGSQ8eaLvtdKZAECvLY69McrjFXCHDDc',
    contract: env.STUDIO_REGISTERED_CONTRACT_COLLECTION_ID || 'scol_6g-Mc4eJ09AyjJDpK4fxU2C28WgzalwKF1GizESaWL0',
  };
  let membership, pending, expires = 0;

  async function readMembership() {
    if (membership && Date.now() < expires) return membership;
    pending ??= Promise.all(Object.entries(collections).map(async ([kind, id]) => {
      const files = await client.collectionFiles(id);
      const jobs = new Set();
      for (const file of files) {
        if (file.status !== 'completed') continue;
        if (!/^job_[A-Za-z0-9_-]+$/.test(file.studio?.job_id || '')) throw Error('studio_collection_job_missing');
        jobs.add(file.studio.job_id);
        for (const jobId of file.studio.job_ids ?? []) jobs.add(jobId);
      }
      return [kind, jobs];
    })).then(entries => {
      membership = Object.fromEntries(entries);
      expires = Date.now() + 30000;
      return membership;
    }).finally(() => {pending = undefined;});
    return pending;
  }

  return async function state(session, role = 'admin') {
    const sessions = await runtime.store.sessions();
    const [stored, records] = await Promise.all([
      readMembership(), Promise.all(sessions.map(id => runtime.store.read(id))),
    ]);
    const visible = new Map();
    for (const record of records) {
      for (const job of record.jobs) {
        const isStored = job.processing_status === 'completed' && !job.document_routing_required
          && stored[job.kind]?.has(job.studio_job_id);
        // Keep this session's pending/failed/unexported receipts visible. Export
        // confirmation enriches a receipt; it must not erase its processing state.
        if (record.session_id !== session && !isStored) continue;
        visible.set(job.id, {
          ...job, collection_status: isStored ? 'stored' : 'unconfirmed',
          document_id: record.session_id === session ? job.document_id : '',
        });
      }
    }
    return runtime.projectState(session, role, [...visible.values()]);
  };
}
