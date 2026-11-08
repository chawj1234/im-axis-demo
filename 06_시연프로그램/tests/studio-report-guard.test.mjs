import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumReportRequests, validateReportCount} from '../lib/studio-report-guard.mjs';
import {gradeReportPrompt} from '../lib/studio-api.mjs';

test('confirmed request lower bound uses Korean date boundaries and unique document request IDs', () => {
  const job = {kind: 'request', processing_status: 'completed', collection_status: 'stored', document_request_id: 'A', received_at: '2026-11-07T15:00:00Z'};
  const jobs = [job, {...job}, {...job, document_request_id: 'B', evaluation_status: 'incomplete'},
    {...job, document_request_id: 'before', received_at: '2026-11-07T14:59:59Z'},
    {...job, document_request_id: 'after', received_at: '2026-11-08T15:00:00Z'},
    {...job, document_request_id: 'pending', processing_status: 'queued'},
    {...job, document_request_id: 'unconfirmed', collection_status: 'unconfirmed'},
    {...job, document_request_id: 'contract', kind: 'contract'},
    {...job, document_request_id: 'wrong', document_routing_required: true}];
  assert.equal(minimumReportRequests(jobs, '2026-11-08'), 2);
});

test('zero, missing or undersized model totals cannot hide already confirmed receipts', () => {
  for (const answer of ['[처리 현황]\n전체 0건', '[처리 현황]\n전체 2건', '집계 확인 불가']) {
    assert.throws(() => validateReportCount(answer, 3), /studio_report_count_conflict/);
  }
  assert.doesNotThrow(() => validateReportCount('[처리 현황]\n전체 3건·일치 1건·불일치 1건·미평가 1건입니다.', 3));
  assert.doesNotThrow(() => validateReportCount('[처리 현황]\n전체 요청 1,003건', 3));
});

test('grade report follows current coworker references without pinned collection IDs or day filters', () => {
  const prompt = gradeReportPrompt();
  assert.match(prompt, /현재 이 동료에 연결된 등급결정결과/);
  assert.doesNotMatch(prompt, /vs_|scol_/);
  assert.match(prompt, /날짜 조건 없이/);
  assert.match(prompt, /재계산하지/);
  assert.match(prompt, /오늘 처리 건수나 전체 건수를 추정하지/);
  assert.doesNotMatch(prompt, /저장일 필터|T00:00|한국시간.*저장 기준/);
});
