/** Server-only transport for the documented Upstage Files / Jobs APIs. */
export class StudioApiError extends Error {
  constructor(code, {httpStatus, uncertain = false, retryable = false} = {}) {
    super(code);
    this.name = 'StudioApiError';
    this.code = code;
    this.http_status = httpStatus;
    this.uncertain = uncertain;
    this.retryable = retryable;
    this.definitive = !uncertain;
  }
}

export function createStudioClient({apiKey, projectId, fetchImpl = fetch, timeoutMs = 40000} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new StudioApiError('studio_api_key_missing');
  if (projectId !== undefined && !/^proj_[A-Za-z0-9_-]+$/.test(projectId)) throw new StudioApiError('studio_project_id_invalid');
  const base = 'https://api.upstage.ai/v2';
  async function call(path, {method = 'GET', body, json = false} = {}) {
    const mutation = method !== 'GET';
    let response;
    try {
      response = await fetchImpl(base + path, {
        method, body,
        headers: {Authorization: 'Bearer ' + apiKey, ...(projectId ? {'x-project-id': projectId} : {}), ...(json ? {'Content-Type': 'application/json'} : {})},
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // A lost creation/upload response is not evidence that the server did nothing.
      throw new StudioApiError('studio_transport_unconfirmed', {uncertain: mutation, retryable: !mutation});
    }
    if (!response.ok) {
      const status = response.status;
      throw new StudioApiError(status === 401 || status === 403 ? 'studio_authentication_failed'
        : status === 429 ? 'studio_rate_limited' : 'studio_http_error', {
        httpStatus: status, uncertain: mutation && status >= 500,
        retryable: status === 429 || (!mutation && status >= 500),
      });
    }
    try {
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      return value;
    } catch {
      throw new StudioApiError('studio_response_invalid', {uncertain: mutation, retryable: !mutation});
    }
  }
  return {
    async collectionFiles(collectionId) {
      if (!/^scol_[A-Za-z0-9_-]+$/.test(collectionId || '')) throw new StudioApiError('studio_collection_id_invalid');
      const files = [];
      const cursors = new Set();
      let after = '';
      for (;;) {
        const page = await call('/vector_stores/' + encodeURIComponent(collectionId) + '/files?limit=100'
          + (after ? '&after=' + encodeURIComponent(after) : ''));
        if (!Array.isArray(page.data) || typeof page.has_more !== 'boolean') throw new StudioApiError('studio_collection_page_invalid');
        files.push(...page.data);
        if (!page.has_more) return files;
        after = page.last_id;
        if (typeof after !== 'string' || !after || cursors.has(after)) throw new StudioApiError('studio_collection_cursor_invalid');
        cursors.add(after);
      }
    },
    async upload(bytes, filename = 'document.pdf') {
      if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 25 * 1024 * 1024
        || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new StudioApiError('studio_pdf_invalid');
      const safeName = String(filename).replace(/[\r\n/\\]/g, '_').slice(0, 180);
      const form = new FormData();
      form.set('file', new File([new Uint8Array(bytes)], safeName, {type: 'application/pdf'}));
      form.set('purpose', 'user_data');
      const value = await call('/files', {method: 'POST', body: form});
      if (!/^file[-_][A-Za-z0-9_-]+$/.test(value.id || '')) throw new StudioApiError('studio_file_id_unconfirmed', {uncertain: true});
      return value;
    },
    async create({fileId, agentId, configId, configMode = 'pinned'}) {
      const selectionValid = configMode === 'latest' ? configId === undefined
        : configMode === 'pinned' && typeof configId === 'string' && /^(?:[1-9]\d{0,8}|cfg_[A-Za-z0-9_-]+)$/.test(configId);
      if (!/^file[-_][A-Za-z0-9_-]+$/.test(fileId || '') || !/^agt_[A-Za-z0-9_-]+$/.test(agentId || '')
        || !selectionValid) {
        throw new StudioApiError('studio_configuration_invalid');
      }
      const value = await call('/responses', {method: 'POST', json: true, body: JSON.stringify({
        model: agentId, ...(configMode === 'pinned' ? {config_id: configId} : {}), include: ['all'],
        input: [{role: 'user', content: [{type: 'input_file', file_id: fileId}]}],
      })});
      if (!/^job_[A-Za-z0-9_-]+$/.test(value.id || '')) throw new StudioApiError('studio_job_id_unconfirmed', {uncertain: true});
      return value;
    },
    async retrieve(jobId) {
      if (!/^job_[A-Za-z0-9_-]+$/.test(jobId || '')) throw new StudioApiError('studio_job_id_invalid');
      const value = await call('/responses/' + encodeURIComponent(jobId) + '?include%5B%5D=all');
      if (value.id !== jobId) throw new StudioApiError('studio_job_identity_mismatch');
      return value;
    },
  };
}
