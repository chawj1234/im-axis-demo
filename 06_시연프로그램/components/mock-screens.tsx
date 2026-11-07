'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Bell, Check, ClipboardCheck, FileText, ShieldCheck } from 'lucide-react';
import {
  SCENARIOS, DEFAULT_SESSION, assessmentLabel, customerView, emptyRecords,
  markDisplayed, needsReview, readRecords, saveReview, staffView, storageKey, validSession,
  type CustomerView, type Evidence, type LocalRecords, type Notice, type Role, type Scenario, type StaffView,
} from '../lib/mock-screen-model';

const roleLabels: Record<Role, string> = { customer: '고객', banker: '담당 은행원', reviewer: '검토자' };
const money = (value: number | null) => value === null ? '확인 불가' : `${value.toLocaleString('ko-KR')}원`;
const time = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '아직 없음';
const RECORD_EVENT = 'im-mock-records-changed';

function EvidenceBlock({ value }: { value: Evidence }) {
  return <div className="mock-evidence">
    <strong>{value.raw || '미기재'}</strong>
    <span>정규화값: {value.normalized || '없음'}</span>
    <small>{value.source}{value.page === null ? '' : ` · ${value.page}쪽`}</small>
    <blockquote>{value.quote}</blockquote>
  </div>;
}

function NoticeCard({ notice, onDisplayed }: { notice: Notice; onDisplayed?: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!onDisplayed || notice.displayedAt || !ref.current) return;
    let visible = false;
    const acknowledge = () => { if (visible && document.visibilityState === 'visible') onDisplayed(notice.id); };
    const observer = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); acknowledge(); }, { threshold: 0.2 });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', acknowledge);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', acknowledge); };
  }, [notice.id, notice.displayedAt, onDisplayed]);
  return <article ref={ref} className={`mock-notice ${notice.kind}`} data-notice-kind={notice.kind}>
    <div className="mock-notice-heading">{notice.kind === 'warning' ? <AlertTriangle size={19} /> : <Bell size={19} />}<strong>{notice.title}</strong></div>
    <p>{notice.message}</p>
    <div className="mock-notice-meta"><span>{notice.kind === 'receipt' ? '접수 알림' : '불일치 경고'} · {time(notice.createdAt)}</span><span>고객 화면 표시: {time(notice.displayedAt)}</span></div>
  </article>;
}

function CustomerScreen({ view, onDisplayed }: { view: CustomerView; onDisplayed: (id: string) => void }) {
  return <div className="mock-customer-content" data-testid="customer-view">
    <section className="mock-card mock-customer-hero">
      <div className="mock-icon"><ShieldCheck size={30} /></div>
      <p className="mock-eyebrow">대출 실행 요청 안내</p>
      <h2>요청 처리 현황을<br />확인해 주세요.</h2>
      <div className="mock-tags"><span className="mock-tag">{view.processingLabel}</span><span className="mock-tag">{view.assessmentLabel}</span>{view.late && <span className="mock-tag amber">추가 결과 도착</span>}</div>
      <p>{view.guidance}</p>
      <small>최초 접수 · {time(view.receivedAt)}</small>
      <small className="mock-receipt-id">접수번호 · {view.requestId}</small>
    </section>
    <section aria-label="고객 알림" className="mock-notices">{view.notices.map(n => <NoticeCard key={n.id} notice={n} onDisplayed={onDisplayed} />)}</section>
    <p className="mock-fine">접수·대조 완료 안내는 대출 실행이나 송금 완료를 의미하지 않습니다.</p>
  </div>;
}

