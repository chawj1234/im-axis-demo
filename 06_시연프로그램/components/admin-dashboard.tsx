'use client';

import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {AlertCircle, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, FileCheck2, FileText, Info, Search, ShieldAlert, X} from 'lucide-react';
import type {OperationsCheck, OperationsContract, OperationsMetrics, OperationsRequest, OperationsSource, ReviewGrade} from '../lib/operations-types';
import {formatReceiptId, formatDateTime, formatRatio, formatWon, operationsRequestStatus as requestState, operationsStatusLabels as stateLabels, prioritizeOperationsChecks, operationsRequestScope, operationsStatusCounts, operationsProcessingCounts, operationsCheckStatusLabel} from '../lib/operations-format';
import {operationsFieldMismatch, operationsMetrics} from '../lib/operations-model';
import DocumentViewer from './document-viewer';
import type {StaffAlert} from './staff-alert-banner';
import './admin-dashboard.css';
import './document-review-actions.css';

type RequestFilter = 'all' | 'extraction' | ReturnType<typeof requestState>;
type DetailTab = 'comparison' | 'history';

const gradeNames: Record<ReviewGrade, string> = {1: '1등급', 2: '2등급', 3: '3등급', 4: '4등급', 5: '5등급', 6: '6등급'};
const gradeRanges: Record<ReviewGrade, string> = {1: '80% 초과', 2: '60% 초과 ~ 80%', 3: '40% 초과 ~ 60%', 4: '20% 초과 ~ 40%', 5: '20% 이하', 6: '등급 판정 항목 일치'};
const numberLabel = (value: number) => new Intl.NumberFormat('ko-KR').format(value);

const comparisonLabels: Partial<Record<OperationsCheck['key'], string>> = {
  contract_reference:'계약번호',company_name:'기업명',payout_account:'수취계좌',contract_limit:'총 계약금액 이내 요청',
  business_identifier:'사업자등록번호',payout_bank:'수취은행',payout_holder:'수취계좌 예금주',credit_product:'여신과목',declared_credit_limit:'요청서 승인한도',
};
const comparisonLabel = (check: OperationsCheck) => comparisonLabels[check.key] || check.label;

function mismatchLabels(request: OperationsRequest): string {
  const status = requestState(request);
  if (status === 'processing') return '문서 분석·대조 진행 중';
  if (status === 'failed') return request.gradeReason === '추출값 확인 필요' ? '필수값 추출 실패' : '처리 이력에서 오류 확인';
  if (status === 'review') return '원문과 처리 이력 확인';
  const labels = request.checks.filter(check => check.key !== 'basic_comparison' && check.status === 'mismatch').map(comparisonLabel);
  if (labels.length) return labels.length > 1 ? `${labels[0]} 외 ${numberLabel(labels.length - 1)}개` : labels[0];
  if (requestState(request) === 'match') return '등급 판정 항목 일치';
  return '불일치 항목 확인';
}

function RequestBadge({request, large = false}: {request: OperationsRequest; large?: boolean}) {
  const status = requestState(request);
  const grade = status === 'match' || status === 'mismatch' ? request.grade : null;
  return <span className={`adm-grade adm-grade-${grade ?? 'none'} adm-status-${status}${large ? ' adm-grade-large' : ''}`}>
    {status === 'match' ? <Check size={14} aria-hidden="true" /> : status === 'mismatch' || status === 'failed' ? <AlertCircle size={14} aria-hidden="true" /> : status === 'review' ? <CircleHelp size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
    {grade === null ? request.studio?.decision === '미평가' ? '미평가' : request.gradeReason === '추출값 확인 필요' ? '필수값 추출 실패' : stateLabels[status] : `${gradeNames[grade]} · ${stateLabels[status]}`}
  </span>;
}

function safeDocumentUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? url : undefined;} catch {return undefined;}
}

function safeStudioUrl(value?: string | null): string | undefined {
  try {const url = new URL(value || '');return url.origin === 'https://studio.upstage.ai' && !url.username && !url.password
    && /^\/agents\/agt_[A-Za-z0-9_-]+$/.test(url.pathname) ? url.href : undefined;} catch {return undefined;}
}

function SourceLink({source, compact = false, onOpen}: {source: OperationsSource; compact?: boolean; onOpen: (source: OperationsSource) => void}) {
  const href = safeDocumentUrl(source.url);
  const label = `${source.name}${compact && source.page ? ` · ${source.page}쪽` : ''}`;
  return href ? <button type="button" className={`adm-source${compact ? ' adm-source-compact' : ''}`} onClick={() => onOpen(source)} aria-label={`${label} 전체 원문 보기`}>
    <FileText size={compact ? 14 : 18} aria-hidden="true" /><span>{label}</span><ArrowRight size={14} aria-hidden="true" />
  </button> : <span className={`adm-source adm-source-unlinked${compact ? ' adm-source-compact' : ''}`}><FileText size={compact ? 14 : 18} aria-hidden="true" /><span>{label}</span>{!compact && <small>원문 연결 없음</small>}</span>;
}

