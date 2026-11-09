import {createHash, randomUUID} from 'node:crypto';
import {RecordStore, validSession} from './record-store.mjs';
import {acceptStudioDecision, readStudioDecision, studioOutputStages} from './studio-decision.mjs';
import {projectStudioDecision} from './studio-view.mjs';
import {summarizeStudioReport} from './studio-report-summary.mjs';

const id = (prefix, value) => typeof value === 'string' && new RegExp('^' + prefix + '[A-Za-z0-9_-]+$').test(value);
const configId = value => typeof value === 'string' && /^(?:[1-9]\d{0,8}|cfg_[A-Za-z0-9_-]+)$/.test(value);
const terminal = new Set(['completed', 'failed', 'uncertain']);
const error = code => Object.assign(new Error(code), {code});
const safeCode = (value, fallback) => /^studio_[a-z_]+$/.test(value?.code || '') ? value.code : fallback;
const identifier = value => value === null || (typeof value === 'string' && value.trim().length > 0);

/** Server-only, journaled execution. Never retries a mutation with an unknown outcome. */
export class StudioRuntime {
  constructor({root, client, workflows, clock = () => new Date()} = {}) {
    if (!root || !client || ['upload', 'create', 'retrieve'].some(key => typeof client[key] !== 'function')) throw error('studio_runtime_configuration_invalid');
    this.store = new RecordStore(root);
    this.client = client;
    this.clock = clock;
    this.workflows = {};
    for (const kind of ['contract', 'request']) {
      const workflow = workflows?.[kind];
      if (!workflow) continue;
      const mode = workflow.configMode ?? 'pinned';
      if (!id('agt_', workflow.agentId) || !['latest', 'pinned'].includes(mode)
        || (mode === 'latest' ? workflow.configId !== undefined : !configId(workflow.configId))
        || (workflow.collectionId != null && !id('scol_', workflow.collectionId))) throw error('studio_configuration_invalid');
      this.workflows[kind] = Object.freeze({agent_id: workflow.agentId, configuration_mode: mode,
        config_id: mode === 'latest' ? null : workflow.configId, collection_id: workflow.collectionId ?? null});
    }
    this.running = null;
  }
  now() { return new Date(this.clock()).toISOString(); }
  async submit({session, kind, file, received_at} = {}) {
    if (!validSession(session)) throw error('studio_session_invalid');
    if (!Object.hasOwn(this.workflows, kind)) throw error('studio_kind_unconfigured');
    if (!(file?.bytes instanceof Uint8Array) || file.bytes.length < 5 || file.bytes.length > 25 * 1024 * 1024
      || Buffer.from(file.bytes.subarray(0, 5)).toString() !== '%PDF-' || !Number.isInteger(file.pages) || file.pages < 1 || file.pages > 20
      || typeof file.filename !== 'string' || !file.filename.trim() || file.filename.length > 180
      || /[\x00-\x1f\x7f/\\]/.test(file.filename) || !/\.pdf$/i.test(file.filename)) throw error('studio_pdf_invalid');
    const timestamp = received_at ?? this.now();
    if (typeof timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw error('studio_timestamp_invalid');
    const fingerprint = createHash('sha256').update(session + '\0' + kind + '\0').update(file.bytes).digest('hex');
    return this.store.update(session, record => {
      const existing = record.jobs.find(job => job.fingerprint === fingerprint);
      if (existing) return {duplicate: true, job: this.dto(existing)};
      const receipt = 'REQ-' + randomUUID();
      const job = {id: receipt, receipt_id: receipt, session_id: session, kind, fingerprint,
        filename: file.filename, pages: file.pages, document_id: fingerprint, bytes: Buffer.from(file.bytes).toString('base64'),
        received_at: new Date(timestamp).toISOString(), updated_at: this.now(), processing_status: 'received',
        evaluation_status: 'pending', collection_status: 'unconfirmed', file_id: null, studio_job_id: null,
        resolved_config_id: null, document_request_id: null, document_contract_id: null, error_code: null,
        document_routing_required: false, ...this.workflows[kind]};
      record.jobs.push(job);
      return {duplicate: false, job: this.dto(job)};
    });
  }
  tick() {
    if (this.running) return this.running;
    this.running = this.store.lock('studio-tick', async () => {
      for (const session of await this.store.sessions()) {
        let snapshot;
        try { snapshot = await this.store.read(session); }
        catch { continue; } // A corrupt session must not starve unrelated receipts.
        for (const original of snapshot.jobs) {
          if (terminal.has(original.processing_status)) continue;
          try { await this.store.update(session, async record => {
            const job = record.jobs.find(item => item.id === original.id);
            if (!job || terminal.has(job.processing_status)) return;
            try { await this.advance(session, record, job); }
            catch (failure) {
              // An unknown mutation outcome is terminal until a human reconciles it.
              const mutation = ['uploading', 'creating'].includes(job.processing_status);
              job.processing_status = mutation && failure?.definitive !== true ? 'uncertain' : 'failed';
              job.error_code = safeCode(failure, mutation ? 'studio_mutation_unconfirmed' : 'studio_result_invalid');
              job.evaluation_status = 'pending';
            }
            job.updated_at = this.now();
          }); } catch { /* Leave the durable journal intact and continue other jobs/sessions. */ }
        }
      }
    }, {tryOnly: true}).finally(() => { this.running = null; });
    return this.running;
  }
  async advance(session, record, job) {
    if (['uploading', 'creating'].includes(job.processing_status)) {
      job.processing_status = 'uncertain';
      job.error_code = 'studio_mutation_unconfirmed';
      return;
    }
    if (job.processing_status === 'received') {
      job.processing_status = 'uploading'; job.updated_at = this.now();
      await this.store.write(session, record);
      const uploaded = await this.client.upload(Buffer.from(job.bytes, 'base64'), job.filename);
      if (!id('file[-_]', uploaded?.id)) throw error('studio_file_id_unconfirmed');
      job.file_id = uploaded.id;
      job.processing_status = 'creating'; job.updated_at = this.now();
      await this.store.write(session, record);
      const response = await this.client.create({fileId: job.file_id, agentId: job.agent_id,
        ...(job.configuration_mode === 'latest' ? {configMode: 'latest'} : {configId: job.config_id})});
      if (!id('job_', response?.id)) throw error('studio_job_id_unconfirmed');
      job.studio_job_id = response.id;
      // Save the known Job before interpreting anything else, and poll by this ID only.
      job.processing_status = 'queued';
      await this.store.write(session, record);
      this.validateResponse(job, response);
      this.applyResponse(session, job, response);
      return;
    }
    let response;
    try { response = await this.client.retrieve(job.studio_job_id); }
    catch (failure) {
      job.error_code = safeCode(failure, 'studio_retrieve_failed');
      return; // Existing Job is safe to poll again; never create another Job.
    }
    this.validateResponse(job, response);
    this.applyResponse(session, job, response);
  }
  validateResponse(job, response) {
    if (response?.id !== job.studio_job_id) throw error('studio_job_identity_mismatch');
    if (response.model != null && response.model !== job.agent_id) throw error('studio_job_workflow_mismatch');
    if (response.config_id != null) {
      if (!configId(response.config_id) || (job.configuration_mode === 'pinned' && response.config_id !== job.config_id)
        || (job.resolved_config_id !== null && job.resolved_config_id !== response.config_id)) throw error('studio_job_workflow_mismatch');
      job.resolved_config_id = response.config_id;
    }
  }
  applyResponse(session, job, response) {
    job.error_code = null;
    if (['queued', 'in_progress'].includes(response.status)) { job.processing_status = response.status; return; }
    if (response.status !== 'completed') {
      job.processing_status = 'failed'; job.error_code = 'studio_analysis_failed'; return;
    }
    if (job.kind === 'contract') {
      job.processing_status = 'completed'; job.evaluation_status = 'not_applicable'; return;
    }
    // Routing is decoded before requiring Extract, as wrong-document has no request IDs.
    const routing = response.output?.some(stage => stage.status === 'completed' && /문서종류-안내$/.test(stage.model || ''));
    const stages = studioOutputStages(response, {allowMalformedInstruct: !routing});
    let expectedRequestId, expectedContractId;
    if (!routing) {
      const extracts = stages.filter(stage => /extract/i.test(stage.name || '') && stage.status === 'completed')
        .flatMap(stage => stage.contents.map(content => content.value)).filter(value => value && !Array.isArray(value)
          && Object.hasOwn(value, 'request_id') && Object.hasOwn(value, 'contract_id'));
      if (extracts.length !== 1) throw error('studio_extract_identity_invalid');
      job.request_fields = Object.fromEntries(['requester_name', 'request_id', 'contract_id', 'requested_amount_krw',
        'credit_limit_krw', 'desired_payment_date', 'fund_purpose'].filter(key => ['string', 'number'].includes(typeof extracts[0][key]))
        .map(key => [key, extracts[0][key]]));
      // Extract emits empty strings for genuinely absent fields; do not coerce arbitrary values.
      expectedRequestId = extracts[0].request_id === '' ? null : extracts[0].request_id;
      expectedContractId = extracts[0].contract_id === '' ? null : extracts[0].contract_id;
      if (!identifier(expectedRequestId) || !identifier(expectedContractId)) throw error('studio_extract_identity_invalid');
    }
    const matches = stages.filter(stage => /match/i.test(stage.name || '') && stage.status === 'completed')
      .flatMap(stage => stage.contents.flatMap(content => {
        const value = content.value?.['등록계약'];
        return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
      })).filter(value => value && typeof value === 'object' && !Array.isArray(value)
        && typeof expectedContractId === 'string' && value.contract_id === expectedContractId);
    const malformedDecision = stages.filter(stage => /instruct/i.test(stage.name || '') && stage.status === 'completed')
      .flatMap(stage => stage.contents.map(content => ({stage, content})));
    const candidate = malformedDecision.length === 1 ? malformedDecision[0] : null;
    let accepted;
    if (candidate?.content.malformed && !routing && matches.length === 1 && typeof expectedRequestId === 'string') {
      const basic = stages.filter(stage => stage.name === 'Validate - 요청-기본대조' && stage.status === 'completed')
        .flatMap(stage => stage.contents.map(content => content.value));
      const branch = basic.length === 1 && basic[0] === 'green' ? 'match'
        : basic.length === 1 && basic[0] === 'red' ? 'mismatch' : null;
      const expectedStage = branch === 'match' ? 'Instruct - 추가검사-기본일치'
        : branch === 'mismatch' ? 'Instruct - 추가검사-기본불일치' : null;
      if (!expectedStage || candidate.stage.name !== expectedStage) throw error('studio_result_invalid');
      accepted = acceptStudioDecision({decision: candidate.content.additional_values?.enum,
        expectedRequestId, expectedContractId, partialEvidence: true, body: {
          request_id: expectedRequestId, contract_id: expectedContractId,
          evaluation_status: candidate.content.additional_values?.enum === '6등급' ? 'match' : 'mismatch',
          basic_comparison_branch: branch, reason: '추가 검사 근거 확인 필요',
        }});
      accepted.partial_evidence = true;
    } else {
      accepted = readStudioDecision(response, {expectedRequestId, expectedContractId});
    }
    if (matches.length === 1) job.matched_contract = Object.fromEntries(['contract_id', 'borrower_name', 'credit_limit_krw',
      'valid_from', 'valid_to'].filter(key => ['string', 'number'].includes(typeof matches[0][key])).map(key => [key, matches[0][key]]));
    job.document_routing_required = accepted.document_routing_required === true;
    if (!job.document_routing_required) {
      job.document_request_id = expectedRequestId; job.document_contract_id = expectedContractId;
      job.view = projectStudioDecision({session, receipt: {...job, collection_id: job.collection_id}, result: accepted});
    }
    // Retain accepted decision only; no full Parse/provider response goes to disk or screen.
    job.result = {studio_decision: accepted.studio_decision, body: accepted.body, final_grade: accepted.final_grade, policy_version: accepted.policy_version, ...(accepted.partial_evidence ? {partial_evidence: true} : {})};
    job.processing_status = 'completed'; job.evaluation_status = job.document_routing_required ? 'not_applicable' : accepted.evaluation_status;
  }
  dto(job, role = 'admin') {
    const view = job.view;
    const dto = Object.fromEntries(['id', 'kind', 'filename', 'document_id', 'received_at', 'updated_at', 'processing_status',
      'evaluation_status', 'collection_status', 'document_routing_required', 'document_request_id', 'document_contract_id',
      'studio_job_id', 'configuration_mode', 'resolved_config_id', 'error_code'].map(key => [key, job[key] ?? null]));
    Object.assign(dto, {grade: view?.grade ?? null, decision_label: view?.decisionLabel ?? null,
      reason: view?.reason ?? (job.document_routing_required ? job.result?.body.reason ?? null : null),
      checks: view?.additionalChecks ?? [], basic_comparison: view?.basicComparison ?? 'unknown',
      studio_url: id('agt_', job.agent_id) ? 'https://studio.upstage.ai/agents/' + job.agent_id : null});
    dto.validation = role === 'admin' ? job.result?.body.validation ?? null : null;
    dto.purpose_review = role === 'admin' ? job.result?.body.purpose_review ?? null : null;
    dto.partial_evidence = role === 'admin' && job.result?.partial_evidence === true;
    dto.request_fields = role === 'admin' ? job.request_fields ?? null : null;
    dto.matched_contract = role === 'admin' ? job.matched_contract ?? null : null;
    dto.requested_ratio = role === 'admin' && typeof job.result?.body.requested_ratio === 'number' ? job.result.body.requested_ratio : null;
    if (role === 'banker') {
      for (const key of ['grade', 'decision_label', 'reason', 'document_request_id', 'document_contract_id', 'studio_url', 'studio_job_id']) dto[key] = null;
      dto.checks = []; dto.basic_comparison = 'unknown';
    }
    return dto;
  }
  async state(session, {role = 'admin'} = {}) {
    if (!validSession(session)) throw error('studio_session_invalid');
    const record = await this.store.read(session);
    return this.projectState(session, role, record.jobs);
  }
  projectState(session, role, records) {
    const jobs = [...records].sort((a, b) => b.received_at.localeCompare(a.received_at)).map(job => this.dto(job, role));
    let summary = null, summary_error;
    if (role === 'admin') {
      const cutoff = this.now();
      const reportDate = new Date(Date.parse(cutoff) + 9 * 3600000).toISOString().slice(0, 10);
      try {
        summary = summarizeStudioReport({reportDate, cutoff, provenance: {source: 'studio_accepted_results', scope: 'tracked_receipts'},
          receipts: records.filter(job => job.kind === 'request' && !job.document_routing_required).map(job => ({
            receiptId: job.receipt_id, requestId: job.document_request_id, contractId: job.document_contract_id, occurredAt: job.received_at,
            status: job.processing_status === 'completed' ? job.evaluation_status : ['failed', 'uncertain'].includes(job.processing_status) ? job.processing_status : 'processing',
            result: job.processing_status === 'completed' ? job.result : null,
          }))});
      } catch { summary_error = 'studio_summary_unavailable'; }
    }
    return {provider: 'studio', session_id: session, role, configuration_mode: this.workflows.request?.configuration_mode ?? this.workflows.contract?.configuration_mode ?? 'latest', jobs, summary, ...(summary_error ? {summary_error} : {})};
  }
  async readDocument(session, documentId) {
    if (!validSession(session)) throw error('studio_session_invalid');
    const job = (await this.store.read(session)).jobs.find(item => item.document_id === documentId);
    if (!job) throw error('studio_document_not_found');
    return {bytes: Buffer.from(job.bytes, 'base64'), filename: job.filename, pages: job.pages};
  }
}
