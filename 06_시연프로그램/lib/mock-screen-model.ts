// Application-facing mock data only. This is not a Studio response schema.
export type Role = 'customer' | 'banker' | 'reviewer';
export type Processing = 'completed' | 'analyzing' | 'delayed' | 'ended' | 'failed';
export type Grade = 1 | 2 | 3 | 4;
export type Evidence = { source: string; page: number | null; quote: string; raw: string; normalized: string };
export type Comparison = {
  key: string; label: string; status: 'match' | 'mismatch' | 'missing';
  baseline: Evidence; requested: Evidence; note: string;
};
export type Assessment = { status: 'complete' | 'incomplete'; grade: Grade | null; checks: Comparison[] };
export type Notice = { id: string; kind: 'receipt' | 'warning'; createdAt: string; title: string; message: string; displayedAt: string | null };
export type Review = { confirmed: boolean; memo: string; recordedAt: string | null };
export type Scenario = {
  id: string; title: string; processing: Processing; elapsedMinutes: number;
  assessment: Assessment | null; lateAssessment: Assessment | null; amount: number | null;
  note: string;
};
export type LocalRecords = { displayed: Record<string, string>; reviews: Record<string, Review> };
export type CustomerView = {
  requestId: string; receivedAt: string; processing: Processing; processingLabel: string;
  assessmentLabel: string; late: boolean; guidance: string; notices: Notice[];
};
export type StaffView = CustomerView & {
  scenario: Scenario; assessment: Assessment | null; review: Review; needsReview: boolean;
  contractReference: string; balance: number; balanceAsOf: string;
};

export const RECEIVED_AT = '2026-10-27T00:00:00.000Z';
export const CONTRACT_REFERENCE = 'AG-2026-001';
export const BALANCE = 700_000_000;
export const DEFAULT_SESSION = 'mock-demo-session';
const account = '000-000000-00-001';
const otherAccount = '000-000000-00-099';
const evidence = (source: string, page: number | null, quote: string, raw: string, normalized = raw): Evidence =>
  ({ source, page, quote, raw, normalized });
const check = (key: string, label: string, reference: string, requested: string | null,
  baselineQuote: string, requestQuote: string, note: string, referenceSource = '검토된 계약서 · 모의 근거', page: number | null = 2): Comparison => ({
  key, label, status: requested === null ? 'missing' : requested === reference ? 'match' : 'mismatch',
  baseline: evidence(referenceSource, page, baselineQuote, reference, reference.replace(/[\s,-]/g, '')),
  requested: evidence('실행 요청서 · 모의 근거', 1, requestQuote, requested ?? '', (requested ?? '').replace(/[\s,-]/g, '')),
  note,
});
function makeAssessment(options: { wrongAccount?: boolean; missingAmount?: boolean; wrongHolder?: boolean; amountConflict?: boolean } = {}): Assessment {
  const receivingAccount = options.wrongHolder ? '000-000000-00-088' : options.wrongAccount ? otherAccount : account;
  const checks: Comparison[] = [
    check('account', '지급계좌', account, receivingAccount,
      `지정 지급계좌번호: ${account}`, `수취계좌번호: ${receivingAccount}`,
      '자동이체계좌와 구분해 지정 지급계좌를 대조합니다.'),
    check('holder', '수취 예금주', '주식회사 새봄테크', options.wrongHolder ? '주식회사 한빛개발' : '주식회사 새봄테크',
      '지정 지급계좌 예금주: 주식회사 새봄테크', `수취계좌 예금주: ${options.wrongHolder ? '주식회사 한빛개발' : '주식회사 새봄테크'}`,
      '차주명에서 예금주를 보충하지 않습니다.'),
    check('amount', '잔여 한도', '300,000,000원', options.missingAmount ? null : '200,000,000원',
      '약정한도 1,000,000,000원 − 전산 잔액 700,000,000원', options.missingAmount ? '이번 실행 요청금액: [미기재]' : '이번 실행 요청금액: 200,000,000원',
      '요청금액을 잔여 한도 이내인지 확인합니다. 요청서의 참고 잔액은 기준으로 쓰지 않습니다.', '계약＋가상 전자전산시스템의 계산값', null),
    check('payoutAmount', '본문·지급표 금액', options.missingAmount ? '' : '200,000,000원', options.amountConflict ? '190,000,000원' : '200,000,000원',
      options.missingAmount ? '본문 이번 실행 요청금액: [미기재]' : '본문 이번 실행 요청금액: 200,000,000원',
      `지급표 지급 요청금액: ${options.amountConflict ? '190,000,000원' : '200,000,000원'}`,
      '본문과 지급표를 별도로 보존합니다. 다른 경우 임의로 하나를 고르지 않습니다.', '실행 요청서 본문 · 모의 근거', 1),
    check('date', '실행 가능 기간', '2026-10-01 ~ 2026-12-31', '2026-10-28',
      '실행 가능 시작일 2026-10-01 / 종료일 2026-12-31', '실행희망일: 2026-10-28',
      '명시된 실행 가능 기간의 양 끝 날짜를 포함합니다.', '검토된 계약서 · 모의 근거', 1),
  ];
  checks.find(c => c.key === 'amount')!.status = options.missingAmount ? 'missing' : 'match';
  checks.find(c => c.key === 'date')!.status = 'match';
  if (options.missingAmount) checks.find(c => c.key === 'payoutAmount')!.status = 'missing';
  const incomplete = !!(options.missingAmount || options.amountConflict);
  return { status: incomplete ? 'incomplete' : 'complete', grade: incomplete ? null : options.wrongAccount || options.wrongHolder ? 1 : 4, checks };
}

