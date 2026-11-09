import type {OperationsCheck, OperationsRequest} from './operations-types';

export const operationsStatusLabels = {
  processing: '처리 중',
  failed: '처리 실패',
  review: '결과 확인 필요',
  match: '일치',
  mismatch: '불일치',
} as const;

export function operationsRequestStatus(request: Pick<OperationsRequest, 'processing' | 'grade'>): keyof typeof operationsStatusLabels {
  if (request.processing === 'failed') return 'failed';
  if (request.processing === 'processing') return 'processing';
  if (request.processing !== 'completed' || request.grade === null) return 'review';
  return request.grade === 6 ? 'match' : 'mismatch';
}

/** Presentation only: comparison enums and grade calculations stay unchanged. */
export function operationsCheckStatusLabel(check: Pick<OperationsCheck, 'key' | 'status'>): string {
  if (check.status === 'unknown') return '확인 필요';
  const matched = check.status === 'match';
  if (check.key === 'contract_limit') return matched ? '한도 이내' : '한도 초과';
  if (check.key === 'credit_period') return matched ? '기간 이내' : '기간 외';
  if (check.key.endsWith('_arithmetic')) return matched ? '산식 일치' : '산식 불일치';
  return matched ? '일치' : '불일치';
}

export function prioritizeOperationsChecks(checks: readonly OperationsCheck[]): OperationsCheck[] {
  const priority = {mismatch: 0, unknown: 1, match: 2};
  return [...checks].sort((left, right) => priority[left.status] - priority[right.status]);
}

/** Counts and rows share this contract/search scope; status and grade filters apply afterward. */
export function operationsRequestScope(requests: readonly OperationsRequest[], {contractId = '', search = ''}: {contractId?: string; search?: string}): OperationsRequest[] {
  const term = search.trim().toLocaleLowerCase('ko-KR');
  return requests.filter(request => (!contractId || request.contractId === contractId)
    && (!term || `${request.companyName} ${request.contractReference} ${request.receiptId} ${request.id} ${request.originalReceiptId || ''}`.toLocaleLowerCase('ko-KR').includes(term)));
}

export function operationsStatusCounts(requests: readonly OperationsRequest[]) {
  const counts = {all: requests.length, mismatch: 0, failed: 0, review: 0, processing: 0, match: 0};
  for (const request of requests) counts[operationsRequestStatus(request)]++;
  return counts;
}

/** An explicit incomplete decision is distinct from missing or inconsistent results. */
export function operationsProcessingCounts(requests: readonly OperationsRequest[]) {
  const counts = operationsStatusCounts(requests);
  const incomplete = requests.filter(request => request.processing === 'completed' && request.grade === null && request.studio?.decision === '미평가').length;
  return {total: counts.all, evaluated: counts.match + counts.mismatch, incomplete,
    processing: counts.processing, failed: counts.failed, review: counts.review - incomplete};
}

export function formatWon(value: number | null): string {
  return value !== null && Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat('ko-KR').format(value) + '원' : '미확인';
}
export function formatRatio(value: number | null): string {
  return value !== null && Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}).format(value) + '%' : '—';
}
export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
  });
}

/** Keep full receipt IDs in data/search; abbreviate only their visible label. */
export function formatReceiptId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}
