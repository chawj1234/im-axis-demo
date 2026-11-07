/** The grade is supplied by Studio's dedicated enum decision, never regenerated here. */
export const STUDIO_DECISION_POLICY = 'studio-enum-comparison-v1';
const labels = new Map([['1등급', 1], ['2등급', 2], ['3등급', 3], ['4등급', 4], ['5등급', 5], ['6등급', 6], ['미평가', null]]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.trim().length > 0;

export function acceptStudioDecision({decision, body, expectedRequestId, expectedContractId, partialEvidence = false}) {
  if (!labels.has(decision)) throw Error('studio_decision_missing_or_invalid');
  const grade = labels.get(decision);
  const validReference = value => identifier(value) || (grade === null && value === null);
  if (!object(body) || !validReference(body.request_id) || !validReference(body.contract_id)
    || typeof body.reason !== 'string' || !body.reason.trim()) throw Error('studio_decision_body_incomplete');
  if (!validReference(expectedRequestId) || !validReference(expectedContractId)
    || body.request_id !== expectedRequestId || body.contract_id !== expectedContractId) throw Error('studio_decision_identity_mismatch');
  // A body grade would introduce a second authority. The option-mode prompt omits it.
  if (['final_grade', 'grade', 'decision'].some(key => Object.hasOwn(body, key))) throw Error('studio_duplicate_grade_source');
  const status = grade === null ? 'incomplete' : grade === 6 ? 'match' : 'mismatch';
  if (body.evaluation_status !== status) throw Error('studio_decision_status_inconsistent');
  if (partialEvidence) {
    if (grade === null || !['match', 'mismatch'].includes(body.basic_comparison_branch)
      || (grade === 6 && body.basic_comparison_branch !== 'match')) throw Error('studio_decision_evidence_inconsistent');
  } else if (grade !== null) {
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
        for (let i = 0; i < 2 && typeof current === 'string'; i++) {
          const text = current.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
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
      try { value = decode(content.text, /instruct/i.test(stage.model || '')); } catch {
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
  const accepted = acceptStudioDecision({decision: content.additional_values?.enum, body: content.value,
    expectedRequestId, expectedContractId});
  return {...accepted, stage_name: stage.name, stage_id: stage.id, stages};
}