const normal = makeAssessment();
const mismatch = makeAssessment({ wrongAccount: true });
export const SCENARIOS: Scenario[] = [
  { id: 'normal', title: '정상 대조', processing: 'completed', elapsedMinutes: 2, assessment: normal, lateAssessment: null, amount: 200_000_000, note: '대조 완료 · 4등급 · 개별 검토 생략' },
  { id: 'account', title: '같은 명의·다른 계좌', processing: 'completed', elapsedMinutes: 2, assessment: mismatch, lateAssessment: null, amount: 200_000_000, note: '명의가 같아도 비지정 계좌는 경고합니다.' },
  { id: 'holder', title: '계좌·예금주 불일치', processing: 'completed', elapsedMinutes: 2, assessment: makeAssessment({ wrongAccount: true, wrongHolder: true }), lateAssessment: null, amount: 200_000_000, note: '계좌와 예금주의 차이를 각각 보존합니다. 관계인을 식별했다는 뜻은 아닙니다.' },
  { id: 'missing', title: '실행 요청금액 누락', processing: 'completed', elapsedMinutes: 2, assessment: makeAssessment({ missingAmount: true }), lateAssessment: null, amount: null, note: '지급표에 금액이 있어도 본문 누락을 보충하지 않습니다.' },
  { id: 'compound', title: '계좌 불일치＋금액 누락', processing: 'completed', elapsedMinutes: 2, assessment: makeAssessment({ wrongAccount: true, missingAmount: true }), lateAssessment: null, amount: null, note: '계좌 경고는 유지하고 최종 등급만 미완료로 둡니다.' },
  { id: 'amount-conflict', title: '본문·지급표 금액 다름', processing: 'completed', elapsedMinutes: 2, assessment: makeAssessment({ amountConflict: true }), lateAssessment: null, amount: 200_000_000, note: '등급표 밖 지급 조건 위반 · 평가 미완료 · 검토자 전달' },
  { id: 'unrequested', title: '고객 미요청·문서값 일치', processing: 'completed', elapsedMinutes: 2, assessment: normal, lateAssessment: null, amount: 200_000_000, note: '고객 미요청 사실은 평가용 시나리오에만 있습니다. 자동 대조는 정상이며 접수 알림은 발생합니다.' },
  { id: 'analyzing', title: '접수 후 분석 중', processing: 'analyzing', elapsedMinutes: 1, assessment: null, lateAssessment: null, amount: null, note: '고객·계약 연결은 확인됐고 분석 결과는 아직 없습니다.' },
  { id: 'delay', title: '6분 지연', processing: 'delayed', elapsedMinutes: 6, assessment: null, lateAssessment: null, amount: null, note: '새 분석 없이 기존 작업 확인을 계속하는 화면 사례입니다.' },
  { id: 'timeout', title: '12분 자동 확인 종료', processing: 'ended', elapsedMinutes: 12, assessment: null, lateAssessment: null, amount: null, note: '제공사 실패·취소를 단정하지 않고 별도 검토자에게 전달합니다.' },
  { id: 'failed', title: '최종 처리 실패', processing: 'failed', elapsedMinutes: 4, assessment: null, lateAssessment: null, amount: null, note: '분석 실패 사례입니다. 통신 오류나 생성 성공 여부 불명과 구분합니다.' },
  { id: 'failed-warning', title: '경고 확인 후 처리 실패', processing: 'failed', elapsedMinutes: 4, assessment: makeAssessment({ wrongAccount: true, missingAmount: true }), lateAssessment: null, amount: null, note: '처리가 실패해도 이미 확인한 계좌 불일치와 고객 경고는 유지합니다.' },
  { id: 'late', title: '종료 후 계좌 불일치 도착', processing: 'ended', elapsedMinutes: 13, assessment: null, lateAssessment: mismatch, amount: 200_000_000, note: '종료 상태를 유지하고 고객·검토자 모두에게 추가 결과를 표시합니다.' },
];