function ReviewForm({ view, onSave }: { view: StaffView; onSave: (confirmed: boolean, memo: string) => boolean }) {
  const [confirmed, setConfirmed] = useState(view.review.confirmed);
  const [memo, setMemo] = useState(view.review.memo);
  return <section className="mock-card mock-review" aria-labelledby="review-title">
    <div className="mock-section-title"><ClipboardCheck size={19} /><h3 id="review-title">검토 기록</h3><span className={`mock-tag ${view.review.confirmed ? 'green' : 'amber'}`}>{view.review.confirmed ? '확인 완료' : '확인 전'}</span></div>
    <form onSubmit={e => { e.preventDefault(); onSave(confirmed, memo); }}>
      <label className="mock-checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />비교값과 근거를 확인했습니다.</label>
      <label className="mock-field">검토 메모<textarea maxLength={2000} rows={4} value={memo} onChange={e => setMemo(e.target.value)} placeholder="확인한 내용이나 추가 확인이 필요한 사항을 기록하세요." /></label>
      <div className="mock-form-footer"><small>{memo.length}/2,000자</small><button type="submit" className="mock-button">확인·메모 저장</button></div>
      <p role="status" className="mock-save-status">최근 저장 · {time(view.review.recordedAt)}</p>
    </form>
  </section>;
}

function StaffScreen({ view, role, session, records, onSelect, onSave }: {
  view: StaffView; role: 'banker' | 'reviewer'; session: string; records: LocalRecords;
  onSelect: (scenario: Scenario) => void; onSave: (confirmed: boolean, memo: string) => boolean;
}) {
  const a = view.assessment;
  const differences = a?.checks.filter(c => c.status === 'mismatch') ?? [];
  const missing = a?.checks.filter(c => c.status === 'missing') ?? [];
  const cases = role === 'reviewer' ? SCENARIOS.filter(needsReview) : SCENARIOS;
  return <div className="mock-staff-layout">
    <aside className="mock-card mock-case-list" aria-label={role === 'reviewer' ? '검토 대상 요청' : '접수 요청 목록'}>
      <div className="mock-section-title"><h3>{role === 'reviewer' ? '확인 필요 요청' : '접수 요청'}</h3><span className="mock-count">{cases.length}</span></div>
      {cases.map(s => {
        const r = staffView(session, s, records);
        return <button key={s.id} className={`mock-case ${s.id === view.scenario.id ? 'selected' : ''}`} aria-current={s.id === view.scenario.id ? 'true' : undefined} onClick={() => onSelect(s)}>
          <strong>{s.title}</strong><span>{money(s.amount)}</span><small>{r.processingLabel} · {r.needsReview ? r.review.confirmed ? '확인 완료' : '확인 전' : '개별 검토 없음'}</small>
        </button>;
      })}
    </aside>
    <div className="mock-detail">
      <section className="mock-card">
        <div className="mock-detail-heading"><div><p className="mock-eyebrow">신규 대출 실행 전 대조</p><h2>주식회사 새봄테크</h2><p>{view.contractReference} · {view.scenario.title}</p></div><FileText size={28} /></div>
        <dl className="mock-status-grid">
          <div><dt>처리</dt><dd>{view.processingLabel}</dd></div>
          <div><dt>평가{view.late ? ' · 늦은 결과' : ''}</dt><dd>{assessmentLabel(a)}</dd></div>
          <div><dt>검토</dt><dd>{view.needsReview ? view.review.confirmed ? '확인 완료' : '확인 전' : '개별 검토 생략'}</dd></div>
        </dl>
        {view.late && <div className="mock-callout">자동 확인은 12분에 종료되었습니다. 13분에 도착한 결과를 별도로 표시합니다. 기존 종료 상태는 유지됩니다.</div>}
        <div className="mock-metrics">
          <div><span>이번 실행 요청금액</span><strong>{money(view.scenario.amount)}</strong><small>요청서 본문</small></div>
          <div><span>실행 전 대출잔액</span><strong>{money(view.balance)}</strong><small>가상 전산 · {time(view.balanceAsOf)}</small></div>
          <div><span>현재 잔여 한도</span><strong>{money(300_000_000)}</strong><small>계약 한도 − 실행 전 잔액</small></div>
        </div>
        <p className="mock-detail-note">접수번호 · {view.requestId}<br />최초 접수 · {time(view.receivedAt)} / 사례 기준 경과 · {view.scenario.elapsedMinutes}분</p>
      </section>
      <section className="mock-card">
        <div className="mock-section-title"><h3>비교 결과와 원문 근거</h3>{a?.grade !== null && a?.grade !== undefined && <span className={`mock-tag ${a.grade === 4 ? 'green' : 'amber'}`}>{a.grade}등급</span>}</div>
        {a ? <>
          <div className="mock-findings"><p><strong>확인된 불일치</strong> {differences.length ? differences.map(c => c.label).join(', ') : '없음'}</p><p><strong>미확인 항목</strong> {missing.length ? missing.map(c => c.key === 'amount' ? '이번 실행 요청금액' : c.label).join(', ') : '없음'}</p></div>
          <div className="mock-checks">{a.checks.map(c => <details key={c.key} open={c.status !== 'match'}>
            <summary><span>{c.status === 'match' ? <Check size={16} /> : <AlertTriangle size={16} />}{c.label}</span><span className={`mock-tag ${c.status === 'match' ? 'green' : c.status === 'mismatch' ? 'amber' : ''}`}>{c.status === 'match' ? '일치·충족' : c.status === 'mismatch' ? '불일치' : '확인 불가'}</span></summary>
            <div className="mock-comparison"><div><h4>{c.key === 'payoutAmount' ? '요청서 본문' : '기준정보'}</h4><EvidenceBlock value={c.baseline} /></div><div><h4>{c.key === 'payoutAmount' ? '요청서 지급표' : '요청 문서'}</h4><EvidenceBlock value={c.requested} /></div></div><p className="mock-check-note">{c.note}</p>
          </details>)}</div>
        </> : <div className="mock-empty"><AlertTriangle size={26} /><h4>아직 분석 결과가 없습니다.</h4><p>{view.guidance}</p><p>금액·등급을 0 또는 정상으로 채우지 않습니다.</p></div>}
      </section>
      <section className="mock-card"><div className="mock-section-title"><Bell size={18} /><h3>고객 안내·표시 기록</h3></div><div className="mock-notices mock-staff-notices">{view.notices.map(n => <NoticeCard key={n.id} notice={n} />)}</div><p className="mock-detail-note">고객 화면 표시 기록과 검토 확인 기록은 별개입니다.</p></section>
      {role === 'reviewer' && view.needsReview && <ReviewForm key={`${view.requestId}:${view.review.recordedAt}`} view={view} onSave={onSave} />}
      {role === 'banker' && view.needsReview && <a className="mock-review-link" href={`/mock/reviewer?session=${encodeURIComponent(session)}&case=${view.scenario.id}`}>검토자 화면에서 확인·메모 남기기 →</a>}
      <p className="mock-fine">1등급이 가장 위험, 4등급이 가장 낮습니다. 팀 PoC 정책이며 사기 확률을 뜻하지 않습니다.</p>
    </div>
  </div>;
}

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export default function MockScreens({ role = 'banker' }: { role?: Role }) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  return hydrated ? <MockScreenContent role={role} /> : <main className="mock-main" role="status">모의 화면을 준비하고 있습니다.</main>;
}

