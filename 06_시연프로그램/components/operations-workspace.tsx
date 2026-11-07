'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Image from 'next/image';
import {ArrowUpRight, ChevronRight, FileInput, LayoutDashboard, RefreshCw, Smartphone} from 'lucide-react';
import AdminDashboard from './admin-dashboard';
import BankerIntake from './banker-intake';
import StaffAlertBanner, {type StaffAlert} from './staff-alert-banner';
import {DocumentRetryAction} from './document-review-actions';
import DailyReportPanel from './daily-report-panel';
import {StudioCoworkerPanel} from './studio-coworker-panel';
import {normalizeStudioOperationsState} from '../lib/studio-operations-model.mjs';
import {readStudioSnapshot, type StudioConfig} from '../lib/studio-screen-types';
import {demoApiUrl} from '../lib/demo-api.mjs';
import {studioReviewForJob} from '../lib/studio-review-link.mjs';
import {normalizeOperationsState, operationsMetrics, registeredOperationsContracts} from '../lib/operations-model';
import {operationsPreviewSnapshot} from '../lib/operations-fixtures';
import {formatDateTime} from '../lib/operations-format';
import type {IntakeReceiptResult, OperationsRole, OperationsSnapshot} from '../lib/operations-types';
import './operations-workspace.css';

const emptySnapshot: OperationsSnapshot = {receipts: [], requests: [], updatedAt: null};
const validSession = (value: string | null): value is string => !!value && /^[a-zA-Z0-9_-]{8,90}$/.test(value);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Role-specific UI. Live mode reads existing records; paired intake awaits the new workflow. */
export default function OperationsWorkspace({role, preview = false, studioConfig, connectionPending = false, connectionError = false, onRetryConnection}: {role: OperationsRole; preview?: boolean; studioConfig?: StudioConfig; connectionPending?: boolean; connectionError?: boolean; onRetryConnection?: () => void}) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(preview ? operationsPreviewSnapshot : emptySnapshot);
  const [session, setSession] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!preview);
  const [connected, setConnected] = useState(false);
  const [intakeState, setIntakeState] = useState<'checking' | 'enabled' | 'disabled' | 'error'>(preview ? 'enabled' : 'checking');
  const [configAttempt, setConfigAttempt] = useState(0);
  const [firstAttemptEnded, setFirstAttemptEnded] = useState(preview);
  const [hasRecords, setHasRecords] = useState(preview);
  const intakeEnabled = !connectionPending && !connectionError && (studioConfig ? studioConfig.enabled : intakeState === 'enabled');
  const recordsState = hasRecords ? 'ready' : firstAttemptEnded ? 'error' : 'loading';
  const [staffAlerts, setStaffAlerts] = useState<StaffAlert[]>(preview ? operationsPreviewSnapshot.requests.filter(request => request.processing === 'failed').map(request => ({id: request.id + ':staff:extraction_failure', job_id: request.id, created_at: request.receivedAt, retry_count: 1})) : []);
  const [adminSelectedId, setAdminSelectedId] = useState<string | null>(null);
  const [registrationFocus, setRegistrationFocus] = useState('');
  const [retryNotice, setRetryNotice] = useState('');
  const retryLocks = useRef(new Set<string>());
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  const previewSequence = useRef(0);
  const banker = role === 'banker';

  useEffect(() => {
    if (preview || !banker || studioConfig || connectionPending || connectionError) return;
    const request = new AbortController();
    void fetch(demoApiUrl('/api/config'), {signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]), cache: 'no-store'})
      .then(async response => {
        if (!response.ok) throw Error('config_unavailable');
        const config = object(await response.json());
        if (typeof object(config.lifecycle_intake).enabled !== 'boolean') throw Error('config_invalid');
        if (!request.signal.aborted) setIntakeState(object(config.lifecycle_intake).enabled === true ? 'enabled' : 'disabled');
      }).catch(() => {if (!request.signal.aborted) setIntakeState('error');});
    return () => request.abort();
  }, [banker, preview, configAttempt, studioConfig, connectionPending, connectionError]);

  useEffect(() => {
    if (preview) return;
    const initial = setTimeout(() => {
      const url = new URL(location.href);
      const requested = url.searchParams.get('session');
      if (requested !== null && !validSession(requested)) {
        setError('세션 주소를 확인해 주세요. 세션은 영문·숫자·밑줄·하이픈 8~90자로 입력합니다.');
        setLoading(false);
        setFirstAttemptEnded(true);
        return;
      }
      let saved: string | null = null;
      try {saved = localStorage.getItem('im-demo-session');} catch {/* Storage is optional. */}
      const id = requested || (validSession(saved) ? saved : 'demo-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)));
      try {localStorage.setItem('im-demo-session', id);} catch {/* URL still preserves the session. */}
      url.searchParams.set('session', id);
      history.replaceState({}, '', url);
      setSession(id);
    }, 0);
    return () => clearTimeout(initial);
  }, [preview]);

  const refresh = useCallback(async () => {
    if (!session || preview || connectionPending || connectionError || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    let timedOut = false;
    const timeout = setTimeout(() => {timedOut = true; request.abort();}, 10000);
    setLoading(true);
    try {
      const response = await fetch(demoApiUrl((studioConfig ? '/api/studio/state?session=' : '/api/state?session=') + encodeURIComponent(session) + '&role=' + role), {signal: request.signal, cache: 'no-store'});
      if (!response.ok) throw Error('접수 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      const data: unknown = await response.json();
      if (request.signal.aborted) return;
      setSnapshot(studioConfig ? normalizeStudioOperationsState(readStudioSnapshot(data, session, role), session) : {...normalizeOperationsState(data, session), contracts: registeredOperationsContracts(data, session)});
      const alerts = object(data).staff_notifications;
      const jobs = object(data).jobs;
      setStaffAlerts(!studioConfig && role === 'admin' && Array.isArray(alerts) ? alerts.flatMap(value => {
        const item = object(value);
        const job = (Array.isArray(jobs) ? jobs : []).find(value => object(value).id === item.job_id);
        const source = object(job);
        if (typeof source.retry_job_id === 'string' && source.retry_job_id) return [];
        const studioReview = studioReviewForJob(job);
        const routing = object(source.document_routing);
        const canRetry = source.stage === 'failed' && source.error === 'studio_validation_red'
          && object(source.validation).verdict === 'red' && object(source.submission).status === 'accepted'
          && source.remote_synced === true && ['contract_registration', 'registered_request'].includes(String(source.intake_mode))
          && (!routing.detected_kind || routing.detected_kind === source.kind);
        return item.audience === 'staff' && item.kind === 'extraction_failure' && typeof item.id === 'string' && typeof item.job_id === 'string' && typeof item.created_at === 'string'
          ? [{id: item.id, job_id: item.job_id, created_at: item.created_at, document_name: (typeof source.filename === 'string' ? source.filename : Array.isArray(source.filenames) ? source.filenames.filter((name): name is string => typeof name === 'string').join(' · ') : '').normalize('NFC'), retry_count: typeof item.retry_count === 'number' ? item.retry_count : undefined, message: typeof item.message === 'string' ? item.message : undefined, supplement_required: item.supplement_required === true, can_retry: canRetry, ...(studioReview ? {studio_review: studioReview} : {})}] : [];
      }).sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)) : []);
      setHasRecords(true);
      setConnected(true);
      setError('');
    } catch {
      if (request.signal.aborted && !timedOut) return;
      setConnected(false);
      setError(timedOut ? '기록을 불러오는 데 시간이 걸리고 있습니다. 연결을 확인한 뒤 다시 시도해 주세요.' : '접수 기록을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      clearTimeout(timeout);
      if (!request.signal.aborted || timedOut) {setLoading(false); setFirstAttemptEnded(true);}
      if (controller.current === request) controller.current = null;
    }
  }, [preview, role, session, studioConfig, connectionPending, connectionError]);

  useEffect(() => {
    if (preview || !session) return;
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => {if (document.visibilityState === 'visible') void refresh();}, 5000);
    const onVisible = () => {if (document.visibilityState === 'visible') void refresh();};
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      clearTimeout(initial);
      document.removeEventListener('visibilitychange', onVisible);
      controller.current?.abort();
      controller.current = null;
    };
  }, [preview, refresh, session]);

  const metrics = useMemo(() => operationsMetrics(snapshot.requests), [snapshot.requests]);
  const href = (target: 'banker' | 'admin' | 'customer') => '/' + target + (preview ? '/preview' : session ? '?session=' + encodeURIComponent(session) : '');
  const submitDocument = async (kind: 'contract' | 'request', file: File, contractId?: string): Promise<IntakeReceiptResult> => {
    if (!preview) {
      if (!intakeEnabled || !session) throw Error('문서 접수 연결이 준비되면 이용할 수 있습니다.');
      const form = new FormData();
      form.set('session_id', session);
      form.set('file', file);
      if (studioConfig && !studioConfig.kinds[kind]) throw Error('이 업무의 Studio 연결 설정이 필요합니다.');
      if (!studioConfig && contractId) form.set('contract_id', contractId);
      let response: Response;
      try {
        response = await fetch(demoApiUrl((studioConfig ? '/api/studio/intake?kind=' + kind + '&session=' : '/api/' + (kind === 'contract' ? 'contracts' : 'requests') + '?session=') + encodeURIComponent(session)), {method: 'POST', body: form, signal: AbortSignal.timeout(60000)});
      } catch {
        throw Error('접수 응답을 확인하지 못했습니다. 접수 목록을 확인한 뒤 같은 문서로 다시 시도해 주세요.');
      }
      const receipt = object(await response.json());
      if (!response.ok || receipt.ok !== true) throw Error(typeof receipt.error === 'string' ? receipt.error : '접수를 완료하지 못했습니다. 다시 시도해 주세요.');
      if (typeof receipt.receipt_id !== 'string' || typeof receipt.received_at !== 'string') throw Error('접수 응답을 확인하지 못했습니다. 접수 목록을 확인해 주세요.');
      await refresh();
      return {receiptId: receipt.receipt_id, receivedAt: receipt.received_at, duplicate: receipt.duplicate === true};
    }
    const receivedAt = new Date().toISOString();
    const receiptId = 'DEMO-' + Date.now().toString(36).toUpperCase() + '-' + ++previewSequence.current;
    setSnapshot(current => {
      const contract = current.contracts?.find(item => item.id === contractId);
      return {...current, updatedAt: receivedAt,
        ...(kind === 'contract' ? {contracts: [{id: 'CON-' + receiptId, reference: '예시 계약 ' + previewSequence.current, companyName: '새로 등록한 기업 (가상)', amount: 1_000_000_000, registeredAt: receivedAt, fileName: file.name, status: 'registered' as const}, ...(current.contracts || [])]} : {}),
        receipts: [{id: receiptId, receivedAt, fileNames: [file.name], kind, contractReference: contract?.reference, status: 'received'}, ...current.receipts]};
    });
    return {receiptId, receivedAt};
  };

  const continueDocument = async (receiptId: string, contractId?: string): Promise<IntakeReceiptResult> => {
    if(studioConfig||preview||!intakeEnabled||!session)throw Error('실제 접수 연결 후 이용해 주세요.');
    let response: Response;
    try {response=await fetch(demoApiUrl('/api/document-continue?session='+encodeURIComponent(session)),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:receiptId,...(contractId?{contract_id:contractId}:{})}),signal:AbortSignal.timeout(60000)});}
    catch {throw Error('접수 응답을 확인하지 못했습니다. 접수 내역을 확인한 뒤 다시 시도해 주세요.');}
    const receipt=object(await response.json());
    if(!response.ok||receipt.ok!==true||typeof receipt.receipt_id!=='string'||typeof receipt.received_at!=='string')throw Error(typeof receipt.error==='string'?receipt.error:'이어지는 접수를 확인하지 못했습니다. 접수 내역을 확인해 주세요.');
    await refresh();return {receiptId:receipt.receipt_id,receivedAt:receipt.received_at,duplicate:receipt.duplicate===true};
  };

  const retryDocument = async (jobId: string): Promise<void> => {
    if (studioConfig || preview || !session) throw Error('현재 연결에서는 재분석을 지원하지 않습니다.');
    let response: Response;
    try {
      response = await fetch(demoApiUrl('/api/document-retry?session=' + encodeURIComponent(session)), {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({job_id: jobId}), signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw Error('재분석 응답을 확인하지 못했습니다. 기록을 새로고침한 뒤 다시 눌러도 같은 재분석 요청을 확인합니다.');
    }
    let receipt: Record<string, unknown>;
    try {receipt = object(await response.json());}
    catch {throw Error('재분석 응답을 확인하지 못했습니다. 기록을 새로고침해 주세요.');}
    if (!response.ok || receipt.ok !== true || typeof receipt.receipt_id !== 'string' || !receipt.receipt_id || typeof receipt.received_at !== 'string') {
      throw Error(typeof receipt.error === 'string' ? receipt.error : '원문 재분석 요청을 확인하지 못했습니다. 기록을 새로고침해 주세요.');
    }
    // The retry receipt is accepted, not proof that analysis has finished.
    setRetryNotice('재분석을 요청했습니다.');
    setStaffAlerts(current => current.filter(alert => alert.job_id !== jobId));
    await refresh();
  };

  // Keep job-specific retry state mounted while navigating home and request details.
  const retrySafely = async (jobId: string) => {
    if (retryLocks.current.has(jobId)) return;
    retryLocks.current.add(jobId);
    setRetrying(current => ({...current, [jobId]: true}));
    setRetryErrors(current => ({...current, [jobId]: ''}));
    try {await retryDocument(jobId);}
    catch (cause) {setRetryErrors(current => ({...current, [jobId]: cause instanceof Error ? cause.message : '원문 재분석 요청을 확인하지 못했습니다.'}));}
    finally {retryLocks.current.delete(jobId); setRetrying(current => ({...current, [jobId]: false}));}
  };
  const selectedRequest = snapshot.requests.find(request => request.id === adminSelectedId);
  const focusedJob = selectedRequest?.id || registrationFocus;
  const openAlert = (id: string) => {
    if (snapshot.requests.some(request => request.id === id)) {setRegistrationFocus(''); setAdminSelectedId(id);}
    else {setAdminSelectedId(null); setRegistrationFocus(id);}
  };
  const focusedAlert = staffAlerts.find(alert => alert.job_id === focusedJob);

  const retryContent = focusedAlert?.supplement_required ? <DocumentRetryAction key={focusedJob} alert={focusedAlert} onRetry={focusedAlert.can_retry && !preview && session ? retrySafely : undefined} busy={retrying[focusedJob]} errorMessage={retryErrors[focusedJob]}/> : undefined;

  return <div className="ops-app">
    <a className="ops-skip" href="#operations-main">본문으로 바로가기</a>
    <aside className="ops-sidebar" aria-label="업무 메뉴">
      <a href={href(role)} className="ops-brand" aria-label="iM BANK 문서 업무 홈"><Image src="/im-bank-wordmark.png" alt="iM BANK" width={261} height={50} unoptimized/><span>기업금융 문서 업무</span></a>
      <div className="ops-menu-label">WORKSPACE</div>
      <nav className="ops-nav" aria-label="현재 업무">
        <a className="ops-nav-active" href={href(role)} aria-current="page">{banker ? <FileInput size={20}/> : <LayoutDashboard size={20}/>}<span>{banker ? '문서 접수' : '관리현황'}</span><ChevronRight size={16}/></a>
      </nav>
      <div className="ops-role-links"><span>시연 화면 전환</span><a href={href(banker ? 'admin' : 'banker')}>{banker ? <LayoutDashboard size={17}/> : <FileInput size={17}/>} {banker ? '관리자 화면' : '은행원 화면'}<ArrowUpRight size={15}/></a><a href={href('customer')}><Smartphone size={17}/> 고객 앱<ArrowUpRight size={15}/></a></div>
      <div className="ops-sidebar-footer"><strong>iM BANK</strong><span>문서 업무 자동화 · 시연</span></div>
      <section className="ops-sidebar-sync" aria-label="접수 기록 연결 상태">
        <div>{preview ? <span className="ops-data-status">예시 데이터</span> : <><span className={'ops-data-status' + (connected ? ' connected' : '')}><i/>{connected ? '문서 접수 내역 연결됨' : loading ? '접수 내역 불러오는 중' : '접수 내역 연결 확인 필요'}</span><button type="button" className="ops-refresh" disabled={loading || !session} onClick={() => void refresh()} aria-label="접수 기록 새로고침"><RefreshCw size={17} className={loading ? 'ops-spin' : ''}/></button></>}</div>
        {snapshot.updatedAt ? <small>최근 갱신 {formatDateTime(snapshot.updatedAt)}</small> : null}
      </section>
    </aside>
    <div className="ops-content">
      {preview ? <div className="ops-preview-bar"><span><b>화면 미리보기</b> 예시 데이터입니다. 접수 기록은 화면에만 남으며 실제 분석·보고서 생성·알림은 실행하지 않습니다.</span><a href={'/' + role}>실제 기록 <ArrowUpRight size={14}/></a></div> : null}
      <main id="operations-main" className={`ops-main${!banker && focusedJob ? ' ops-main-detail' : ''}`} tabIndex={-1}>
        {(banker || !focusedJob) && <div className="ops-heading"><div><h1>{banker ? '문서 접수' : '관리현황'}</h1><p>{banker ? '계약은 한 번 등록하고, 이후 실행 요청은 요청서만 접수하세요.' : '전체 요청의 흐름을 살펴보고, 확인이 필요한 건부터 검토하세요.'}</p></div></div>}
        {connectionPending || connectionError ? <div className="ops-connection-note" role={connectionError ? 'alert' : 'status'}><span>{connectionError ? '업무 연결 설정을 불러오지 못했습니다.' : '업무 연결 설정을 확인하고 있습니다.'}</span>{connectionError && <button type="button" onClick={onRetryConnection}>다시 연결</button>}</div> : null}
        {error ? <div className="ops-error" role="alert"><span>{error}{snapshot.receipts.length ? ' 마지막으로 불러온 기록을 표시합니다.' : ''}</span><button type="button" disabled={loading || !session} onClick={() => void refresh()}>다시 불러오기</button></div> : null}
        {!banker && retryNotice ? <p role="status" className="staff-retry-notice">{retryNotice}</p> : null}
        {!preview && banker && !intakeEnabled && !connectionPending && !connectionError ? <div className="ops-connection-note" role="status"><span><strong>{intakeState === 'checking' ? '접수 기능 확인 중' : intakeState === 'error' ? '접수 기능 연결을 확인하지 못했습니다' : '현재 접수 기능을 사용할 수 없습니다'}</strong>접수 기록 조회와 별도로 접수 기능 설정을 확인합니다.</span>{intakeState === 'error' && <button type="button" onClick={() => {setIntakeState('checking'); setConfigAttempt(value => value + 1);}}>접수 기능 다시 확인</button>}<a href="/banker/preview">접수 화면 미리보기 <ArrowUpRight size={15}/></a></div> : null}
        {!banker && !focusedJob ? <StaffAlertBanner alerts={staffAlerts} onOpen={openAlert}/> : null}
        {!banker && registrationFocus ? <section className="ops-registration-issue" role="status"><strong>계약 등록 확인이 필요합니다</strong><p>접수번호 {registrationFocus}</p><p>계약의 기준 정보를 등록하지 못했습니다. 이 계약으로 실행 요청을 접수할 수 없습니다.</p>{snapshot.receipts.filter(receipt => receipt.id === registrationFocus).map(receipt => <p key={receipt.id}>{receipt.fileNames.join(' · ')} · 접수 {formatDateTime(receipt.receivedAt)}</p>)}<details className="ops-registration-history"><summary>처리 이력</summary>{staffAlerts.filter(alert => alert.job_id === registrationFocus).map(alert => <p key={alert.id}><time dateTime={alert.created_at}>{formatDateTime(alert.created_at)}</time> · 담당자 확인 요청{alert.retry_count === 1 ? ' · 추출 재시도 1회 후' : ''}</p>)}</details>{retryContent}<button type="button" onClick={() => setRegistrationFocus('')}>관리 현황으로</button></section> : null}
        {banker ? <BankerIntake requestMatching={studioConfig ? 'studio' : 'local'} enabledKinds={studioConfig?.kinds} receipts={snapshot.receipts} recordsState={recordsState} contracts={snapshot.contracts || []} onRegisterContract={file => submitDocument('contract', file)} onSubmitRequest={(file, contractId) => submitDocument('request', file, contractId)} onContinueDocument={continueDocument} canSubmit={preview || (intakeEnabled && !!session)} preview={preview}/> : !registrationFocus ? <AdminDashboard collectionScope={snapshot.collectionScope} recordsState={recordsState} reviewAlerts={staffAlerts} retryContent={retryContent} requests={snapshot.requests} contracts={snapshot.contracts || []} metrics={metrics} selectedId={adminSelectedId} onSelectRequest={id => {setRegistrationFocus(''); setAdminSelectedId(id);}}/> : null}
        {!banker ? <div hidden={!!focusedJob}>{studioConfig ? <StudioCoworkerPanel key={session} session={session || ''}/> : connectionPending || connectionError ? null : <DailyReportPanel session={session} preview={preview}/>}</div> : null}
        <footer className="ops-footer"><span>iM BANK · 금융문서 업무 자동화</span><span>프로토타입{session ? ' · 세션 ' + session : ''}</span></footer>
      </main>
    </div>
  </div>;
}
