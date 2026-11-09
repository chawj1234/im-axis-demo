'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Image from 'next/image';
import {ArrowUpRight, ChevronRight, FileInput, LayoutDashboard, RefreshCw} from 'lucide-react';
import AdminDashboard from './admin-dashboard';
import BankerIntake from './banker-intake';
import {StudioCoworkerPanel} from './studio-coworker-panel';
import {normalizeStudioOperationsState} from '../lib/studio-operations-model.mjs';
import {readStudioSnapshot, type StudioConfig} from '../lib/studio-screen-types';
import {demoApiUrl} from '../lib/demo-api.mjs';
import {operationsMetrics} from '../lib/operations-model';
import {operationsPreviewSnapshot} from '../lib/operations-fixtures';
import {formatDateTime} from '../lib/operations-format';
import type {IntakeReceiptResult, OperationsRole, OperationsSnapshot} from '../lib/operations-types';
import './operations-workspace.css';

const emptySnapshot: OperationsSnapshot = {receipts: [], requests: [], updatedAt: null};
const validSession = (value: string | null): value is string => !!value && /^[a-zA-Z0-9_-]{8,90}$/.test(value);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Role-specific Studio UI; connection failures never activate a different provider. */
export default function OperationsWorkspace({role, preview = false, studioConfig, connectionPending = false, connectionError = false, onRetryConnection}: {role: OperationsRole; preview?: boolean; studioConfig?: StudioConfig; connectionPending?: boolean; connectionError?: boolean; onRetryConnection?: () => void}) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(preview ? operationsPreviewSnapshot : emptySnapshot);
  const [session, setSession] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!preview);
  const [connected, setConnected] = useState(false);
  const [firstAttemptEnded, setFirstAttemptEnded] = useState(preview);
  const [hasRecords, setHasRecords] = useState(preview);
  const intakeEnabled = !connectionPending && !connectionError && !!studioConfig?.enabled;
  const recordsState = hasRecords ? 'ready' : firstAttemptEnded ? 'error' : 'loading';
  const [adminSelectedId, setAdminSelectedId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const previewSequence = useRef(0);
  const banker = role === 'banker';

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
    if (!session || preview || !studioConfig || connectionPending || connectionError || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    let timedOut = false;
    const timeout = setTimeout(() => {timedOut = true; request.abort();}, 10000);
    setLoading(true);
    try {
      const response = await fetch(demoApiUrl('/api/studio/state?session=' + encodeURIComponent(session) + '&role=' + role), {signal: request.signal, cache: 'no-store'});
      if (!response.ok) throw Error('접수 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      const data: unknown = await response.json();
      if (request.signal.aborted) return;
      setSnapshot(normalizeStudioOperationsState(readStudioSnapshot(data, session, role), session));
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
  const href = (target: 'banker' | 'admin') => '/' + target + (preview ? '/preview' : session ? '?session=' + encodeURIComponent(session) : '');
  const submitDocument = async (kind: 'contract' | 'request', file: File, contractId?: string): Promise<IntakeReceiptResult> => {
    if (!preview) {
      if (!intakeEnabled || !studioConfig || !session) throw Error('문서 접수 연결이 준비되면 이용할 수 있습니다.');
      const form = new FormData();
      form.set('session_id', session);
      form.set('file', file);
      if (!studioConfig.kinds[kind]) throw Error('이 업무의 Studio 연결 설정이 필요합니다.');
      let response: Response;
      try {
        response = await fetch(demoApiUrl(('/api/studio/intake?kind=' + kind + '&session=') + encodeURIComponent(session)), {method: 'POST', body: form, signal: AbortSignal.timeout(60000)});
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

  const focusedJob = adminSelectedId;
  const continueDocument = async (): Promise<IntakeReceiptResult> => {
    throw Error('문서 종류를 확인한 뒤 올바른 경로로 새로 접수해 주세요.');
  };

  return <div className="ops-app">
    <a className="ops-skip" href="#operations-main">본문으로 바로가기</a>
    <aside className="ops-sidebar" aria-label="업무 메뉴">
      <a href={href(role)} className="ops-brand" aria-label="iM BANK 문서 업무 홈"><Image src="/im-bank-wordmark.png" alt="iM BANK" width={261} height={50} unoptimized/><span>기업금융 문서 업무</span></a>
      <div className="ops-menu-label">WORKSPACE</div>
      <nav className="ops-nav" aria-label="현재 업무">
        <a className="ops-nav-active" href={href(role)} aria-current="page">{banker ? <FileInput size={20}/> : <LayoutDashboard size={20}/>}<span>{banker ? '문서 접수' : '관리현황'}</span><ChevronRight size={16}/></a>
      </nav>
      <div className="ops-role-links"><span>시연 화면 전환</span><a href={href(banker ? 'admin' : 'banker')}>{banker ? <LayoutDashboard size={17}/> : <FileInput size={17}/>} {banker ? '관리자 화면' : '은행원 화면'}<ArrowUpRight size={15}/></a></div>
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
        {banker ? <BankerIntake requestMatching="studio" enabledKinds={studioConfig?.kinds} receipts={snapshot.receipts} recordsState={recordsState} contracts={snapshot.contracts || []} onRegisterContract={file => submitDocument('contract', file)} onSubmitRequest={(file, contractId) => submitDocument('request', file, contractId)} onContinueDocument={continueDocument} canSubmit={preview || (intakeEnabled && !!session)} preview={preview}/> : <AdminDashboard collectionScope={snapshot.collectionScope} recordsState={recordsState} requests={snapshot.requests} contracts={snapshot.contracts || []} metrics={metrics} selectedId={adminSelectedId} onSelectRequest={setAdminSelectedId}/>}
        {!banker && studioConfig && !preview ? <div hidden={!!focusedJob}><StudioCoworkerPanel key={session} session={session || ''}/></div> : null}
        <footer className="ops-footer"><span>iM BANK · 금융문서 업무 자동화</span><span>프로토타입{session ? ' · 세션 ' + session : ''}</span></footer>
      </main>
    </div>
  </div>;
}
