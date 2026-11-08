import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumReportRequests, validateReportCount} from '../lib/studio-report-guard.mjs';
import {documentReviewReportPrompt, validateDocumentReviewReport} from '../lib/studio-api.mjs';

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

test('review report uses actual contract/request fields and marks missing evidence for original review', () => {
  const prompt = documentReviewReportPrompt();
  assert.match(prompt, /현재 이 동료에 연결된 등록계약과 등급결정결과/);
  assert.doesNotMatch(prompt, /vs_|scol_/);
  assert.match(prompt, /날짜 조건 없이/);
  assert.match(prompt, /재계산하지/);
  assert.match(prompt, /원문 확인 필요/);
  assert.match(prompt, /등급 열·등급별 분류·등급 집계를 만들지/);
  assert.match(prompt, /미확인 값과 조회 실패를 0건·0원으로 쓰거나 추정하지/);
  assert.match(prompt, /요청금액·지급희망일/);
  assert.match(prompt, /요청을 최대 10건만 선정/);
  assert.match(prompt, /선정하지 않은 요청의 추가 표나 전체 목록을 만들지/);
  assert.match(prompt, /원문을 직접 확인한 것처럼 쓰지/);
  assert.match(prompt, /오늘 처리 건수나 전체 건수를 추정하지/);
  assert.doesNotMatch(prompt, /저장일 필터|T00:00|한국시간.*저장 기준/);
});


test('review report requires all three sections even when lookup results are unavailable', () => {
  for (const answer of [undefined, '', '[조회 범위] 불완전한 응답', '[계약·요청 확인]\n[원문 확인 필요]']) {
    assert.throws(() => validateDocumentReviewReport(answer), /studio_review_report_incomplete/);
  }
  const answer = '[조회 범위] 일부 자료\n[계약·요청 확인] 원문 확인 필요\n[원문 확인 필요] 계약 연결 근거 부족';
  assert.equal(validateDocumentReviewReport(answer), answer);
});
