import type {OperationsCheck, OperationsRequest, OperationsSnapshot, ReviewGrade} from './operations-types';

// Offline UI examples only. Names, IDs, account suffixes, amounts and events are fictional.
// No document links, API calls, real notifications or Studio execution are attached.
const makeChecks = (company: string, reference: string, amount: number, mismatches: OperationsCheck['key'][]): OperationsCheck[] => [
  {key: 'contract_reference', label: '계약번호', contractValue: reference, requestValue: mismatches.includes('contract_reference') ? reference + '-A' : reference,
    status: mismatches.includes('contract_reference') ? 'mismatch' : 'match'},
  {key: 'company_name', label: '기업명', contractValue: company, requestValue: mismatches.includes('company_name') ? company.replace(' (가상)', '솔루션 (가상)') : company,
    status: mismatches.includes('company_name') ? 'mismatch' : 'match'},
  {key: 'payout_account', label: '수취계좌', contractValue: 'iM뱅크 · •••• 0132', requestValue: mismatches.includes('payout_account') ? 'iM뱅크 · •••• 8924' : 'iM뱅크 · •••• 0132',
    status: mismatches.includes('payout_account') ? 'mismatch' : 'match'},
  {key: 'contract_limit', label: '총 계약금액 이내 요청', contractValue: '1,000,000,000원', requestValue: amount.toLocaleString('ko-KR') + '원',
    status: amount <= 1_000_000_000 ? 'match' : 'mismatch', note: '이번 요청금액과 총 계약금액을 비교합니다.'},
];

function example(
  sequence: number, company: string, requestedAmount: number, grade: ReviewGrade | null,
  mismatches: OperationsCheck['key'][] = [], processing: OperationsRequest['processing'] = 'completed',
): OperationsRequest {
  const id = 'DEMO-20261030-' + String(sequence).padStart(3, '0');
  const reference = 'IM-DEMO-' + String(sequence).padStart(4, '0');
  const receivedAt = new Date(Date.UTC(2026, 9, 30, 1, 0) - sequence * 180_000).toISOString();
  const checks = makeChecks(company, reference, requestedAmount, mismatches);
  if (processing !== 'completed') for (const check of checks) {
    check.status = 'unknown'; check.contractValue = '미확인'; check.requestValue = '미확인';
  }
  return {
    id, contractId: 'CON-DEMO-' + sequence, receiptId: id, receivedAt, companyName: company, contractReference: reference,
    contractAmount: 1_000_000_000, requestedAmount: processing === 'completed' ? requestedAmount : null,
    ratio: processing === 'completed' ? requestedAmount / 1_000_000_000 * 100 : null,
    grade, processing, checks, ...(processing === 'failed' ? {gradeReason: '처리 실패' as const} : {}),
    files: [{name: '계약서_' + String(sequence).padStart(3, '0') + '.pdf'}, {name: '실행요청서_' + String(sequence).padStart(3, '0') + '.pdf'}],
    logs: [
      {at: receivedAt, label: '실행 요청서 접수', detail: '먼저 등록된 계약에 실행 요청서가 연결되었습니다.'},
      ...(processing === 'completed' ? [
        {at: receivedAt, label: 'Studio 문서 분류·추출 완료'},
        {at: receivedAt, label: '개인정보 감지 기록', detail: '감지됨 · 계좌번호 (값 저장 없음)'},
        {at: receivedAt, label: mismatches.length ? '문서 불일치 확인' : '문서 대조 일치', detail: mismatches.length ? '확인된 불일치와 이번 요청 비율로 등급을 산정했습니다.' : '등급 판정 항목에서 불일치가 없습니다.'},
        ...(mismatches.length ? [{at: receivedAt, label: '고객 앱 노출 기록'}] : []),
      ] : processing === 'failed' ? [
        {at: receivedAt, label: 'AI 추출 재시도 1회'},
        {at: receivedAt, label: '담당자 확인 요청', detail: '재시도 후에도 값을 추출하지 못했습니다. 등급 미산정 · 처리 실패.'},
      ] : [{at: receivedAt, label: '자동 대조 처리 중'}]),
    ],
    customerNotification: {
      receiptAt: receivedAt, displayedAt: receivedAt,
      ...(mismatches.length && processing === 'completed' ? {mismatchAt: receivedAt} : {}),
    },
  };
}

const requests: OperationsRequest[] = [
  example(1, '새봄테크 (가상)', 910_000_000, 1, ['payout_account', 'company_name']),
  example(2, '모아모빌리티 (가상)', 720_000_000, 2, ['payout_account']),
  example(3, '푸른소재 (가상)', 560_000_000, 3, ['contract_reference']),
  example(4, '해온리테일 (가상)', 350_000_000, 4, ['company_name']),
  example(5, '다온푸드 (가상)', 150_000_000, 5, ['payout_account']),
  example(6, '이음로지스 (가상)', 280_000_000, 6),
  example(7, '누리디바이스 (가상)', 480_000_000, 6),
  example(8, '온유패키지 (가상)', 170_000_000, 6),
  example(9, '라온에너지 (가상)', 650_000_000, 6),
  example(10, '하루디자인 (가상)', 90_000_000, 6),
  example(11, '한결메디컬 (가상)', 0, null, [], 'failed'),
  example(12, '오름정밀 (가상)', 0, null, [], 'processing'),
];

export const operationsPreviewSnapshot: OperationsSnapshot = {
  contracts: requests.map(request => ({id: request.contractId!, reference: request.contractReference, companyName: request.companyName, amount: request.contractAmount, registeredAt: '2026-10-29T00:00:00.000Z', fileName: request.files[0].name, status: 'registered'})),
  requests,
  receipts: requests.map(request => ({
    id: request.receiptId, receivedAt: request.receivedAt, fileNames: [request.files[1].name], kind: 'request', contractReference: request.contractReference,
    companyName: request.companyName, status: 'received',
  })),
  updatedAt: '2026-10-30T01:00:00.000Z',
};
