/** The grade is supplied by Studio's dedicated enum decision, never regenerated here. */
export const STUDIO_DECISION_POLICY = 'studio-enum-comparison-v1';
const labels = new Map([['1등급', 1], ['2등급', 2], ['3등급', 3], ['4등급', 4], ['5등급', 5], ['6등급', 6], ['미평가', null]]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.trim().length > 0;

const additionalKeys = ['date', 'outstanding', 'available'];

function validateMetadata(value) {
  if (!object(value) || !['green', 'red'].includes(value.verdict) || !Array.isArray(value.checks) || !value.checks.length
    || value.checks.some(check => !object(check) || !identifier(check.name) || typeof check.passed !== 'boolean'
      || !identifier(check.reason))
    || (value.verdict === 'green') !== value.checks.every(check => check.passed)) throw Error('studio_validation_evidence_invalid');
  return structuredClone(value);
}

function readValidationStage(stages, name, {optional = false, legacy = false} = {}) {
  const matches = stages.filter(stage => stage.name === 'Validate - ' + name && stage.status === 'completed')
    .flatMap(stage => stage.contents);
  if (optional && matches.length === 0) return null;
  if (legacy && !matches.some(item => object(item.additional_values)
    && ('verdict' in item.additional_values || 'checks' in item.additional_values))) return null;
  if (matches.length !== 1) throw Error('studio_validation_stage_invalid');
  const metadata = validateMetadata(matches[0].additional_values);
  if (matches[0].value !== metadata.verdict) throw Error('studio_validation_evidence_invalid');
  return metadata;
}

/** Absent contract evidence can be historical; it never confirms an export. */
export function readStudioContractValidation(response) {
  const output = (response.output ?? []).filter(stage => stage.model === 'Validate - 계약-필수값검증');
  return readValidationStage(studioOutputStages({...response, output}), '계약-필수값검증', {optional: true});
}

/** Input validation is independent evidence when the explanatory body is unreadable. */
export function readStudioRejectedInput(stages) {
  if (stages.some(stage => stage.status === 'completed'
    && stage.name === 'Validate - 요청-기본대조')) throw Error('studio_validation_stage_invalid');
  const input = readValidationStage(stages, '요청-입력검증');
  if (input.verdict !== 'red') throw Error('studio_validation_evidence_invalid');
  return input;
}

// Request FLOW #5 omits purpose_review and only emits reason for incomplete results.
const requestV5Keys = ['request_id', 'contract_id', 'evaluation_status', 'checks', 'grade_basis'];
function hasRequestV5Body(body) {
  const expected = body.evaluation_status === 'incomplete' ? [...requestV5Keys, 'reason'] : requestV5Keys;
  return Object.keys(body).length === expected.length && expected.every(key => Object.hasOwn(body, key));
}

function normalizeStructuredDecision(body, grade, decision) {
  body = structuredClone(body);
  // The live v40 match branch can omit non-applicable fields and echo the enum.
  // Accept an exact echo only; the dedicated API enum remains the sole authority.
  if (Object.hasOwn(body, 'studio_decision')) {
    if (body.studio_decision !== decision && body.studio_decision !== (grade === null ? 'incomplete' : grade === 6 ? 'match' : 'mismatch')) throw Error('studio_duplicate_grade_source');
    delete body.studio_decision;
  }
  if (Object.hasOwn(body, 'grade')) {
    if (body.grade !== decision) throw Error('studio_duplicate_grade_source');
    delete body.grade;
  }
  if (grade !== null && !Object.hasOwn(body, 'reason')) body.reason = null;
  if (grade === 6 && !Object.hasOwn(body, 'grade_basis') && body.validation?.input?.verdict === 'green'
    && body.validation?.basic?.verdict === 'green' && object(body.checks)
    && additionalKeys.every(key => body.checks[key]?.status === 'match')) body.grade_basis = null;
  if (['request_id', 'contract_id', 'evaluation_status', 'checks', 'grade_basis', 'purpose_review', 'reason']
    .some(key => !Object.hasOwn(body, key)) || !(body.purpose_review === null || identifier(body.purpose_review))
    || !(body.reason === null || identifier(body.reason))) throw Error('studio_decision_body_incomplete');
  const input = validateMetadata(body.validation?.input);
  const basic = body.validation?.basic === null ? null : validateMetadata(body.validation?.basic);
  const branch = basic?.verdict === 'green' ? 'match' : basic?.verdict === 'red' ? 'mismatch' : null;
  if (input.verdict === 'red') {
    if (grade !== null || basic !== null || body.checks !== null || body.grade_basis !== null || body.purpose_review !== null
      || !identifier(body.reason)) throw Error('studio_decision_evidence_inconsistent');
  } else {
    if (!basic || !object(body.checks) || additionalKeys.some(key => !object(body.checks[key])
      || !['match', 'mismatch', 'unknown'].includes(body.checks[key].status)
      || !identifier(body.checks[key].basis))) throw Error('studio_comparison_evidence_incomplete');
    const checks = additionalKeys.map(key => body.checks[key]);
    if (grade !== null && checks.some(check => check.status === 'unknown')) throw Error('studio_comparison_evidence_incomplete');
    const mismatch = branch === 'mismatch' || checks.some(check => check.status === 'mismatch');
    if (grade !== null && (grade === 6) === mismatch) throw Error('studio_decision_evidence_inconsistent');
    if (grade === null && !identifier(body.reason)) throw Error('studio_decision_body_incomplete');
    if (grade !== null && body.reason !== null) throw Error('studio_decision_evidence_inconsistent');
  }
  const basis = body.grade_basis;
  if (grade === null || grade === 6) {
    if (basis !== null) throw Error('studio_decision_evidence_inconsistent');
  } else if (!object(basis) || !Number.isSafeInteger(basis.requested_amount_krw) || basis.requested_amount_krw <= 0
    || !Number.isSafeInteger(basis.contract_limit_krw) || basis.contract_limit_krw <= 0
    || typeof basis.ratio !== 'number' || !Number.isFinite(basis.ratio) || basis.ratio <= 0
    || !identifier(basis.applied_rule)) throw Error('studio_comparison_evidence_incomplete');
  const canonical = {...structuredClone(body), validation: {input, basic}, basic_comparison_branch: branch,
    requested_ratio: basis?.ratio ?? null,
    ...Object.fromEntries(additionalKeys.map(key => [key + '_check', body.checks?.[key] ?? null]))};
  // Stored canonical aliases cannot diverge from the source fields during revalidation.
  for (const key of ['basic_comparison_branch', 'requested_ratio', ...additionalKeys.map(key => key + '_check')]) {
    if (Object.hasOwn(body, key) && JSON.stringify(body[key]) !== JSON.stringify(canonical[key])) throw Error('studio_decision_evidence_inconsistent');
  }
  return canonical;
}

export function acceptStudioDecision({decision, body, expectedRequestId, expectedContractId, partialEvidence = false}) {
  if (!labels.has(decision)) throw Error('studio_decision_missing_or_invalid');
  const grade = labels.get(decision);
  const v40 = object(body) && (Object.hasOwn(body, 'checks') || Object.hasOwn(body, 'grade_basis'));
  if (v40) body = normalizeStructuredDecision(body, grade, decision);
  // Older Instruct bodies also have per-field evidence in Validate stage metadata.
  if (!v40 && object(body?.validation)) {
    const input = body.validation.input == null ? null : validateMetadata(body.validation.input);
    const basic = body.validation.basic == null ? null : validateMetadata(body.validation.basic);
    if ((input?.verdict === 'red' && grade !== null)
      || (basic && (basic.verdict === 'green' ? 'match' : 'mismatch') !== body.basic_comparison_branch)) {
      throw Error('studio_decision_evidence_inconsistent');
    }
    body = {...body, validation: {input, basic}};
  }
  const validReference = value => identifier(value) || (grade === null && value === null);
  if (!object(body) || !validReference(body.request_id) || !validReference(body.contract_id)
    || (!v40 && (typeof body.reason !== 'string' || !body.reason.trim()))) throw Error('studio_decision_body_incomplete');
  if (!validReference(expectedRequestId) || !validReference(expectedContractId)
    || body.request_id !== expectedRequestId || body.contract_id !== expectedContractId) throw Error('studio_decision_identity_mismatch');
  // A body grade would introduce a second authority. The option-mode prompt omits it.
  if (['final_grade', 'grade', 'decision'].some(key => Object.hasOwn(body, key))) throw Error('studio_duplicate_grade_source');
  const status = grade === null ? 'incomplete' : grade === 6 ? 'match' : 'mismatch';
  if (body.evaluation_status !== status) throw Error('studio_decision_status_inconsistent');
  if (v40 && partialEvidence) throw Error('studio_comparison_evidence_incomplete');
  if (partialEvidence) {
    if (grade === null || !['match', 'mismatch'].includes(body.basic_comparison_branch)
      || (grade === 6 && body.basic_comparison_branch !== 'match')) throw Error('studio_decision_evidence_inconsistent');
  } else if (grade !== null && !v40) {
    if (!['match', 'mismatch'].includes(body.basic_comparison_branch)
      || typeof body.requested_ratio !== 'number' || !Number.isFinite(body.requested_ratio) || body.requested_ratio <= 0) throw Error('studio_comparison_evidence_incomplete');
    const checks = ['date_check', 'outstanding_check', 'available_check'].map(key => body[key]);
    if (checks.some(check => !object(check) || !['match', 'mismatch'].includes(check.status)
      || typeof check.basis !== 'string' || !check.basis.trim())) throw Error('studio_comparison_evidence_incomplete');
    const mismatch = body.basic_comparison_branch === 'mismatch' || checks.some(check => check.status === 'mismatch');
    if ((grade === 6) === mismatch) throw Error('studio_decision_evidence_inconsistent');
  }
  return {policy_version: STUDIO_DECISION_POLICY, studio_decision: decision,
    evaluation_status: grade === null ? 'incomplete' : 'completed', final_grade: grade,
    comparison_status: status, body: structuredClone(body), source: 'studio_enum'};
}

/** Decode one API stage without silently treating malformed JSON as an empty record. */
export function studioOutputStages(response, {allowMalformedInstruct = false} = {}) {
  if (!object(response) || response.status !== 'completed' || !Array.isArray(response.output)) throw Error('studio_job_not_completed');
  return response.output.map(stage => ({id: stage.id, name: stage.model, status: stage.status,
    contents: (stage.content || []).filter(content => content.type === 'output_text').map(content => {
      const decode = (value, allowCitations = false) => {
        let current = value;
        for (let i = 0; i < 4 && typeof current === 'string'; i++) {
          let text = current.trim();
          const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```([\s\S]*)$/.exec(text);
          if (fenced) {
            const trailing = fenced[2].trim();
            // Only a single leading JSON block is authoritative; never pick among payloads.
            if (trailing && (!allowCitations || /```|(?:^|\n)[ \t]*[\[{"]/.test(trailing))) {
              throw Error('studio_output_json_ambiguous');
            }
            text = fenced[1].trim();
          }
          if (i > 0 && !/^[\[{\"]/.test(text)) break;
          try {
            current = JSON.parse(text);
          } catch (error) {
            // Studio can append numbered source markers to JSON values in Instruct output.
            if (!allowCitations) throw error;
            const withoutCitations = text.replace(/【†\d+】/g, '');
            if (withoutCitations === text) throw error;
            current = JSON.parse(withoutCitations);
          }
        }
        return current;
      };
      let value, malformed = false;
      try { value = decode(content.text, /instruct/i.test(stage.model || '')); } catch (failure) {
        if (failure?.message === 'studio_output_json_ambiguous') throw failure;
        if (/classify/i.test(stage.model || '')) value = content.text;
        else if (allowMalformedInstruct && /instruct/i.test(stage.model || '')) malformed = true;
        else throw Error('studio_output_json_invalid');
      }
      let additional = null;
      if (content.additional_values !== undefined && content.additional_values !== null) {
        try { additional = decode(content.additional_values); } catch { throw Error('studio_output_metadata_invalid'); }
      }
      return {value, additional_values: additional, ...(malformed ? {malformed: true} : {})};
    }),
  }));
}

/** The live Jobs API exposes the dedicated decision in output_text.additional_values.enum. */
export function readStudioDecision(response, {expectedRequestId, expectedContractId}) {
  const stages = studioOutputStages(response);
  const candidates = stages.filter(stage => /instruct/i.test(stage.name || '') && stage.status === 'completed')
    .flatMap(stage => stage.contents.filter(content => object(content.value)
      && Object.hasOwn(content.value, 'evaluation_status')).map(content => ({stage, content})));
  if (candidates.length !== 1) throw Error('studio_decision_stage_ambiguous');
  const {stage, content} = candidates[0];
  if (content.value.reason_code === 'wrong_document_type') {
    if (!/문서종류-안내$/.test(stage.name) || content.additional_values?.enum !== '미평가'
      || content.value.request_id !== null || content.value.contract_id !== null
      || content.value.evaluation_status !== 'incomplete' || typeof content.value.reason !== 'string' || !content.value.reason.trim()
      || ['final_grade', 'grade', 'decision'].some(key => Object.hasOwn(content.value, key))) throw Error('studio_document_routing_invalid');
    return {policy_version: STUDIO_DECISION_POLICY, studio_decision: '미평가', evaluation_status: 'incomplete',
      final_grade: null, comparison_status: 'incomplete', document_routing_required: true,
      body: structuredClone(content.value), source: 'studio_enum', stage_name: stage.name, stage_id: stage.id, stages};
  }
  let body = content.value;
  const requestV5 = response.config_id === 'cfg_DxGdQmrKZpnzxM4wWtqFEq' || hasRequestV5Body(body);
  if (requestV5) {
    if (!hasRequestV5Body(body)) throw Error('studio_decision_body_incomplete');
    // Canonical storage keeps the old nullable field for historical readers.
    body = {...body, purpose_review: null};
  }
  if (Object.hasOwn(body, 'checks') || Object.hasOwn(body, 'grade_basis')) {
    const validation = {
      input: readValidationStage(stages, '요청-입력검증'),
      basic: readValidationStage(stages, '요청-기본대조', {optional: true}),
    };
    const expectedStage = validation.input.verdict === 'red' ? 'Instruct - 입력부족-안내'
      : validation.basic?.verdict === 'green' ? 'Instruct - 추가검사-기본일치' : 'Instruct - 추가검사-기본불일치';
    if (stage.name !== expectedStage) throw Error('studio_validation_stage_invalid');
    body = {...body, validation};
  } else {
    const validation = {};
    for (const [key, name] of [['input', '요청-입력검증'], ['basic', '요청-기본대조']]) {
      const metadata = readValidationStage(stages, name, {legacy: true});
      if (metadata) validation[key] = metadata;
    }
    if (Object.keys(validation).length) body = {...body, validation};
  }
  const accepted = acceptStudioDecision({decision: content.additional_values?.enum, body,
    expectedRequestId, expectedContractId});
  return {...accepted, stage_name: stage.name, stage_id: stage.id, stages};
}
