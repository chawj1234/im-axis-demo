/** Server-only preparation boundary. Jobs do not prove collection Export storage. */
export class StudioConnectionError extends Error {
  constructor(code, {stage, reference, uncertain = false, retryable = false} = {}) {
    super(code);
    this.name = 'StudioConnectionError';
    this.code = code;
    this.stage = stage;
    this.reference = reference;
    this.uncertain = uncertain;
    this.retryable = retryable;
  }
}

const patterns = {
  file_id: /^file[-_][A-Za-z0-9_-]+$/,
  job_id: /^job_[A-Za-z0-9_-]+$/,
  agent_id: /^agt_[A-Za-z0-9_-]+$/,
  config_id: /^(?:[1-9]\d{0,8}|cfg_[A-Za-z0-9_-]+)$/,
  collection_id: /^scol_[A-Za-z0-9_-]+$/,
};
const validId = (key, value) => typeof value === 'string' && patterns[key].test(value);
const statusOf = response => ['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'].includes(response?.status)
  ? response.status : 'uncertain';

export function createStudioConnection({client, workflows} = {}) {
  if (typeof window !== 'undefined') throw new StudioConnectionError('studio_server_only');
  if (!client || ['upload', 'create', 'retrieve'].some(method => typeof client[method] !== 'function')) {
    throw new StudioConnectionError('studio_client_invalid');
  }
  // Copy pins now: caller mutations must never silently change an in-flight workflow.
  const pins = {};
  for (const kind of ['contract', 'request']) {
    const workflow = workflows?.[kind];
    if (workflow === undefined) continue;
    const mode = workflow?.configMode ?? 'pinned';
    const selectionValid = mode === 'latest' ? workflow?.configId === undefined
      : mode === 'pinned' && validId('config_id', workflow?.configId);
    const pin = {agent_id: workflow?.agentId, config_id: mode === 'latest' ? null : workflow?.configId,
      collection_id: workflow?.collectionId, ...(mode === 'latest' ? {config_mode: mode} : {})};
    if (!selectionValid || !validId('agent_id', pin.agent_id) || !validId('collection_id', pin.collection_id)) {
      throw new StudioConnectionError('studio_configuration_invalid');
    }
    pins[kind] = Object.freeze(pin);
  }
  if (Object.keys(pins).length === 0) throw new StudioConnectionError('studio_configuration_invalid');
  function base(kind) {
    if (!Object.hasOwn(pins, kind)) throw new StudioConnectionError('studio_kind_invalid');
    return {kind, ...pins[kind], collection_status: 'unconfirmed'};
  }
  function safeError(stage, reference, error, mutation) {
    return new StudioConnectionError(`studio_${stage}_failed`, {
      stage, reference: Object.freeze({...reference}),
      uncertain: mutation ? error?.definitive !== true : false,
      retryable: mutation ? false : error?.retryable === true,
    });
  }
  return Object.freeze({
    async start({kind, bytes, filename} = {}) {
      let reference = {...base(kind), processing_status: 'uncertain',
        ...(pins[kind].config_mode === 'latest' ? {resolved_config_id: null} : {})};
      let file;
      try { file = await client.upload(bytes, filename); }
      catch (error) { throw safeError('upload', reference, error, true); }
      if (!validId('file_id', file?.id)) throw safeError('upload', reference, null, true);
      reference = {...reference, file_id: file.id};
      let response;
      try {
        response = await client.create({fileId: file.id, agentId: reference.agent_id,
          ...(reference.config_mode === 'latest' ? {configMode: 'latest'} : {configId: reference.config_id})});
      } catch (error) { throw safeError('create', reference, error, true); }
      if (!validId('job_id', response?.id)) throw safeError('create', reference, null, true);
      if (reference.config_mode === 'latest' && response.config_id != null) {
        if (!validId('config_id', response.config_id)) throw safeError('create', {...reference, job_id: response.id}, null, true);
        reference.resolved_config_id = response.config_id;
      }
      return Object.freeze({...reference, job_id: response.id, processing_status: statusOf(response)});
    },
    async retrieve(reference) {
      const pinned = base(reference?.kind);
      if (['agent_id', 'config_id', 'collection_id'].some(key => reference[key] !== pinned[key])
        || (reference.config_mode ?? 'pinned') !== (pinned.config_mode ?? 'pinned')
        || (pinned.config_mode === 'latest' && reference.resolved_config_id != null && !validId('config_id', reference.resolved_config_id))
        || !validId('file_id', reference?.file_id) || !validId('job_id', reference?.job_id)) {
        throw new StudioConnectionError('studio_reference_invalid');
      }
      const safeReference = {...pinned, file_id: reference.file_id, job_id: reference.job_id,
        ...(pinned.config_mode === 'latest' ? {resolved_config_id: reference.resolved_config_id ?? null} : {}),
        processing_status: 'uncertain'};
      let response;
      try { response = await client.retrieve(safeReference.job_id); }
      catch (error) { throw safeError('retrieve', safeReference, error, false); }
      if (!response || response.id !== safeReference.job_id) {
        throw new StudioConnectionError('studio_job_identity_mismatch', {stage: 'retrieve', reference: Object.freeze(safeReference)});
      }
      if ((Object.hasOwn(response, 'model') && response.model !== safeReference.agent_id)
        || (pinned.config_mode !== 'latest' && Object.hasOwn(response, 'config_id') && response.config_id !== safeReference.config_id)
        || (pinned.config_mode === 'latest' && response.config_id != null
          && (!validId('config_id', response.config_id) || (safeReference.resolved_config_id !== null && safeReference.resolved_config_id !== response.config_id)))) {
        throw new StudioConnectionError('studio_job_workflow_mismatch', {stage: 'retrieve', reference: Object.freeze(safeReference)});
      }
      if (pinned.config_mode === 'latest' && response.config_id != null) safeReference.resolved_config_id = response.config_id;
      return Object.freeze({...safeReference, processing_status: statusOf(response), response});
    },
  });
}
