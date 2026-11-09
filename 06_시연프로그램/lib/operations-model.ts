import {STUDIO_OPERATIONS_POLICY_VERSION} from './studio-operations-model.mjs';
import type {OperationsMetrics, OperationsRequest} from './operations-types';

// Preview fixtures retain their display check sets; grades always come from their source.
const checkDefinitions = [
  {key: 'contract_reference', label: '계약번호'},
  {key: 'company_name', label: '기업명'},
  {key: 'payout_account', label: '수취계좌'},
  {key: 'contract_limit', label: '총 계약금액 이내 요청'},
] as const;
const expandedCheckDefinitions = [...checkDefinitions,
  {key:'business_identifier',label:'사업자등록번호'}, {key:'payout_bank',label:'수취은행'},
  {key:'payout_holder',label:'수취계좌 예금주'}, {key:'credit_product',label:'여신과목'},
  {key:'declared_credit_limit',label:'요청서 승인한도'}, {key:'credit_period',label:'지급 희망일·여신기간'},
  {key:'outstanding_arithmetic',label:'실행 후 예상 잔액'}, {key:'available_arithmetic',label:'실행 후 예상 한도여유'},
] as const;
const studioCheckDefinitions = [{key:'basic_comparison',label:'기본정보 종합 대조'}, ...expandedCheckDefinitions.filter(({key}) => ['credit_period','outstanding_arithmetic','available_arithmetic'].includes(key))] as const;
const definitionsFor = (policy?: string) => policy === 'contract-request-expanded-grade-v2' ? expandedCheckDefinitions : checkDefinitions;
/** Missing information is never a match. A confirmed mismatch is counted once. */
function completeComparison(request: OperationsRequest): boolean {
  return request.processing === 'completed' && request.grade !== null && (request.policyVersion === STUDIO_OPERATIONS_POLICY_VERSION ? studioCheckDefinitions : definitionsFor(request.policyVersion)).every(({key}) => {
    const checks = request.checks.filter(check => check.key === key);
    return checks.length === 1 && checks[0].status !== 'unknown';
  });
}

/** Field navigation uses the same confirmed evidence as the chart counts. */
export function operationsFieldMismatch(request: OperationsRequest, key: OperationsRequest['checks'][number]['key']): boolean {
  if (!completeComparison(request) || (request.policyVersion === STUDIO_OPERATIONS_POLICY_VERSION && request.grade === 6)) return false;
  const checks = request.checks.filter(check => check.key === key);
  return checks.length === 1 && checks[0].status === 'mismatch';
}

/** mismatchRate uses compared requests as its denominator; pending/failed are excluded. */
export function operationsMetrics(requests: OperationsRequest[]): OperationsMetrics {
  const unique = [...new Map(requests.map(request => [request.id, request])).values()];
  const compared = unique.filter(completeComparison);
  // Show every comparison criterion; aggregate evidence cannot identify a failed field.
  const fieldDefinitions = expandedCheckDefinitions;
  const mismatches = compared.filter(request => request.policyVersion === STUDIO_OPERATIONS_POLICY_VERSION ? request.grade !== 6 : request.checks.some(check => check.status === 'mismatch'));
  return {
    totalRequests: unique.length,
    comparedRequests: compared.length,
    mismatchRequests: mismatches.length,
    mismatchRate: compared.length ? mismatches.length / compared.length * 100 : null,
    unevaluatedRequests: unique.filter(request => request.grade === null || request.processing !== 'completed').length,
    gradeCounts: [...([1, 2, 3, 4, 5, 6] as const).map(grade => ({grade, count: unique.filter(request => request.processing === 'completed' && request.grade === grade).length})),
      {grade: null, count: unique.filter(request => request.grade === null || request.processing !== 'completed').length}],
    mismatchFields: fieldDefinitions.map(({key, label}) => ({key, label,
      count: mismatches.filter(request => {
        return operationsFieldMismatch(request, key);
      }).length,
      unavailableCount: compared.filter(request => {
        const checks = request.checks.filter(check => check.key === key);
        return checks.length !== 1 || checks[0].status === 'unknown';
      }).length,
    })),
  };
}
