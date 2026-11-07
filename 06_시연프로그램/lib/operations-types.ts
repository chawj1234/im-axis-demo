export type OperationsRole = 'banker' | 'admin';
export type ReviewGrade = 1 | 2 | 3 | 4 | 5 | 6;
export type ComparisonStatus = 'match' | 'mismatch' | 'unknown';

export interface OperationsSource {name: string; url?: string; page?: number}
export interface OperationsCheck {
  key: 'basic_comparison' | 'contract_reference' | 'company_name' | 'payout_account' | 'contract_limit' | 'business_identifier' | 'payout_bank' | 'payout_holder' | 'credit_product' | 'declared_credit_limit' | 'credit_period' | 'outstanding_arithmetic' | 'available_arithmetic' | 'fund_purpose';
  label: string;
  contractValue: string;
  requestValue: string;
  status: ComparisonStatus;
  note?: string;
  sources?: OperationsSource[];
}
export interface OperationsLog {at: string; label: string; detail?: string}
export interface OperationsValidationFailure {
  name: string;
  fields: {field: string; label: string}[];
  /** Owned explanation only; provider reasons can contain document values. */
  reason: string;
}
export interface OperationsRequest {
  id: string;
  contractId?: string;
  receiptId: string;
  originalReceiptId?: string;
  receivedAt: string;
  companyName: string;
  contractReference: string;
  contractAmount: number | null;
  requestedAmount: number | null;
  ratio: number | null;
  grade: ReviewGrade | null;
  gradeReason?: '추출값 확인 필요' | '처리 실패' | '대조 결과 없음' | '이전 판정 기준' | '판정 근거 확인 필요';
  processing: 'completed' | 'processing' | 'failed' | 'unknown';
  checks: OperationsCheck[];
  validationFailures?: OperationsValidationFailure[];
  extractedFields?: string[];
  policyVersion?: string;
  studio?: {decision: string | null; reason: string | null; jobId: string | null; url: string | null;
    collectionStatus: 'unconfirmed' | 'stored'; configurationMode: 'latest' | 'pinned'; resolvedConfigId: string | null};
  purposeReview?: OperationsCheck;
  files: OperationsSource[];
  logs: OperationsLog[];
  customerNotification?: {receiptAt?: string; mismatchAt?: string; displayedAt?: string};
}
export interface OperationsReceipt {
  id: string;
  originalReceiptId?: string;
  receivedAt: string;
  fileNames: string[];
  companyName?: string;
  status: 'received' | 'failed';
  stateLabel?: string;
  outcome?: 'extraction_failed' | 'technical_error' | 'registered' | 'compared';
  documentStatus?: 'checking' | 'completed' | 'needs_attention' | 'routing' | 'continued';
  routing?: {detectedKind: 'contract' | 'request'; message: string; canContinue: boolean; continuedAs?: string};
  error?: string;
  kind?: 'contract' | 'request';
  contractReference?: string;
}
export interface OperationsContract {
  id: string;
  reference: string;
  companyName: string;
  amount: number | null;
  registeredAt: string;
  fileName: string;
  status: 'registered';
}
export interface OperationsSnapshot {
  contracts?: OperationsContract[];
  receipts: OperationsReceipt[];
  requests: OperationsRequest[];
  collectionScope?: boolean;
  updatedAt: string | null;
}
export interface OperationsMetrics {
  totalRequests: number;
  comparedRequests: number;
  mismatchRequests: number;
  mismatchRate: number | null;
  unevaluatedRequests: number;
  gradeCounts: {grade: ReviewGrade | null; count: number}[];
  mismatchFields: {key: OperationsCheck['key']; label: string; count: number}[];
}
export interface IntakeReceiptResult {receiptId: string; receivedAt: string; duplicate?: boolean}
