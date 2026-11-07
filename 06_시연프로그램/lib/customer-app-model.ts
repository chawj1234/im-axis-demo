// Customer presentation only. This module does not grade, send or acknowledge data.
export interface CustomerAppNotice {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  kind: 'receipt' | 'warning' | 'information';
  displayedAt: string | null;
  jobId?: string;
  documentKind?: 'contract' | 'request' | 'document';
}

export interface CustomerAppActivity {
  id: string;
  title: string;
  status: string;
  receivedAt: string;
  message: string;
  accountLabel?: string;
  contractId?: string;
  contractReference?: string;
  documentKind?: 'contract' | 'request' | 'document';
}

export interface CustomerAppProps {
  notices: CustomerAppNotice[];
  activities: CustomerAppActivity[];
  connected: boolean;
  error?: string;
  onNoticeVisible?: (id: string) => void | Promise<void>;
  preview?: boolean;
}

type RecordValue = Record<string, unknown>;
type DocumentKind = 'contract' | 'request' | 'document';

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isoTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function documentKind(value: unknown): DocumentKind {
  const kind = text(value).trim().toLowerCase();
  if (kind === 'contract' || kind === '계약서') return 'contract';
  if (kind === 'request' || kind === 'draw_request' || kind === '요청서') return 'request';
  return 'document';
}

function noticeDocumentKind(notice: RecordValue): DocumentKind {
  const metadata = record(notice.metadata);
  const candidates = [
    notice.document_kind, notice.document_type, notice.job_kind,
    metadata?.document_kind, metadata?.document_type, metadata?.kind,
  ];
  for (const value of candidates) {
    const kind = documentKind(value);
    if (kind !== 'document') return kind;
  }
  return 'document';
}

function receiptTitle(kind: DocumentKind): string {
  if (kind === 'contract') return '계약서 접수 안내';
  if (kind === 'request') return '실행 요청서 접수 안내';
  return '서류 접수 안내';
}

function receiptMessage(kind: DocumentKind): string {
  if (kind === 'contract') return '계약서가 접수되었습니다.';
  if (kind === 'request') return '실행 요청서가 접수되었습니다.';
  return '서류가 접수되었습니다.';
}

const mismatchMessage = '계약서와 요청서의 정보가 일치하지 않는 항목이 있습니다. 담당자에게 확인해 주세요.';

/** Preserve source order and IDs so presentation cannot create extra acknowledgements. */
export function customerAppNotices(rawNotices: readonly unknown[]): CustomerAppNotice[] {
  return rawNotices.flatMap(raw => {
    const notice = record(raw);
    if (!notice || !text(notice.id).trim()) return [];
    if (!['receipt', 'warning', 'late_warning'].includes(text(notice.kind))) return [];
    const kind = notice.kind === 'receipt' ? 'receipt'
      : 'warning';
    const document = noticeDocumentKind(notice);
    const title = kind === 'receipt' ? receiptTitle(document)
      : text(notice.title).trim() || '추가 확인 안내';
    const displayed = typeof notice.displayed_at === 'string'
      ? notice.displayed_at : record(notice.displayed_at)?.customer;
    return [{
      id: text(notice.id), title,
      jobId: text(notice.job_id).trim() || undefined,
      documentKind: document,
      message: kind === 'receipt' ? receiptMessage(document)
        : text(notice.message) || mismatchMessage,
      createdAt: isoTime(notice.created_at), kind,
      displayedAt: isoTime(displayed) || null,
    }];
  });
}

function safeAccount(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const account = value.trim();
  // A field called masked_account is not proof that its value was masked.
  // Accept only masks with at most four visible digits; never print a raw account.
  if (!/^[\s\d•●*xX-]+$/.test(account) || !/[•●*xX]{2,}/.test(account)) return undefined;
  const digits = account.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 4 ? account : undefined;
}

function activityPresentation(job: RecordValue): Pick<CustomerAppActivity, 'status' | 'message'> {
  const result = record(job.result);
  const lateResult = record(record(job.late_result)?.result);
  if (result?.warning_required === true || lateResult?.warning_required === true) return {
    status: '추가 확인 필요',
    message: mismatchMessage,
  };
  return {
    status: '접수 완료',
    message: receiptMessage(documentKind(job.kind)),
  };
}

/** Customer copy is owned here; technical errors, result prompts and grades stay private. */
export function customerAppActivities(rawJobs: readonly unknown[]): CustomerAppActivity[] {
  return rawJobs.flatMap(raw => {
    const job = record(raw);
    if (!job || !text(job.id).trim()) return [];
    const kind = documentKind(job.kind);
    const accountLabel = safeAccount(record(job.result)?.masked_account);
    return [{
      id: text(job.id),
      contractId: text(job.contract_id).trim() || undefined,
      contractReference: text(job.contract_reference).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80) || undefined,
      documentKind: kind,
      title: kind === 'contract' ? '계약서 접수' : kind === 'request' ? '대출 실행 요청' : '서류 접수',
      ...activityPresentation(job),
      receivedAt: isoTime(job.created_at),
      ...(accountLabel ? {accountLabel} : {}),
    }];
  });
}

export function customerTransactions(activities: readonly CustomerAppActivity[]) {
  const groups = new Map<string, {id: string; label: string; reference?: string; receivedAt: string; activities: CustomerAppActivity[]}>();
  for (const activity of activities) {
    // Unlinked records remain separate; never infer a relationship from time/order.
    const id = activity.contractId || 'unlinked:' + activity.id;
    let group = groups.get(id);
    if (!group) {
      group = {id, label: activity.contractId ? '계약 서류 접수' : '계약 연결 정보 없음', receivedAt: '', activities: []};
      groups.set(id, group);
    }
    if (activity.contractReference && (!group.reference || activity.documentKind === 'contract')) {
      group.reference=activity.contractReference;group.label='계약 '+activity.contractReference;
    }
    group.activities.push(activity);
    if (activity.receivedAt > group.receivedAt) group.receivedAt = activity.receivedAt;
  }
  return [...groups.values()].map(group => ({...group,
    activities: [...group.activities].sort((a,b) => b.receivedAt.localeCompare(a.receivedAt)),
    requestCount: group.activities.filter(a => a.documentKind === 'request').length,
    needsAttention: group.activities.some(a => a.status === '추가 확인 필요'),
  })).sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** Resolve only an explicit source receipt, never a similar timestamp or contract. */
export function customerNoticeActivity(notice: CustomerAppNotice, activities: readonly CustomerAppActivity[]) {
  if (!notice.jobId) return undefined;
  const kind = notice.documentKind !== 'document' ? notice.documentKind : notice.kind === 'warning' ? 'request' : undefined;
  return activities.find(activity => activity.id === notice.jobId && (!kind || activity.documentKind === kind))
    || (kind ? activities.find(activity => activity.id === notice.jobId + ':' + kind && activity.documentKind === kind) : undefined);
}
