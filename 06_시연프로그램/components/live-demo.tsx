'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, Bell, CheckCircle2, FileText, Link2, ShieldCheck, Upload} from 'lucide-react';
import {assessmentLabel, hasConfirmedWarning, processingLabel, reviewPresentation, type AssessmentState} from '../lib/live-screen-state';
import LiveReview, {type ReviewRecord} from './live-review';
import CustomerApp from './customer-app';
import {demoApiUrl} from '../lib/demo-api.mjs';
import {customerAppActivities, customerAppNotices} from '../lib/customer-app-model';
import './live-demo.css';

type Role = 'banker' | 'customer' | 'reviewer';
interface Source {filename?: string; formula?: string; document_id?: string; page?: number | null}
interface Check {key: string; label: string; status: string; reference?: unknown; requested?: unknown; note?: string; reference_source?: Source; requested_source?: Source}
interface Contract {contract_id: string; agreement_reference?: string; company_name?: string; credit_limit_krw?: number; execution_start_date?: string; execution_end_date?: string}
interface Assessment extends AssessmentState {
  message?: string; masked_account?: string;
  confirmed_mismatches?: {key: string; label: string}[];
  unconfirmed_items?: {key: string; label: string}[];
  checks?: Check[]; credit_limit_krw?: number; current_loan_balance_krw?: number; requested_amount_krw?: number | null;
  contract?: Contract; ledger?: {current_loan_balance_krw?: number};
}
interface Job {
  id: string; filename?: string; kind: string; created_at: string; stage: string;
  review_status?: string; delayed_at?: string | null; result?: Assessment | null;
  late_result?: {received_at: string; result?: Assessment | null} | null;
  error?: string | null; query_error?: string | null; configuration_mode?: string;
  mirror?: {status: string}; timeline?: {stage: string; at: string}[];
  attempts?: {number: number; phase: string; job_id?: string}[];
}
interface Notice {id: string; job_id: string; kind: string; created_at: string; message: string; displayed_at?: string | Record<string, string> | null}
interface State {jobs: Job[]; contracts: Contract[]; notifications: Notice[]; reviews: ReviewRecord[]}
const emptyState: State = {jobs: [], contracts: [], notifications: [], reviews: []};
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('ko-KR') + '원' : '미확인';
const time = (value?: string) => value ? new Date(value).toLocaleString('ko-KR') : '—';
const display = (value: unknown) => value === null || value === undefined || value === '' ? '미확인' : typeof value === 'number' ? money(value) : String(value);
const customerDisplayTime = (notice: Notice) => typeof notice.displayed_at === 'string' ? notice.displayed_at : notice.displayed_at?.customer;
async function call<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(demoApiUrl(url), options), body = await response.json();
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'error' in body ? body.error : null;
    throw Error(typeof problem === 'string' ? problem : '처리 결과를 확인하지 못했습니다.');
  }
  return body as T;
}
function Evidence({source, session}: {source?: Source; session: string}) {
  if (!source) return null;
  return <div className="ld-evidence"><span>{source.filename || source.formula || '모의 전산 잔액'}</span>
    {source.document_id && Number.isInteger(source.page) && source.page! >= 1
      ? <a href={demoApiUrl('/api/document?session=' + encodeURIComponent(session) + '&id=' + encodeURIComponent(source.document_id) + '&page=' + source.page)} target="_blank" rel="noreferrer">원문 {source.page}쪽</a>
      : <span>페이지 근거 미제공</span>}
  </div>;
}
function AssessmentPanel({result, session, late = false}: {result: Assessment; session: string; late?: boolean}) {
  return <section className="ld-card">
    <div className="ld-row"><h2>{late ? '종료 후 추가 결과' : '대조·평가 결과'}</h2><span className={'ld-pill ' + (result.warning_required ? 'warn' : '')}>{assessmentLabel(result)}</span></div>
    {result.warning_required && <p className="ld-warning"><AlertTriangle size={18}/>확인된 불일치: {result.confirmed_mismatches?.map(c => c.label).join(' · ')}</p>}
    {!!result.unconfirmed_items?.length && <p>미확인: {result.unconfirmed_items.map(c => c.label).join(' · ')}</p>}
    <div className="ld-metrics"><div>약정한도<strong>{money(result.credit_limit_krw)}</strong></div><div>전산 기준 잔액<strong>{money(result.current_loan_balance_krw)}</strong></div><div>실행 요청금액<strong>{money(result.requested_amount_krw)}</strong></div></div>
    <div className="ld-checks">{result.checks?.map(check => <details key={check.key} className={check.status}>
      <summary><strong>{check.label}</strong><span>{check.status === 'pass' ? '일치·충족' : check.status === 'missing' ? '미확인' : '불일치'}</span></summary>
      <div className="ld-comparison"><div><small>기준값</small><b>{display(check.reference)}</b><Evidence source={check.reference_source} session={session}/></div><div><small>요청값</small><b>{display(check.requested)}</b><Evidence source={check.requested_source} session={session}/></div></div><p>{check.note}</p>
    </details>)}</div>
    <p className="ld-muted">1등급이 가장 위험하고 4등급이 가장 낮은 시연 정책입니다. 자금용도는 참고 정보입니다.</p>
  </section>;
}
export default function LiveDemo({initialRole = 'banker'}: {initialRole?: Role}) {
  const [session, setSession] = useState('');
  const [data, setData] = useState<State>(emptyState);
  const [error, setError] = useState(''), [online, setOnline] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(''), [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('request'), [contract, setContract] = useState(''), [balance, setBalance] = useState('700000000');
  const [links, setLinks] = useState(false), [receipt, setReceipt] = useState('');
  const polling = useRef(false), acknowledgements = useRef(new Set<string>());
  const role = initialRole;
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(location.href), id = url.searchParams.get('session') || localStorage.getItem('im-demo-session') || 'demo-' + crypto.randomUUID();
      localStorage.setItem('im-demo-session', id); url.searchParams.set('session', id); history.replaceState({}, '', url); setSession(id);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const refresh = useCallback(async () => {
    if (!session || polling.current) return;
    polling.current = true;
    try {
      const incoming = await call<Partial<State>>('/api/state?session=' + encodeURIComponent(session) + '&role=' + role);
      // Customer responses deliberately omit internal contracts and reviews.
      setData({...emptyState, ...incoming}); setOnline(true);
      if (role === 'customer') setError('');
    }
    catch (e) {setOnline(false); setError(e instanceof Error ? e.message : '상태를 확인하지 못했습니다.');}
    finally {polling.current = false;}
  }, [session, role]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0), timer = setInterval(() => void refresh(), 2000);
    return () => {clearTimeout(first); clearInterval(timer);};
  }, [refresh]);
  const {jobs, notifications: notices, reviews} = data;
  const job = jobs.find(j => j.id === selected) || jobs.at(-1), result = job?.result;
  const selectedContract = contract || data.contracts.at(-1)?.contract_id || '';
  const acknowledgeNotice = useCallback(async (id: string) => {
    if (role !== 'customer' || !session || document.visibilityState !== 'visible') return;
    const notice = notices.find(item => item.id === id);
    if (!notice || customerDisplayTime(notice) || acknowledgements.current.has(id)) return;
    acknowledgements.current.add(id);
    try {
      await call('/api/delivery?session=' + encodeURIComponent(session), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({notification_id: id, role: 'customer'})});
    } catch (error) {
      acknowledgements.current.delete(id);
      throw error;
    }
  }, [notices, session, role]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!file || busy) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file); form.set('kind', kind); form.set('contract_id', selectedContract);
      if (kind === 'contract') form.set('initial_balance_krw', balance);
      const response = await call<{receipt_id: string; duplicate: boolean; received_at: string}>('/api/jobs?session=' + encodeURIComponent(session), {method: 'POST', body: form});
      setSelected(response.receipt_id); setReceipt((response.duplicate ? '기존 접수 확인: ' : '신규 접수: ') + response.receipt_id + ' · ' + time(response.received_at)); await refresh();
    } catch (e) {setError(e instanceof Error ? e.message : '접수 실패');}
    finally {setBusy(false);}
  }
  const href = (path: string) => '/' + path + '?session=' + encodeURIComponent(session);
  return role === 'customer' ? <CustomerApp
    notices={customerAppNotices(notices)} activities={customerAppActivities(jobs)}
    connected={online} error={error ? '새 안내를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.' : undefined}
    onNoticeVisible={acknowledgeNotice}
  /> : <div className="ld">
    <header className="ld-header"><a className="ld-brand" href={href('banker')}><span>iM</span>금융문서 검증<small>PROTOTYPE</small></a><nav>{(['banker', 'reviewer', 'customer'] as const).map(r => <a key={r} className={role === r ? 'active' : ''} href={href(r)}>{({banker: '은행원', reviewer: '검토자', customer: '고객'})[r]}</a>)}</nav><span className="ld-connect">{online ? '● 연결됨' : '○ 연결 확인 중'}</span></header>
    <main className="ld-main">
      <div className="ld-heading"><div><small>DOCUMENT CONTROL</small><h1>{role === 'reviewer' ? '문서 검토 기록' : '문서 접수와 대조'}</h1><p>가상 거래 시연 · 승인·송금·거래 보류·잔액 변경 없음</p></div><button onClick={() => setLinks(!links)}><Link2 size={16}/>같은 세션 연결</button></div>
      {links && <section className="ld-card"><h2>화면 연결 주소</h2>{['customer', 'banker', 'reviewer'].map(r => <p key={r}><a href={href(r)}>{typeof window !== 'undefined' ? location.origin : ''}{href(r)}</a></p>)}</section>}
      {error && <p role="alert" className="ld-warning">{error}<button onClick={() => setError('')}>닫기</button></p>}
      {role === 'banker' && <form className="ld-card ld-upload" onSubmit={submit}>
        <div><label htmlFor="kind">접수 종류</label><select id="kind" value={kind} onChange={e => setKind(e.target.value)}><option value="request">실행 요청서</option><option value="contract">계약서·계좌 지정서</option></select></div>
        {kind === 'contract' ? <div><label htmlFor="balance">초기 모의 전산 잔액 (원)</label><input id="balance" inputMode="numeric" value={balance} onChange={e => setBalance(e.target.value)} required/></div> : <div><label htmlFor="contract">같은 세션의 기준 계약</label><select id="contract" value={selectedContract} onChange={e => setContract(e.target.value)} required><option value="">계약 선택</option>{data.contracts.map(c => <option key={c.contract_id} value={c.contract_id}>{c.agreement_reference} · {c.company_name}</option>)}</select></div>}
        <div><label htmlFor="file">PDF · 25MB · 20쪽 이하</label><input id="file" type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} required/></div>
        <button disabled={busy || !file || !session} className="ld-primary"><Upload size={16}/>{busy ? '접수 중' : '문서 접수'}</button>{receipt && <p className="ld-receipt" role="status">{receipt}</p>}
      </form>}
      <div className="ld-workspace">
        <aside className="ld-card ld-list"><h2>접수 기록 <small>{jobs.length}건</small></h2>{jobs.length === 0 && <p>문서를 접수하면 기록이 표시됩니다.</p>}{[...jobs].reverse().map(j => <button className={job?.id === j.id ? 'selected' : ''} key={j.id} onClick={() => setSelected(j.id)}><strong>{j.filename}</strong><span>{processingLabel(j)}</span><small>{time(j.created_at)}</small>{hasConfirmedWarning(j) && <span className="ld-warning-text">{j.late_result ? '종료 후 추가 불일치 있음' : '확인된 불일치 있음'}</span>}</button>)}</aside>
        <div className="ld-detail">{!job ? <section className="ld-card ld-empty"><FileText/><h2>접수할 문서를 선택해 주세요.</h2><p>계약 기준정보를 먼저 등록한 뒤 실행 요청서를 접수합니다.</p></section> : <>
          <section className="ld-card"><div className="ld-row"><h2>{job.filename}</h2><span className="ld-pill">{processingLabel(job)}</span></div>
            <div className="ld-status-grid"><div>처리<strong>{processingLabel(job)}</strong></div><div>평가<strong>{job.kind === 'contract' ? '계약 기준정보' : assessmentLabel(result)}</strong></div><div>검토<strong>{reviewPresentation(job).label}</strong></div></div>
            <p className="ld-muted">접수번호 {job.id}<br/>최초 접수 {time(job.created_at)}</p>{job.error && <p className="ld-warning">{job.error}</p>}{job.query_error && <p>조회 확인 필요: {job.query_error}</p>}
            {job.stage === 'ended' && <p>12분 자동 확인 종료. 기존 Studio 작업만 추가 확인하며 새 분석을 생성하지 않습니다.</p>}{job.configuration_mode === 'latest' && <p className="ld-muted">Studio 최신 설정 사용 · 버전 고정 전</p>}
            <p className="ld-muted">Data Tables 반영: {({pending: '대기', sending: '저장 중', saved: '확인됨', unknown: '응답 확인 필요', not_ready: '분석 대기'} as Record<string, string>)[job.mirror?.status || ''] || '미확인'}</p>
            <details><summary>작업 이력</summary>{job.timeline?.map((event, i) => <p key={i}>{time(event.at)} · {event.stage}</p>)}{job.attempts?.map(attempt => <p key={attempt.number}>분석 {attempt.number}회 · {attempt.phase} · {attempt.job_id || '작업 ID 미확인'}</p>)}</details>
          </section>
          {result && job.kind === 'request' && <AssessmentPanel result={result} session={session}/>}
          {result && job.kind === 'contract' && <section className="ld-card"><h2><CheckCircle2 size={20}/>계약 기준정보 등록 완료</h2><p>{result.contract?.company_name} · {result.contract?.agreement_reference}</p><p>약정한도 {money(result.contract?.credit_limit_krw)} / 초기 전산 잔액 {money(result.ledger?.current_loan_balance_krw)}</p><p>실행 가능 기간 {result.contract?.execution_start_date} ~ {result.contract?.execution_end_date}</p></section>}
          {job.late_result?.result && <AssessmentPanel result={job.late_result.result} session={session} late/>}
          {job.kind === 'request' && <section className="ld-card"><h2>알림 표시 기록</h2>{notices.filter(notice => notice.job_id === job.id).map(notice => <p key={notice.id}>{notice.kind === 'receipt' ? '접수 알림' : notice.kind === 'late_warning' ? '종료 후 추가 경고' : '불일치 경고'} · {customerDisplayTime(notice) ? time(customerDisplayTime(notice)) + ' 고객 화면 표시' : '고객 표시 전'}</p>)}<p className="ld-muted">알림 표시 확인은 검토 완료를 의미하지 않습니다.</p></section>}
          {role === 'reviewer' && reviewPresentation(job).canRecord && <LiveReview key={job.id} records={reviews.filter(record => record.job_id === job.id)} save={async input => {
            const response = await call<{review: ReviewRecord}>('/api/review?session=' + encodeURIComponent(session) + '&job_id=' + encodeURIComponent(job.id), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)});
            await refresh(); return response.review;
          }}/>}
        </>}</div>
      </div>
      <footer className="ld-footer"><ShieldCheck size={15}/>자동 대조와 내부통제 보조를 위한 가상 시연입니다.</footer>
    </main>
  </div>;
}
