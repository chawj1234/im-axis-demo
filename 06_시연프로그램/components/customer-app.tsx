'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ArrowUpRight, Bell, ChevronRight, CreditCard, Crown, FileText, Fish, Gift, Home, Lightbulb, Menu, PieChart, Search, ShieldCheck, ShoppingBag, Sparkles, X} from 'lucide-react';
import {customerTransactions} from '../lib/customer-app-model';
import type {CustomerAppNotice, CustomerAppProps} from '../lib/customer-app-model';
import './customer-app.css';

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR', {month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'});
};

function VisibleNotice({notice, onVisible, refreshSignal, className, children}: {
  notice: CustomerAppNotice;
  onVisible: (id: string) => void;
  refreshSignal: CustomerAppNotice[];
  className: string;
  children: ReactNode;
}) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (notice.displayedAt || !element.current) return;
    const node = element.current;
    let visible = false;
    const report = () => {
      if (visible && document.visibilityState === 'visible') onVisible(notice.id);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
      report();
    }, {threshold: [0, 0.1]});
    observer.observe(node);
    document.addEventListener('visibilitychange', report);
    return () => {observer.disconnect(); document.removeEventListener('visibilitychange', report);};
  }, [notice.id, notice.displayedAt, onVisible, refreshSignal]);
  return <article ref={element} className={className} data-customer-notice-id={notice.id}>{children}</article>;
}