function ComparisonItem({check, onOpen}: {check: OperationsCheck; onOpen: (source: OperationsSource) => void}) {
  return <article className={`adm-check adm-check-${check.status}`}>
    <div className="adm-check-heading"><h3>{comparisonLabel(check)}</h3><span className={`adm-check-result adm-check-result-${check.status}`}>
      {check.status === 'match' ? <Check size={14} aria-hidden="true" /> : check.status === 'mismatch' ? <AlertCircle size={14} aria-hidden="true" /> : <CircleHelp size={14} aria-hidden="true" />}{operationsCheckStatusLabel(check)}
    </span></div>
    <div className="adm-check-values"><div><span>{check.key.endsWith('_arithmetic') ? '산식 기준값' : '계약서 기준'}</span><strong>{check.contractValue || '미확인'}</strong></div><ArrowRight size={16} aria-hidden="true" /><div><span>실행 요청서</span><strong>{check.requestValue || '미확인'}</strong></div></div>
    {check.key.endsWith('_arithmetic') && <p className="adm-check-note">요청서에 적힌 값의 산식만 확인합니다. 실제 거래대장 잔액은 검증하지 않습니다.</p>}
    {check.note && ['credit_period','outstanding_arithmetic','available_arithmetic','fund_purpose'].includes(check.key) && <p className="adm-check-note">{check.note}</p>}
    {!!check.sources?.length && <div className="adm-check-sources" aria-label={`${check.label} 원문 근거`}>{check.sources.map((source, index) => <SourceLink key={`${source.name}-${index}`} source={source} compact onOpen={onOpen} />)}</div>}
  </article>;
}

function ComparisonTable({checks,onOpen}:{checks:OperationsCheck[];onOpen:(source:OperationsSource)=>void}) {
  return <div className="adm-compact-table"><table><thead><tr><th>항목</th><th>계약서 · 산식 기준</th><th>실행 요청서</th><th>결과</th></tr></thead><tbody>{checks.map(check=><tr key={check.key}><th scope="row">{comparisonLabel(check)}</th><td>{check.contractValue || '확인 필요'}</td><td>{check.requestValue || '확인 필요'}</td><td>{operationsCheckStatusLabel(check)}{check.key.endsWith('_arithmetic') && <small>문서 내 산식 검사</small>}{!!check.sources?.length && check.sources.map((source,index)=><SourceLink key={index} source={source} compact onOpen={onOpen}/>)}</td></tr>)}</tbody></table></div>;
}