function MockScreenContent({ role }: { role: Role }) {
  const [initial] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get('session') || DEFAULT_SESSION;
    const usable = validSession(candidate);
    const session = usable ? candidate : DEFAULT_SESSION;
    const selected = SCENARIOS.find(s => s.id === params.get('case'))?.id ?? (role === 'reviewer' ? 'compound' : 'normal');
    let records = emptyRecords();
    let error = usable ? '' : '세션은 영문·숫자·밑줄·하이픈 8~90자로 입력해 주세요.';
    if (usable) try { records = readRecords(localStorage.getItem(storageKey(session)), session); }
    catch { error = '브라우저의 모의 기록을 읽지 못했습니다. 저장 기록을 확인해 주세요.'; }
    return { session, selected, records, error, usable };
  });
  const session = initial.session;
  const [selected, setSelected] = useState(initial.selected);
  const [records, setRecords] = useState<LocalRecords>(initial.records);
  const [error, setError] = useState(initial.error);
  const scenario = SCENARIOS.find(s => s.id === selected)!;
  useEffect(() => {
    if (!initial.usable) return;
    const reload = () => {
      try { setRecords(readRecords(localStorage.getItem(storageKey(session)), session)); setError(''); }
      catch { setError('브라우저의 모의 기록을 읽지 못했습니다. 저장 기록을 확인해 주세요.'); }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey(session) || event.key === null) reload(); };
    window.addEventListener('storage', onStorage); window.addEventListener(RECORD_EVENT, reload);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(RECORD_EVENT, reload); };
  }, [initial.usable, session]);
  const mutate = useCallback((change: (previous: LocalRecords) => LocalRecords) => {
    try {
      const previous = readRecords(localStorage.getItem(storageKey(session)), session);
      const next = change(previous);
      if (next !== previous) localStorage.setItem(storageKey(session), JSON.stringify(next));
      setRecords(next); setError(''); window.dispatchEvent(new Event(RECORD_EVENT)); return true;
    } catch (e) { setError(e instanceof Error ? e.message : '모의 기록을 저장하지 못했습니다.'); return false; }
  }, [session]);
  const onDisplayed = useCallback((id: string) => { mutate(r => markDisplayed(r, session, scenario, id, new Date().toISOString())); }, [mutate, session, scenario]);
  const selectCase = (s: Scenario) => {
    setSelected(s.id); const url = new URL(window.location.href); url.searchParams.set('session', session); url.searchParams.set('case', s.id); window.history.replaceState({}, '', url);
  };
  const customer = customerView(session, scenario, records);
  return <div className="mock-app">
    <div className="mock-mode-bar">모의 응답으로 화면 동작 확인 중 · 실제 문서 분석·외부 알림 없음</div>
    <header className="mock-header"><a className="mock-brand" href={`/mock?session=${session}&case=${selected}`}><b>iM</b><span>내부통제 보조</span></a><nav aria-label="모의 화면 역할">{(Object.keys(roleLabels) as Role[]).map(r => <a key={r} href={`/mock/${r}?session=${session}&case=${selected}`} aria-current={r === role ? 'page' : undefined}>{roleLabels[r]}</a>)}</nav><span className="mock-mode-chip">화면 모의 시연</span></header>
    <main className="mock-main">
      <div className="mock-page-heading"><div><p className="mock-eyebrow">{role === 'customer' ? 'CUSTOMER' : role === 'banker' ? 'BANK EMPLOYEE' : 'REVIEWER'}</p><h1>{role === 'customer' ? '나의 요청 안내' : role === 'banker' ? '대출 실행 요청 대조' : '예외 요청 검토'}</h1><p>{role === 'customer' ? '접수 사실과 확인이 필요한 내용을 안내합니다.' : role === 'banker' ? '계약·전산 기준정보와 요청을 비교합니다.' : '불일치·정보 누락·처리 미완료의 근거를 확인합니다.'}</p></div></div>
      <section className="mock-controls" aria-label="모의 시연 사례 선택"><label>모의 사례<select value={selected} onChange={e => selectCase(SCENARIOS.find(s => s.id === e.target.value)!)}>{SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><span>세션 · {session}</span><p>{scenario.note}</p></section>
      {error && <p className="mock-error" role="alert">{error}</p>}
      {initial.usable && (role === 'customer' ? <CustomerScreen view={customer} onDisplayed={onDisplayed} /> : <StaffScreen view={staffView(session, scenario, records)} role={role} session={session} records={records} onSelect={selectCase} onSave={(confirmed, memo) => mutate(r => saveReview(r, session, scenario, { confirmed, memo }, new Date().toISOString()))} />)}
    </main>
    <footer className="mock-footer">가상 문서·모의 근거를 사용한 화면입니다. 알림 표시·검토 기록은 같은 브라우저의 세션별 저장소에만 보존됩니다. 실제 권한 분리·n8n 저장 보장은 연결 후 검증합니다.</footer>
  </div>;
}
