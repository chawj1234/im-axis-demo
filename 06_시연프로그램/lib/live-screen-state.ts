// Presentation of saved application state. No provider calls or grading rules.
export interface AssessmentState {
  message?: string;
  evaluation_status?: string;
  final_grade?: number | null;
  warning_required?: boolean;
  confirmed_mismatches?: readonly unknown[];
  unconfirmed_items?: readonly unknown[];
}

export interface JobState {
  kind?: string;
  stage?: string;
  delayed_at?: string | null;
  review_status?: string;
  result?: AssessmentState | null;
  late_result?: {result?: AssessmentState | null} | null;
}

export function processingLabel(job: JobState): string {
  if (job.stage === 'ended') return '자동 확인 종료';
  if (job.stage === 'failed') return '처리 실패';
  if (job.stage === 'completed') return job.kind === 'contract' ? '분석·등록 완료' : '분석·대조 완료';
  if (job.delayed_at) return '처리 지연';
  return job.stage === 'received' ? '접수 완료' : '분석 중';
}

export function assessmentLabel(result?: AssessmentState | null): string {
  if (!result) return '결과 대기';
  if (result.evaluation_status === 'incomplete') return '미완료 · 등급 없음';
  const grade = result.final_grade;
  if (result.evaluation_status === 'completed' && typeof grade === 'number' && Number.isInteger(grade) && grade >= 1 && grade <= 4) {
    const names = ['', '매우 높음', '높음', '주의', '낮음'];
    return `${grade}등급 · ${names[grade]}`;
  }
  return result.evaluation_status === 'pending' ? '평가 대기' : '등급 미확인';
}

export function reviewPresentation(job: JobState): {label: string; canRecord: boolean} {
  if (job.kind !== 'request') return {label: '계약 기준정보 등록', canRecord: false};
  const result = job.result;
  const normal = job.stage === 'completed'
    && result?.evaluation_status === 'completed' && result.final_grade === 4
    && result.warning_required === false
    && !result.confirmed_mismatches?.length && !result.unconfirmed_items?.length;
  if (normal) return {label: '개별 검토 생략', canRecord: false};
  const needsReview = ['ended', 'failed', 'completed'].includes(job.stage || '') || !!job.late_result;
  if (!needsReview) return {label: '결과 대기', canRecord: false};
  return {label: job.review_status === 'confirmed' ? '확인 기록됨' : '확인 전', canRecord: true};
}

export function hasConfirmedWarning(job: JobState): boolean {
  return job.result?.warning_required === true || job.late_result?.result?.warning_required === true;
}

export function customerProgressMessage(job: JobState): string {
  if (job.stage === 'ended') return '12분 자동 확인이 종료되었습니다. 작업 실패나 취소를 뜻하지 않습니다.';
  if (job.stage === 'failed') return '문서 처리를 완료하지 못해 별도 검토자가 확인합니다. 기존 접수 안내와 확인된 경고는 유지됩니다.';
  if (job.stage === 'completed' && job.result?.message) return job.result.message;
  if (job.delayed_at) return '처리가 지연되고 있습니다. 새 분석 없이 기존 작업을 확인합니다.';
  return '접수된 문서의 분석 결과를 확인하고 있습니다.';
}