export default function CustomerApp({notices, activities, connected, error, onNoticeVisible, preview = false}: CustomerAppProps) {
  const [view, setView] = useState<'home' | 'notifications' | 'transactions' | 'transaction'>('home');
  const [detailReturn, setDetailReturn] = useState<'home' | 'transactions'>('transactions');
  const [selectedTransaction, setSelectedTransaction] = useState('');
  const transactions = customerTransactions(activities);
  const selected = transactions.find(item => item.id === selectedTransaction);
  const [bannerQueue, setBannerQueue] = useState<string[]>([]);
  const [amountHidden, setAmountHidden] = useState(false);
  const [help, setHelp] = useState('');
  const knownNotices = useRef(new Set<string>());
  const exposedNotices = useRef(new Set<string>());
  const exposureInFlight = useRef(new Set<string>());
  const callback = useRef(onNoticeVisible);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const unread = notices.filter(notice => !notice.displayedAt).length;
  const activeId = bannerQueue[0];
  const showBanner = view !== 'transaction' && view !== 'transactions';
  const banner = activeId ? notices.find(notice => notice.id === activeId) : undefined;

  useEffect(() => {callback.current = onNoticeVisible;}, [onNoticeVisible]);
  useEffect(() => {
    const incoming: string[] = [];
    for (const notice of notices) {
      if (knownNotices.current.has(notice.id)) continue;
      knownNotices.current.add(notice.id);
      // A display acknowledgement may arrive while its banner is still open.
      // Only newly discovered notices use displayedAt to decide whether to queue.
      if (!notice.displayedAt) incoming.push(notice.id);
    }
    if (incoming.length) setBannerQueue(queue => [...queue, ...incoming]);
  }, [notices]);
  const dismissBanner = useCallback((id: string) => {
    setBannerQueue(queue => queue.filter(queued => queued !== id));
  }, []);
  useEffect(() => {
    if (!activeId || !showBanner) return;
    let remaining = 9000;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        timer = undefined;
      }
    };
    const resume = () => {
      pause();
      if (document.visibilityState !== 'visible') return;
      startedAt = Date.now();
      timer = setTimeout(() => dismissBanner(activeId), remaining);
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {pause(); document.removeEventListener('visibilitychange', resume);};
  }, [activeId, dismissBanner, showBanner]);
  useEffect(() => {
    const dialog = helpDialog.current;
    if (!dialog) return;
    if (help && !dialog.open) dialog.showModal();
    if (!help && dialog.open) dialog.close();
  }, [help]);
  const reportVisible = useCallback((id: string) => {
    const handler = callback.current;
    if (document.visibilityState !== 'visible' || exposedNotices.current.has(id) || exposureInFlight.current.has(id) || !handler) return;
    exposureInFlight.current.add(id);
    void Promise.resolve().then(() => handler(id))
      .then(() => {exposedNotices.current.add(id);})
      // A failed acknowledgement can be retried on the next state refresh or
      // when this notice becomes visible again. Keep concurrent views deduped.
      .catch(() => {})
      .finally(() => {exposureInFlight.current.delete(id);});
  }, []);
  const changeView = (next: 'home' | 'notifications' | 'transactions' | 'transaction') => {
    setView(next);
    window.scrollTo({top: 0, behavior: 'auto'});
  };
  const backFromDetail = () => {
    const next = view === 'transaction' ? detailReturn : 'home';
    changeView(next);
  };
  const openHelp = () => setHelp('이 화면에서는 문서 접수 안내와 고객 알림을 확인할 수 있어요.');

  const transactionRow = (item: typeof transactions[number]) => <button key={item.id} type="button" className="c-app-transaction-row" onClick={() => {setDetailReturn(view === 'home' ? 'home' : 'transactions'); setSelectedTransaction(item.id); changeView('transaction');}}>
    <span><strong>{item.label}</strong><span>요청서 {item.requestCount}건 · 최근 접수 {dateLabel(item.receivedAt) || '일시 정보 없음'}</span>{item.needsAttention && <em>추가 확인 필요</em>}</span><ChevronRight size={20}/>
  </button>;

  return <div className={'c-app ' + (view !== 'home' ? 'c-app--inbox' : 'c-app--home')} data-testid="customer-app">
    {banner && showBanner && <div className="c-app-banner-region" aria-live="polite" aria-atomic="true">
      <VisibleNotice notice={banner} onVisible={reportVisible} refreshSignal={notices} className={'c-app-banner c-app-banner--' + banner.kind}>
        <div className="c-app-banner-content">
          <span className="c-app-banner-symbol"><Bell size={20}/></span>
          <span className="c-app-banner-copy"><span className="c-app-banner-brand">iM뱅크 <span>지금</span></span><strong>{banner.title}</strong><span className="c-app-banner-message">{banner.message}</span></span>
        </div>
        <button type="button" className="c-app-banner-close" onClick={() => dismissBanner(banner.id)} aria-label="알림 배너 닫기"><X size={19}/></button>
      </VisibleNotice>
    </div>}

    {view === 'home' ? <>
      <header className="c-app-home-header">
        <img className="c-app-wordmark" src="/im-bank-wordmark.png" alt="iMBank" width="116" height="29"/>
        <div className="c-app-header-actions">
          <button type="button" className="c-app-icon-button" onClick={openHelp} aria-label="이용 안내"><Lightbulb size={27} strokeWidth={1.8}/></button>
          <button type="button" className="c-app-icon-button" onClick={openHelp} aria-label="검색 안내"><Search size={27} strokeWidth={1.8}/></button>
          <button type="button" className="c-app-icon-button c-app-bell" onClick={() => changeView('notifications')} aria-label={'알림함' + (unread ? ', 새 알림 ' + unread + '개' : '')}>
            <Bell size={27} strokeWidth={1.8}/>{unread > 0 && <span className="c-app-badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
        </div>
      </header>
      <main className="c-app-home-main">
        <section className="c-app-promotion" aria-label="고객 안내">
          <div className="c-app-promo-art" aria-hidden="true"><span className="c-app-sparkle"><Sparkles size={19}/></span><ShieldCheck size={49} strokeWidth={1.65}/><span className="c-app-promo-check">✓</span></div>
          <div><p>내 금융생활을</p><h1>한눈에<br/>확인하세요</h1></div>
          <button type="button" className="c-app-icon-button" onClick={() => changeView('notifications')} aria-label="나의 알림 보기"><ChevronRight size={23}/></button>
        </section>
        {(!connected || error) && <p className="c-app-connection" role="status">안내 화면 연결을 확인해 주세요.</p>}
        <section className="c-app-quick-menu" aria-label="금융 메뉴">
          <button type="button" onClick={openHelp}><span className="c-app-quick-icon c-app-quick-icon--fish"><Fish size={33} strokeWidth={1.7}/><i/></span><span>머니피쉬</span></button>
          <button type="button" onClick={openHelp}><span className="c-app-quick-icon c-app-quick-icon--data"><PieChart size={34} strokeWidth={1.8}/></span><span>마이데이터</span></button>
          <button type="button" onClick={openHelp}><span className="c-app-quick-icon c-app-quick-icon--crown"><Crown size={35} fill="currentColor" strokeWidth={1.3}/></span><span>모임라운지</span></button>
          <button type="button" onClick={openHelp}><span className="c-app-quick-icon c-app-quick-icon--invest"><ArrowUpRight size={34} strokeWidth={3}/></span><span>투자라운지</span></button>
        </section>

        <section className="c-app-card c-app-activities" aria-labelledby="c-app-activities-title">
          <div className="c-app-card-heading"><h2 id="c-app-activities-title">나의 거래 현황</h2><button type="button" className="c-app-text-button" onClick={() => changeView('transactions')}>전체 보기 <ChevronRight size={16}/></button></div>
          {transactions.length === 0 ? <p className="c-app-activity-empty">접수된 거래 내역이 없습니다.</p> : transactions.slice(0, 2).map(item => transactionRow(item))}
        </section>

        <section className="c-app-card c-app-account">
          <div className="c-app-card-heading"><h2>내 계좌</h2><button type="button" className="c-app-amount-toggle" role="switch" aria-checked={amountHidden} onClick={() => setAmountHidden(hidden => !hidden)}><span>금액 숨김</span><span className="c-app-switch" aria-hidden="true"><i/></span></button></div>
          <div className="c-app-account-row"><span className="c-app-account-symbol" aria-hidden="true">iM</span><div className="c-app-account-copy"><p>저축예금(iM스마트통장)</p><span className="c-app-sample-label">시연 계좌</span><strong>{amountHidden ? '금액 숨김' : '0원'}</strong></div><button type="button" className="c-app-soft-button" disabled>이체</button></div>
          <button type="button" className="c-app-card-promo" onClick={openHelp}><span className="c-app-mini-card" aria-hidden="true">M</span><span><small>iM뱅크와 함께</small><strong>나에게 맞는 금융생활</strong></span><ChevronRight size={20}/></button>
          <div className="c-app-card-bottom"><button type="button" onClick={openHelp}>홈 계좌 설정</button><button type="button" onClick={openHelp}>전체계좌 보기</button></div>
        </section>

        <section className="c-app-card c-app-my-card">
          <div className="c-app-card-heading"><h2>내 카드 <ChevronRight size={21}/></h2></div>
          <div className="c-app-bank-card-row"><span className="c-app-bank-card" aria-hidden="true"><CreditCard size={21}/></span><div><p>내 카드 연결</p><strong>결제금액 한눈에 보기</strong></div><button type="button" className="c-app-soft-button" disabled>연결</button></div>
        </section>

        <p className="c-app-footnote">{preview ? '고객 알림 화면 미리보기' : '고객 안내 시연 화면'} · 계좌와 카드 정보는 가상입니다.</p>
      </main>
      <nav className="c-app-bottom-nav" aria-label="주요 메뉴">
        <button type="button" className="c-app-nav-active" aria-current="page" onClick={() => changeView('home')}><Home size={27} fill="currentColor" strokeWidth={1.8}/><span>홈</span></button>
        <button type="button" onClick={openHelp}><ShoppingBag size={27} strokeWidth={1.7}/><span>상품</span></button>
        <button type="button" onClick={openHelp}><span className="c-app-gift-icon"><Gift size={28} strokeWidth={1.7}/></span><span>혜택</span></button>
        <button type="button" onClick={openHelp}><Menu size={28} strokeWidth={1.7}/><span>전체</span></button>
      </nav>
    </> : view === 'transactions' || view === 'transaction' ? <>
      <header className="c-app-inbox-header"><button type="button" className="c-app-icon-button" onClick={backFromDetail} aria-label="이전 화면으로"><ArrowLeft size={29}/></button><h1>{view === 'transactions' ? '나의 접수 내역' : '서류 접수 내역'}</h1></header>
      <main className={'c-app-inbox-main'+(view==='transaction'?' c-app-receipt-detail':'')}>
        {view === 'transactions' ? <>{transactions.length ? transactions.map(item => transactionRow(item)) : <p className="c-app-activity-empty">접수된 거래 내역이 없습니다.</p>}</> : selected ? <>
          <section className="c-app-receipt-summary" aria-label="접수 현황">
            <span className="c-app-receipt-kicker">서류 접수 현황</span><h2>{selected.reference ? '계약 '+selected.reference : '계약 서류 접수'}</h2>
            <p>계약서 {selected.activities.filter(a=>a.documentKind==='contract').length}건 · 실행 요청서 {selected.requestCount}건</p>
            <span className={'c-app-receipt-state'+(selected.needsAttention?' c-app-receipt-state--attention':'')}>{selected.needsAttention?'담당자 확인 필요':'서류가 접수되었습니다'}</span>
          </section>
          <h2 className="c-app-receipt-list-title">서류별 접수 기록</h2>
          {[...selected.activities].sort((a,b)=>(a.documentKind==='contract'?0:1)-(b.documentKind==='contract'?0:1)||a.receivedAt.localeCompare(b.receivedAt)).map(activity => <article key={activity.id} id={'customer-activity-' + activity.id} tabIndex={-1} className={'c-app-activity c-app-receipt-item' + (activity.status==='추가 확인 필요'?' c-app-receipt-item--attention':'')}><div className="c-app-activity-top"><h3>{activity.documentKind === 'contract' ? '계약서' : activity.documentKind === 'request' ? '실행 요청서' : '서류'}</h3><span>{activity.status === '접수 완료' ? '접수됨' : activity.status}</span></div><p>{activity.message}</p><time dateTime={activity.receivedAt}>{dateLabel(activity.receivedAt)}</time></article>)}
          {selected.requestCount === 0 && <p className="c-app-activity-empty">요청서 접수 내역이 없습니다.</p>}
        </> : <p className="c-app-activity-empty">접수 내역을 찾을 수 없습니다.</p>}
      </main>
    </> : <>
      <header className="c-app-inbox-header"><button type="button" className="c-app-icon-button" onClick={() => changeView('home')} aria-label="홈으로 돌아가기"><ArrowLeft size={29} strokeWidth={1.7}/></button><h1>알림</h1><button type="button" className="c-app-settings" onClick={() => setHelp('계약서·실행요청서 접수와 불일치 안내를 확인할 수 있어요.')}>설정</button></header>
      <main className="c-app-inbox-main">
        {notices.length === 0 ? <div className="c-app-inbox-empty"><span className="c-app-empty-document" aria-hidden="true"><FileText size={58} strokeWidth={1.3}/><i/></span><p>아직 받은 알림이 없어요</p><span>받은 알림은 여기에 표시됩니다.</span></div> : <>
          <p className="c-app-inbox-summary">전체 알림 <strong>{notices.length}</strong></p>
          <div className="c-app-notice-list">{[...notices].reverse().map(notice => <VisibleNotice key={notice.id} notice={notice} onVisible={reportVisible} refreshSignal={notices} className={'c-app-notice c-app-notice--' + notice.kind}>
            <div className="c-app-notice-content">
            <span className="c-app-notice-icon" aria-hidden="true">{notice.kind === 'warning' ? <ShieldCheck size={21}/> : <Bell size={21}/>}</span><div className="c-app-notice-copy"><div className="c-app-notice-title"><h2>{notice.title}</h2>{!notice.displayedAt && <span className="c-app-new-dot" aria-label="새 알림"/>}</div><p>{notice.message}</p><time dateTime={notice.createdAt}>{dateLabel(notice.createdAt)}</time></div>
            </div>
          </VisibleNotice>)}</div>
        </>}
      </main>
    </>}

    <dialog ref={helpDialog} className="c-app-dialog" onCancel={() => setHelp('')} onClick={event => {if (event.target === event.currentTarget) setHelp('');}} aria-labelledby="c-app-help-title"><div><h2 id="c-app-help-title">이용 안내</h2><p>{help}</p><button type="button" onClick={() => setHelp('')}>확인</button></div></dialog>
  </div>;
}