export const processingLabels: Record<Processing, string> = {
  completed: '분석·대조 완료', analyzing: '분석 중', delayed: '처리 지연', ended: '자동 확인 종료', failed: '처리 실패',
};
export const emptyRecords = (): LocalRecords => ({ displayed: {}, reviews: {} });
export function validSession(session: string): boolean { return /^[a-zA-Z0-9_-]{8,90}$/.test(session); }
export function storageKey(session: string): string {
  if (!validSession(session)) throw new Error('유효한 모의 세션이 필요합니다.');
  return `im-mock-screens:${session}`;
}
export function requestId(session: string, scenario: Scenario): string { storageKey(session); return `${session}:${scenario.id}`; }
export function assessmentOf(scenario: Scenario): Assessment | null { return scenario.lateAssessment ?? scenario.assessment; }
export function needsReview(scenario: Scenario): boolean {
  const a = assessmentOf(scenario);
  return !!scenario.lateAssessment || scenario.processing === 'ended' || scenario.processing === 'failed' || !!a && (a.status === 'incomplete' || a.checks.some(c => c.status === 'mismatch'));
}
export function assessmentLabel(a: Assessment | null): string {
  return !a ? '결과 대기' : a.status === 'incomplete' ? '평가 미완료 · 최종 등급 없음' : `평가 완료 · ${a.grade}등급`;
}
export function maskAccount(value: string): string { return `•••• ${value.replace(/\D/g, '').slice(-4)}`; }
function maskedName(value: string): string {
  const name = value.replace(/^주식회사\s*/, '');
  return name ? `주식회사 ${name.slice(0, 1)}${'＊'.repeat(Math.max(1, name.length - 1))}` : '확인 불가';
}
function notices(session: string, scenario: Scenario, records: LocalRecords): Notice[] {
  const id = requestId(session, scenario);
  const result: Notice[] = [{ id: `${id}:receipt`, kind: 'receipt', createdAt: RECEIVED_AT, title: '대출 실행 요청이 접수되었습니다', message: '연결된 계약에 대한 요청을 접수했습니다. 요청하신 내용인지 확인해 주세요.', displayedAt: records.displayed[`${id}:receipt`] ?? null }];
  const a = assessmentOf(scenario);
  const differences = a?.checks.filter(c => c.status === 'mismatch') ?? [];
  if (differences.length) {
    const message = differences.map(c => c.key === 'account'
      ? `지급계좌가 계약의 지정계좌와 다릅니다. 지정 ${maskAccount(c.baseline.raw)} / 요청 ${maskAccount(c.requested.raw)}`
      : c.key === 'holder' ? `예금주가 다릅니다. 지정 ${maskedName(c.baseline.raw)} / 요청 ${maskedName(c.requested.raw)}`
      : '요청서 본문 금액과 지급표 금액이 달라 담당자가 확인 중입니다.').join(' ');
    const warningId = `${id}:warning`;
    result.push({ id: warningId, kind: 'warning', createdAt: new Date(Date.parse(RECEIVED_AT) + scenario.elapsedMinutes * 60_000).toISOString(), title: '계약·요청 내용 확인이 필요합니다', message: `${message} 담당자가 확인 중입니다.`, displayedAt: records.displayed[warningId] ?? null });
  }
  return result;
}
export function customerView(session: string, scenario: Scenario, records: LocalRecords): CustomerView {
  const a = assessmentOf(scenario);
  const guidance = scenario.lateAssessment ? '자동 확인 종료 후 추가 결과가 도착했습니다. 아래 안내를 확인해 주세요.'
    : scenario.processing === 'ended' || scenario.processing === 'failed' ? '처리가 완료되지 않아 담당자가 확인 중입니다. 기존 접수 안내는 유지됩니다.'
    : scenario.processing === 'delayed' ? '분석이 지연되고 있습니다. 기존 작업의 결과를 확인하고 있습니다.'
    : !a ? '요청 내용을 확인하고 있습니다.'
    : a.status === 'incomplete' ? '일부 정보를 확인 중입니다. 확인된 차이가 있다면 아래 경고에서 안내합니다.'
    : a.checks.some(c => c.status === 'mismatch') ? '계약과 다른 내용이 있어 담당자가 확인 중입니다.'
    : '계약과 요청 내용의 대조가 완료되었습니다.';
  return { requestId: requestId(session, scenario), receivedAt: RECEIVED_AT, processing: scenario.processing,
    processingLabel: processingLabels[scenario.processing], assessmentLabel: a?.status === 'complete' ? '평가 완료' : a ? '평가 미완료' : '결과 대기',
    late: !!scenario.lateAssessment, guidance, notices: notices(session, scenario, records) };
}
export function staffView(session: string, scenario: Scenario, records: LocalRecords): StaffView {
  const id = requestId(session, scenario);
  return { ...customerView(session, scenario, records), scenario, assessment: assessmentOf(scenario),
    review: records.reviews[id] ?? { confirmed: false, memo: '', recordedAt: null }, needsReview: needsReview(scenario),
    contractReference: CONTRACT_REFERENCE, balance: BALANCE, balanceAsOf: '2026-10-27T00:00:00.000Z' };
}
export function markDisplayed(records: LocalRecords, session: string, scenario: Scenario, noticeId: string, at: string): LocalRecords {
  if (!notices(session, scenario, records).some(n => n.id === noticeId)) throw new Error('이 요청의 알림이 아닙니다.');
  if (!Number.isFinite(Date.parse(at))) throw new Error('올바른 표시시각이 필요합니다.');
  if (records.displayed[noticeId]) return records;
  return { ...records, displayed: { ...records.displayed, [noticeId]: at } };
}
export function saveReview(records: LocalRecords, session: string, scenario: Scenario, input: unknown, at: string): LocalRecords {
  if (!needsReview(scenario)) throw new Error('개별 검토 대상이 아닙니다.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('검토 입력을 확인해 주세요.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(k => !['confirmed', 'memo'].includes(k)) || typeof value.confirmed !== 'boolean' || typeof value.memo !== 'string' || value.memo.length > 2000 || !Number.isFinite(Date.parse(at)))
    throw new Error('확인 여부와 2,000자 이내 메모만 저장할 수 있습니다.');
  return { ...records, reviews: { ...records.reviews, [requestId(session, scenario)]: { confirmed: value.confirmed, memo: value.memo, recordedAt: at } } };
}
export function readRecords(serialized: string | null, session: string): LocalRecords {
  const result = emptyRecords();
  if (!serialized) return result;
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object') throw new Error('저장된 모의 기록을 읽지 못했습니다.');
  const source = parsed as LocalRecords;
  for (const scenario of SCENARIOS) {
    const id = requestId(session, scenario);
    for (const kind of ['receipt', 'warning']) {
      const key = `${id}:${kind}`;
      const at = source.displayed?.[key];
      if (typeof at === 'string' && Number.isFinite(Date.parse(at))) result.displayed[key] = at;
    }
    const r = source.reviews?.[id];
    if (r && typeof r.confirmed === 'boolean' && typeof r.memo === 'string' && r.memo.length <= 2000 && typeof r.recordedAt === 'string' && Number.isFinite(Date.parse(r.recordedAt)))
      result.reviews[id] = { confirmed: r.confirmed, memo: r.memo, recordedAt: r.recordedAt };
  }
  return result;
}