function RequestDetail({request, onBack, reviewAlert, retryContent}: {request: OperationsRequest; onBack: () => void; reviewAlert?: StaffAlert; retryContent?: ReactNode}) {
  const [tab, setTab] = useState<DetailTab>(() => requestState(request) === 'review' && !request.validationFailures?.length || requestState(request) === 'failed' && request.gradeReason !== '추출값 확인 필요' ? 'history' : 'comparison');
  const [selectedDocument, setDocument] = useState<OperationsSource | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const status = requestState(request);
  const studio = request.studio;
  const studioUrl = safeStudioUrl(studio?.url);
  const validationFailed = (request.processing === 'failed' && request.gradeReason === '추출값 확인 필요') || !!request.validationFailures?.length;
  const comparisonAvailable = !validationFailed && request.processing !== 'failed' && request.processing !== 'processing';
  const comparisonChecks = request.checks.filter(check => check.key !== 'basic_comparison');
  const mismatchChecks = comparisonChecks.filter(check => check.status === 'mismatch');
  const allChecks = [...comparisonChecks, ...(request.purposeReview ? [request.purposeReview] : [])];
  const attentionChecks = prioritizeOperationsChecks(allChecks).filter(check => check.status === 'mismatch');
  const reviewChecks = allChecks.filter(check => check.status === 'unknown');
  const matchedChecks = allChecks.filter(check => check.status === 'match');
  const barWidth = request.ratio !== null && Number.isFinite(request.ratio) ? Math.max(0, Math.min(100, request.ratio)) : 0;
  useEffect(() => {heading.current?.focus();}, [request.id]);
  return <section className="adm-dashboard adm-detail" aria-labelledby="adm-detail-title">
    <button className="adm-back" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />관리 현황으로</button>
    <div className="adm-detail-title"><div><h2 ref={heading} tabIndex={-1} id="adm-detail-title">{request.companyName || (validationFailed ? '추출 검증 실패 문서' : '기업명 미확인')}</h2><p className="adm-detail-id">{request.studio?.collectionStatus === 'stored' ? '요청번호' : '접수번호'} {request.originalReceiptId || request.receiptId} <span aria-hidden="true">·</span> {formatDateTime(request.receivedAt)} {request.originalReceiptId ? '재분석 요청' : '접수'}</p></div><RequestBadge request={request} large /></div>

    <div className={`adm-decision adm-decision-${status === 'match' || status === 'mismatch' ? status : 'unevaluated'}`}>
      <span className="adm-decision-icon">{status === 'match' ? <CheckCheck size={24} aria-hidden="true" /> : status === 'mismatch' ? <ShieldAlert size={24} aria-hidden="true" /> : <CircleHelp size={24} aria-hidden="true" />}</span>
      <div className="adm-decision-copy"><h2>{status === 'match' ? '등급 판정 항목에서 불일치가 없습니다.' : status === 'mismatch' ? studio ? '등록 계약과 요청 정보에서 불일치가 확인되었습니다.' : mismatchChecks.length ? `${mismatchChecks.length}개 항목에서 불일치가 확인되었습니다.` : '문서 항목에서 불일치가 확인되었습니다.' : status === 'failed' ? validationFailed || reviewAlert?.supplement_required ? '원문과 추출값을 확인해 주세요.' : '문서 처리를 완료하지 못했습니다.' : status === 'processing' ? '문서 분석·대조를 진행하고 있습니다.' : '대조 결과를 확인해 주세요.'}</h2><p>{status === 'match' ? '대출 승인 여부와는 별개의 문서 대조 결과입니다.' : status === 'mismatch' ? `요청 비율 ${formatRatio(request.ratio)}${request.grade ? ` · ${gradeNames[request.grade]}${studio ? '' : ` (${gradeRanges[request.grade]})`}` : ''}` : status === 'failed' ? validationFailed || reviewAlert?.supplement_required ? '원문에 값이 있으면 추출값을 확인하고, 없으면 문서를 보완해 주세요.' : '처리 이력에서 오류와 담당자 알림을 확인하세요. 처리 실패를 문서 불일치로 판정하지 않습니다.' : status === 'processing' ? '처리가 끝나면 결과를 확인할 수 있습니다. 진행 중인 요청은 대조 완료 통계에서 제외합니다.' : '등급을 확정할 결과나 근거가 부족하거나 현재 등급 기준을 적용할 수 없습니다. 원문과 처리 이력을 확인하세요.'}</p>{request.gradeReason && !validationFailed && <p>등급 미산정 · {validationFailed ? '필수값 추출 실패' : request.gradeReason}</p>}{studio?.reason && status !== 'match' && status !== 'mismatch' ? <p>{studio.reason}</p> : null}</div>
      {studioUrl ? <div className="document-retry"><div className="document-review-actions"><a href={studioUrl} target="_blank" rel="noopener noreferrer">Studio에서 확인<ArrowRight size={14} aria-hidden="true" /></a></div><details className="document-review-ids"><summary>작업 정보</summary><p>{studio?.configurationMode === 'latest' ? '최신 저장 설정' : '고정 설정'} · 확인된 버전 {studio?.resolvedConfigId || '미제공'}</p><code>{studio?.jobId || '작업 ID 미제공'}</code></details></div> : null}
      {retryContent}
    </div>

    <div className="adm-detail-layout">
      <div className="adm-detail-main">
        <section className={`adm-panel adm-amount-panel${status === 'match' || status === 'mismatch' ? '' : ' adm-amount-compact'}`} aria-labelledby="adm-amount-title">
          <div className="adm-panel-header"><div><h2 id="adm-amount-title">계약 대비 실행 요청 금액</h2></div><Info size={17} aria-hidden="true" /></div>
          <div className="adm-amount-grid"><div><span>총 계약금액</span><strong>{validationFailed && request.contractAmount === null ? '대조 전' : formatWon(request.contractAmount)}</strong></div><div><span>이번 실행 요청금액</span><strong>{validationFailed && request.requestedAmount === null ? '대조 전' : formatWon(request.requestedAmount)}</strong></div><div className="adm-amount-ratio"><span>계약 대비 비율</span><strong>{validationFailed && request.ratio === null ? '대조 전' : formatRatio(request.ratio)}</strong></div></div>
          {(status === 'match' || status === 'mismatch') && <><div className="adm-ratio-track" aria-hidden="true"><span className={status === 'mismatch' ? 'adm-ratio-mismatch' : ''} style={{width: `${barWidth}%`}} />{[20, 40, 60, 80].map(point => <i key={point} style={{left: `${point}%`}} />)}</div>
          <div className="adm-ratio-labels" aria-hidden="true"><span>0%</span><span>20%</span><span>40%</span><span>60%</span><span>80%</span><span>100%</span></div></>}
        </section>

        <section className="adm-panel adm-detail-results" aria-label="요청 상세 정보">
          <div className="adm-detail-tabs" role="tablist" aria-label="요청 상세 보기"><button type="button" role="tab" id="adm-comparison-tab" aria-selected={tab === 'comparison'} aria-controls="adm-comparison-panel" tabIndex={tab === 'comparison' ? 0 : -1} onClick={() => setTab('comparison')} onKeyDown={event => {if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {event.preventDefault(); setTab('history'); document.getElementById('adm-history-tab')?.focus();}}}><FileCheck2 size={17} aria-hidden="true" />{validationFailed ? '필수정보 확인' : request.processing === 'failed' ? '처리 안내' : request.processing === 'processing' ? '진행 상태' : '항목별 대조'}{comparisonAvailable && <span>{comparisonChecks.length}</span>}</button><button type="button" role="tab" id="adm-history-tab" aria-selected={tab === 'history'} aria-controls="adm-history-panel" tabIndex={tab === 'history' ? 0 : -1} onClick={() => setTab('history')} onKeyDown={event => {if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {event.preventDefault(); setTab('comparison'); document.getElementById('adm-comparison-tab')?.focus();}}}><Clock3 size={17} aria-hidden="true" />처리 이력 <span>{request.logs.length}</span></button></div>
          <div role="tabpanel" id="adm-comparison-panel" aria-labelledby="adm-comparison-tab" hidden={tab !== 'comparison'} tabIndex={0} className="adm-tab-content">
            {!comparisonAvailable ? <section className="adm-validation-review" aria-label={validationFailed ? '필수정보 확인' : request.processing === 'processing' ? '문서 처리 중' : '처리 오류 안내'}>
              {!validationFailed && <h3>{request.processing === 'processing' ? '문서 분석·대조 진행 중' : '문서 처리 오류'}</h3>}
              {validationFailed ? <>

                {request.validationFailures?.length ? <ul>{request.validationFailures.map((failure, index) => <li key={`${failure.name}-${index}`}><strong>{failure.fields.length ? failure.fields.map(field => field.label).join(' · ') : failure.name}</strong><p>{failure.reason === '추출값이 비어 있어 검증을 통과하지 못했습니다.' ? '추출값 없음' : failure.reason}</p></li>)}</ul> : <p>확인할 항목은 Studio 검증 결과에서 확인해 주세요.</p>}{!!request.extractedFields?.length && <details className="adm-matched-checks"><summary>추출 확인 항목 {request.extractedFields.length}개 <ChevronDown size={16} aria-hidden="true" /></summary><ul className="adm-extracted-fields">{request.extractedFields.map(field => <li key={field}>{field}</li>)}</ul></details>}
              </> : <p>{request.processing === 'processing' ? '처리가 끝나면 항목별 대조 결과를 표시합니다.' : '처리를 완료하지 못해 대조 결과가 없습니다. 실패한 필드로 단정할 근거가 없으므로 처리 이력의 오류를 확인해 주세요.'}</p>}
            </section> : comparisonChecks.length ? <><div className="adm-check-list">{attentionChecks.map(check => <ComparisonItem key={check.key} check={check} onOpen={setDocument} />)}</div>{reviewChecks.length > 0 && <details className="adm-matched-checks"><summary>확인 필요 항목 {reviewChecks.length}개 <ChevronDown size={16} aria-hidden="true" /></summary><div className="adm-check-list">{reviewChecks.map(check => <ComparisonItem key={check.key} check={check} onOpen={setDocument} />)}</div></details>}{matchedChecks.length > 0 && <details className="adm-matched-checks"><summary>일치 항목 {matchedChecks.length}개 <ChevronDown size={16} aria-hidden="true" /></summary><ComparisonTable checks={matchedChecks} onOpen={setDocument}/></details>}</> : <div className="adm-empty adm-empty-small"><FileText size={26} aria-hidden="true" /><h3>{status === 'mismatch' ? '불일치 항목의 세부 결과가 없습니다.' : '대조할 항목이 아직 없습니다.'}</h3><p>항목별 결과와 원문을 확인해 주세요.</p></div>}
          </div>
          <div role="tabpanel" id="adm-history-panel" aria-labelledby="adm-history-tab" hidden={tab !== 'history'} tabIndex={0} className="adm-tab-content">
            <p className="adm-result-intro">{studio ? "접수와 Studio 처리 상태를 기록합니다. 분석 완료와 컬렉션 저장 확인은 구분합니다." : "개인정보 감지 결과는 처리 로그로만 관리하며 등급에 반영하지 않습니다."}</p>
            {request.logs.length ? <ol className="adm-timeline">{request.logs.map((log, index) => <li key={`${log.at}-${index}`}><span className="adm-timeline-dot" aria-hidden="true" /><div><time dateTime={log.at}>{formatDateTime(log.at)}</time><h3>{log.label}</h3>{log.detail && <p>{log.detail}</p>}</div></li>)}</ol> : <div className="adm-empty adm-empty-small"><Clock3 size={26} aria-hidden="true" /><h3>기록된 처리 이력이 없습니다.</h3></div>}
          </div>
        </section>
      </div>

      <aside className="adm-detail-side" aria-label="접수 문서와 등급 기준">
        <section className="adm-panel adm-side-panel"><div className="adm-panel-header"><h2><FileText size={18} aria-hidden="true" />접수 문서</h2><span className="adm-count-pill">{request.files.length}</span></div><div className="adm-document-list">{request.files.length ? request.files.map((file, index) => <SourceLink key={`${file.name}-${index}`} source={file} onOpen={setDocument} />) : <p className="adm-side-empty">연결된 문서가 없습니다.</p>}</div><div className="adm-side-foot"><span>계약번호</span><strong>{request.contractReference || (validationFailed ? '대조 전' : '미확인')}</strong></div></section>
        <details className="adm-panel adm-side-panel adm-policy adm-fold"><summary><Info size={18} aria-hidden="true" /><span>문서 대조 등급 기준 보기</span><ChevronDown className="adm-fold-toggle" size={18} aria-hidden="true" /></summary><div><p>검증 항목에 불일치가 없으면 금액 비율과 관계없이 6등급입니다.</p><p>하나라도 불일치하면, 이번 요청금액이 총 계약금액에서 차지하는 비율로 5~1등급을 정합니다. 이 비율이 클수록 1등급에 가까워집니다.</p><p><strong>금액 비율 = 이번 요청금액 ÷ 총 계약금액 × 100</strong></p><p>요청 금액이 총 계약금액 이내인지 확인하며, 두 금액이 같아야 하는 것은 아닙니다.</p><p>필수값이 누락되거나 확인되지 않으면 등급을 매기지 않습니다.</p><div className="adm-policy-grades" aria-label="불일치 요청의 금액 비율별 등급">{([5, 4, 3, 2, 1] as ReviewGrade[]).map(grade => <span key={grade}><b>{grade}등급</b>{gradeRanges[grade]}</span>)}</div></div></details>
      </aside>
    </div>
    {selectedDocument && <DocumentViewer files={request.files} initialSource={selectedDocument} onClose={() => setDocument(null)} />}
  </section>;
}

