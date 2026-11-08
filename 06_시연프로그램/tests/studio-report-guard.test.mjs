import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumReportRequests, validateReportCount} from '../lib/studio-report-guard.mjs';
import {dailyReportPrompt} from '../lib/studio-api.mjs';

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

test('report explicitly specifies the actual result resource, UTC interval and unknown registration counts', () => {
  const prompt = dailyReportPrompt('2026-11-08', 'vs_current');
  assert.match(prompt, /vs_current/);
  assert.match(prompt, /2026-11-07T15:00:00.000Z/);
  assert.match(prompt, /2026-11-08T15:00:00.000Z/);
  assert.match(prompt, /계약 등록 건수는 확인 불가/);
});