export default function AdminDashboard({requests, metrics, contracts = [], selectedId, onSelectRequest: setSelectedId, reviewAlerts = [], retryContent, recordsState = 'ready', collectionScope = false}: {collectionScope?: boolean; recordsState?: 'loading' | 'error' | 'ready'; requests: OperationsRequest[]; metrics: OperationsMetrics; contracts?: OperationsContract[]; selectedId: string | null; onSelectRequest: (id: string | null) => void; reviewAlerts?: StaffAlert[]; retryContent?: ReactNode}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [contractId, setContractId] = useState('');
  const [gradeFilter, setGradeFilter] = useState<ReviewGrade | null | undefined>(undefined);
  const [fieldFilter, setFieldFilter] = useState<OperationsCheck['key'] | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const previousTrigger = useRef<HTMLButtonElement | null>(null);
  const selected = requests.find(request => request.id === selectedId);
  // Filter choices from observed requests are references, not a registration ledger.
  const referenceContracts = !contracts.length && requests.some(request => request.studio);
  const contractOptions = referenceContracts ? [...new Map(requests.filter(request => request.contractId)
    .map(request => [request.contractId!, {id: request.contractId!, reference: request.contractReference,
      companyName: '', amount: request.contractAmount}])).values()] : contracts;
  const scoped = useMemo(() => operationsRequestScope(requests, {contractId, search}), [requests, contractId, search]);
  const counts = useMemo(() => operationsStatusCounts(scoped), [scoped]);
  const processingCounts = useMemo(() => operationsProcessingCounts(requests), [requests]);
  const scopeMetrics = useMemo(() => operationsMetrics(scoped), [scoped]);
  const gradeScope = useMemo(() => scoped.filter(request => gradeFilter === undefined || (requestState(request) === 'match' || requestState(request) === 'mismatch' ? request.grade : null) === gradeFilter), [scoped, gradeFilter]);
  const fieldMetrics = useMemo(() => operationsMetrics(gradeScope), [gradeScope]);
  const fieldLabel = fieldMetrics.mismatchFields.find(field => field.key === fieldFilter)?.label;
  const chartScopeLabel = [contractId ? '선택한 계약' : '', search.trim() ? '검색 결과' : '', gradeFilter === undefined ? '' : gradeFilter === null ? '항목별 통계: 등급 미산정' : `항목별 통계: ${gradeFilter}등급`].filter(Boolean).join(' · ');
  const filtered = useMemo(() => {
    const priority = {mismatch: 0, failed: 1, review: 2, processing: 3, match: 4};
    return gradeScope.filter(request => (filter === 'all' || (filter === 'extraction' ? request.processing === 'failed' && request.gradeReason === '추출값 확인 필요' : filter === 'failed' ? request.processing === 'failed' && request.gradeReason !== '추출값 확인 필요' : requestState(request) === filter)) && (!fieldFilter || operationsFieldMismatch(request, fieldFilter))).sort((a, b) => priority[requestState(a)] - priority[requestState(b)] || (a.grade ?? 7) - (b.grade ?? 7) || (Date.parse(b.receivedAt) || 0) - (Date.parse(a.receivedAt) || 0));
  }, [gradeScope, filter, fieldFilter]);
  const mismatchFields = fieldMetrics.mismatchFields.filter(field => field.count > 0);
  const otherFields = fieldMetrics.mismatchFields.filter(field => field.count === 0);
  const grades: (ReviewGrade | null)[] = [1, 2, 3, 4, 5, 6, null];
  const maxGradeCount = Math.max(...scopeMetrics.gradeCounts.map(item => item.count), 1);
  const openRequest = (request: OperationsRequest, trigger?: HTMLButtonElement) => {previousTrigger.current = trigger ?? null; setSelectedId(request.id);};
  const back = () => {setSelectedId(null); requestAnimationFrame(() => {const element = previousTrigger.current; if (element?.isConnected) element.focus(); else listHeading.current?.focus();});};
  const selectGrade = (grade: ReviewGrade | null) => {setGradeFilter(previous => previous === grade ? undefined : grade); setFieldFilter(null); setFilter('all');};
  const selectField = (key: OperationsCheck['key']) => {setFieldFilter(previous => previous === key ? null : key); setFilter('all'); requestAnimationFrame(() => {listHeading.current?.scrollIntoView({block:'start', behavior:'smooth'}); listHeading.current?.focus({preventScroll:true});});};

  const renderFieldRow = (field: OperationsMetrics['mismatchFields'][number]) => {
    const confirmed = fieldMetrics.comparedRequests - field.unavailableCount;
    const value = field.unavailableCount > 0 && confirmed === 0 ? '—' : numberLabel(field.count);
    return <div key={field.key} role="listitem"><button type="button" className="adm-field-row" disabled={field.count === 0} aria-pressed={fieldFilter === field.key} onClick={() => selectField(field.key)} aria-label={`${field.label}: ${value === '—' ? '개별 결과 미확인' : `${field.count}건`}${field.unavailableCount > 0 ? `, ${field.unavailableCount}건 집계 제외` : ''}${field.count > 0 ? ', 요청 목록 필터' : ''}`}><span className="adm-field-label">{field.label}{field.unavailableCount > 0 && confirmed > 0 && <small>{numberLabel(confirmed)}건의 결과 확인</small>}</span><strong>{value === '—' ? value : `${value}건`}</strong>{field.count > 0 && <ChevronRight size={16} aria-hidden="true" />}</button></div>;
  };

  if (selected) return <RequestDetail key={selected.id} request={selected} onBack={back} retryContent={retryContent} reviewAlert={reviewAlerts.find(alert => alert.job_id === selected.id)} />;

  if (recordsState !== 'ready' && !requests.length) return <section className="adm-dashboard" aria-label="문서 자동 대조 관리 현황"><div className="adm-panel adm-empty" role="status"><Clock3 size={26} aria-hidden="true"/><h2>{recordsState === 'loading' ? '접수 내역을 불러오는 중입니다.' : '접수 내역을 확인하지 못했습니다.'}</h2><p>{recordsState === 'loading' ? '기록 조회가 끝나면 현황을 표시합니다.' : '상단에서 접수 기록을 다시 불러와 주세요.'}</p></div></section>;

  return <section className="adm-dashboard" aria-label="문서 자동 대조 관리 현황">
    <div className="adm-metrics" aria-label="전체 요청과 처리 결과">
      {[['전체 요청', metrics.totalRequests],['평가 완료',processingCounts.evaluated],['미평가',processingCounts.incomplete],['처리 실패',processingCounts.failed],...(processingCounts.processing ? [['처리 중',processingCounts.processing]] : []),...(processingCounts.review ? [['결과 확인 필요',processingCounts.review]] : [])].map(([label,count])=><article className="adm-metric" key={label}><div className="adm-metric-top"><span>{label}</span></div><strong>{numberLabel(Number(count))}<small>건</small></strong></article>)}
    </div>

    <div className="adm-analytics">
      {chartScopeLabel && <p className="adm-charts-scope">{chartScopeLabel}</p>}
      <div className="adm-charts">
      <section className="adm-panel adm-grade-panel" aria-labelledby="adm-grade-chart-title"><div className="adm-panel-header"><div><h2 id="adm-grade-chart-title">문서 대조 등급별 요청 분포</h2><p>6등급은 검증 항목에 불일치가 없는 경우입니다. 불일치가 있으면 요청금액 비율이 클수록 1등급에 가까워집니다.</p></div><span className="adm-chart-unit">단위: 건</span></div><div className="adm-grade-chart" role="group" aria-label="등급별 요청 건수. 등급을 선택하면 항목별 통계와 요청 목록을 필터링합니다.">{grades.map(grade => {
        const count = scopeMetrics.gradeCounts.find(item => item.grade === grade)?.count ?? 0;
        return <button key={grade ?? 'none'} className={`adm-grade-column${gradeFilter === grade ? ' adm-grade-column-selected' : ''}`} onClick={() => selectGrade(grade)} aria-pressed={gradeFilter === grade} aria-label={`${grade === null ? '등급 미산정' : `${grade}등급`} ${count}건으로 요청 목록 필터${gradeFilter === grade ? ' 해제' : ''}`}><span className="adm-chart-value">{numberLabel(count)}</span><span className="adm-grade-bar-space"><span className={`adm-grade-bar adm-grade-bar-${grade ?? 'none'}`} style={{height: `${count / maxGradeCount * 100}%`, minHeight: count ? 5 : 0}} /></span><span className="adm-chart-label">{grade === null ? '등급 미산정' : `${grade}등급`}</span></button>;
      })}</div><p className="adm-chart-note"><Info size={14} aria-hidden="true" />등급 미산정은 처리 중·실패·결과 확인 필요 요청입니다. 등급을 누르면 항목별 통계와 요청 목록을 함께 볼 수 있습니다.</p></section>

      <section className="adm-panel adm-field-panel" aria-labelledby="adm-field-chart-title">
        <div className="adm-field-heading"><h2 className="adm-field-title" id="adm-field-chart-title">항목별 불일치 건수</h2></div>
        {mismatchFields.length > 0 ? <div className="adm-field-chart" role="list" aria-label="불일치가 발생한 대조 항목">{mismatchFields.map(renderFieldRow)}</div>
          : <p className="adm-field-empty" role="status">{fieldMetrics.comparedRequests === 0 ? '아직 집계할 대조 결과가 없습니다.' : otherFields.some(field => field.unavailableCount > 0) ? '확인된 항목에서 불일치가 없습니다.' : '선택한 범위에 불일치 항목이 없습니다.'}</p>}
        {otherFields.length > 0 && <details className="adm-field-more">
          <summary className="adm-field-summary"><span className="adm-field-show">나머지 {otherFields.length}개 항목 펼치기</span><span className="adm-field-hide">나머지 {otherFields.length}개 항목 접기</span><ChevronDown size={17} aria-hidden="true" /></summary>
          <div className="adm-field-chart" role="list" aria-label="불일치가 확인되지 않은 나머지 대조 항목">{otherFields.map(renderFieldRow)}</div>
        </details>}
      </section>
      </div>
    </div>

    <section className="adm-panel adm-request-panel" aria-labelledby="adm-request-title"><div className="adm-request-heading"><div><h2 ref={listHeading} tabIndex={-1} id="adm-request-title">요청 현황 <span>{numberLabel(filtered.length)}</span></h2></div><label className="adm-search"><Search size={17} aria-hidden="true" /><input type="search" placeholder="기업명, 계약번호, 접수번호 검색" aria-label="기업명, 계약번호, 접수번호로 요청 검색" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch('')} aria-label="검색어 지우기"><X size={15} aria-hidden="true" /></button>}</label></div>
      <div className="adm-list-tools"><label className="adm-contract-filter">계약<select aria-label="계약별 요청 보기" value={contractId} onChange={event => {setContractId(event.target.value); setFilter('all'); setGradeFilter(undefined); setFieldFilter(null);}}><option value="">{referenceContracts ? "확인된 계약번호" : "전체 계약"} · {contractOptions.length}건</option>{contractOptions.map(contract => <option key={contract.id} value={contract.id}>{contract.companyName ? contract.companyName + " · " : ""}{contract.reference}</option>)}</select></label>{contractId && contractOptions.filter(contract => contract.id === contractId).map(contract => <span className="adm-list-contract-info" key={contract.id}>총 계약금액 {formatWon(contract.amount)} · 연결 요청 {requests.filter(request => request.contractId === contract.id).length}건</span>)}</div>
      <div className="adm-request-controls"><div className="adm-filters" aria-label="처리 상태·대조 결과별 요청 필터">{(['all', 'match', 'mismatch', 'extraction', 'failed', 'review', 'processing'] as RequestFilter[]).map(value => <button type="button" key={value} className={filter === value ? 'adm-filter-active' : ''} aria-pressed={filter === value} onClick={() => {setFilter(value); setGradeFilter(undefined); setFieldFilter(null);}}>{value === 'all' ? '전체' : value === 'extraction' ? '필수값 추출 실패' : value === 'failed' ? '기술 오류' : stateLabels[value]}<span>{numberLabel(value === 'extraction' ? scoped.filter(request=>request.processing==='failed' && request.gradeReason==='추출값 확인 필요').length : value === 'failed' ? scoped.filter(request=>request.processing==='failed' && request.gradeReason!=='추출값 확인 필요').length : counts[value])}</span></button>)}</div>{gradeFilter !== undefined && <button type="button" className="adm-active-filter" onClick={() => {setGradeFilter(undefined); setFieldFilter(null);}}>{gradeFilter === null ? '등급 미산정' : `${gradeFilter}등급`}<X size={13} aria-label="등급 필터 해제" /></button>}{fieldFilter && <button type="button" className="adm-active-filter" onClick={() => setFieldFilter(null)}>{fieldLabel} 불일치<X size={13} aria-label="항목 필터 해제" /></button>}</div>
      <div className="adm-live-count" role="status" aria-live="polite">{recordsState !== 'ready' && !requests.length ? recordsState === 'loading' ? '접수 내역을 불러오는 중입니다.' : '접수 내역을 확인하지 못했습니다.' : contractId || search || filter !== 'all' || gradeFilter !== undefined || fieldFilter ? `전체 ${numberLabel(requests.length)}건 중 ${numberLabel(filtered.length)}건 표시` : ''}</div>
      {filtered.length ? <><div className="adm-table-wrap"><table className="adm-request-table"><caption className="adm-visually-hidden">실행 요청별 대조 결과. 기업명 또는 상세 보기 버튼을 눌러 상세 비교 결과를 확인할 수 있습니다.</caption><thead><tr><th scope="col">기업 · 번호</th><th scope="col">실행 요청 금액</th><th scope="col">상태 · 대조 결과</th><th scope="col">확인 항목</th><th scope="col" className="adm-table-time">{collectionScope ? '접수 · 실행 일시' : '접수 일시'}</th><th scope="col"><span className="adm-visually-hidden">상세 보기</span></th></tr></thead><tbody>{filtered.map(request => <tr key={request.id} className={`adm-request-row adm-row-${requestState(request)}`} onClick={() => openRequest(request)}><td><button type="button" className="adm-company-button" onClick={event => {event.stopPropagation(); openRequest(request, event.currentTarget);}}><strong>{request.companyName || (request.gradeReason === '추출값 확인 필요' ? '추출 검증 실패 문서' : '기업명 미확인')}</strong><span title={request.originalReceiptId || request.receiptId}>{formatReceiptId(request.originalReceiptId || request.receiptId)}</span></button></td><td><span className="adm-table-amount">{request.gradeReason === '추출값 확인 필요' && request.requestedAmount === null ? '대조 전' : formatWon(request.requestedAmount)}</span><span className="adm-table-ratio">계약 대비 {formatRatio(request.ratio)}</span></td><td><RequestBadge request={request} /></td><td className="adm-table-reason"><span>{mismatchLabels(request)}</span></td><td className="adm-table-time"><time dateTime={request.receivedAt}>{formatDateTime(request.receivedAt)}</time></td><td><button type="button" className="adm-row-open" aria-label={`${request.companyName || request.receiptId} 상세 보기`} onClick={event => {event.stopPropagation(); openRequest(request, event.currentTarget);}}><ChevronRight size={18} aria-hidden="true" /></button></td></tr>)}</tbody></table></div>
      <div className="adm-request-cards">{filtered.map(request => <button type="button" className={`adm-request-card adm-card-${requestState(request)}`} key={request.id} onClick={event => openRequest(request, event.currentTarget)}><div className="adm-card-top"><span><strong>{request.companyName || (request.gradeReason === '추출값 확인 필요' ? '추출 검증 실패 문서' : '기업명 미확인')}</strong><small title={request.originalReceiptId || request.receiptId}>{formatReceiptId(request.originalReceiptId || request.receiptId)}</small></span><RequestBadge request={request} /></div><div className="adm-card-amount"><strong>{request.gradeReason === '추출값 확인 필요' && request.requestedAmount === null ? '대조 전' : formatWon(request.requestedAmount)}</strong><span>계약 대비 {formatRatio(request.ratio)}</span></div><div className="adm-card-bottom"><span>{mismatchLabels(request)}</span><ChevronRight size={17} aria-hidden="true" /></div><time dateTime={request.receivedAt}>{formatDateTime(request.receivedAt)} {'접수'}</time></button>)}</div></> : <div className="adm-empty"><span className="adm-empty-icon">{requests.length ? <Search size={28} aria-hidden="true" /> : <ClipboardList size={28} aria-hidden="true" />}</span><h3>{!requests.length && recordsState !== 'ready' ? recordsState === 'loading' ? '접수 내역을 불러오는 중입니다.' : '접수 내역을 확인하지 못했습니다.' : requests.length ? '조건에 맞는 요청이 없습니다.' : '아직 접수된 실행 요청이 없습니다.'}</h3><p>{!requests.length && recordsState !== 'ready' ? recordsState === 'loading' ? '기록 조회가 끝나면 내역을 표시합니다.' : '기록 연결 상태를 확인한 뒤 새로고침해 주세요.' : requests.length ? '검색어나 필터를 바꾸어 다시 확인해 주세요.' : '실행 요청서가 접수되면 대조 현황을 이곳에서 확인할 수 있습니다.'}</p>{!!requests.length && <button type="button" className="adm-reset" onClick={() => {setSearch(''); setFilter('all'); setGradeFilter(undefined); setFieldFilter(null); setContractId('');}}>검색·필터 초기화</button>}</div>}
      <div className="adm-table-footer"><Info size={14} aria-hidden="true" /><p>불일치 요청은 항목 수와 관계없이 1건으로 집계합니다. 처리 중·필수값 추출 실패·기술 오류·결과 확인 필요 요청은 대조 결과에 포함하지 않습니다.</p></div>
    </section>
  </section>;
}
