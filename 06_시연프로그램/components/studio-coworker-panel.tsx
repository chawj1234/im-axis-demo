"use client";

import {useEffect, useRef, useState} from 'react';
import {FileText, Send, X} from 'lucide-react';
import DailyReportContent from './daily-report-content';
import './daily-report-panel.css';
import './studio-coworker-panel.css';

const suggestions = [
  {label: '등급별 결과 보기', question: '저장된 요청서 대조 결과를 등급별로 알려 주세요.'},
  {label: '확인 필요 요청 보기', question: '확인 필요한 등급의 요청과 그 근거를 알려 주세요.'},
];

type Reply = {answer: string; error?: never} | {error: string; answer?: never};
type Turn = {question: string; reply?: Reply};

function CoworkerAvatar() {
  return <span className="coworker-avatar" aria-hidden="true"/>;
}

export function StudioCoworkerPanel({session}: {session: string}) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [report, setReport] = useState<Reply>();
  const [busy, setBusy] = useState<'chat' | 'report' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = transcript.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  async function ask(mode: 'chat' | 'report') {
    const message = question.trim();
    if (busy || !session || (mode === 'chat' && !message)) return;

    setBusy(mode);
    if (mode === 'chat') {
      setTurns(current => [...current, {question: message}]);
      setQuestion('');
    } else {
      setReport(undefined);
    }

    let reply: Reply;
    try {
      const path = '/api/studio/' + (mode === 'chat' ? 'coworker' : 'report') + '?session=' + encodeURIComponent(session);
      const response = await fetch(path, mode === 'report' ? {method: 'POST', cache: 'no-store'} : {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({question: message}),
      });
      const data = await response.json();
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      if (!response.ok || typeof result.answer !== 'string' || !result.answer.trim()) {
        throw Error(typeof result.error === 'string' ? result.error : '답변을 받지 못했습니다.');
      }
      reply = {answer: result.answer};
    } catch (failure) {
      reply = {error: failure instanceof Error ? failure.message : '답변을 받지 못했습니다.'};
    }

    if (mode === 'report') setReport(reply);
    else setTurns(current => current.map((turn, index) => index === current.length - 1 ? {...turn, reply} : turn));
    setBusy(null);
  }

  return <>
    <section className="daily-report" aria-labelledby="studio-report-title">
      <div className="daily-report-heading">
        <div>
          <h2 id="studio-report-title"><FileText size={18} aria-hidden="true"/>등급별 요약 보고서</h2>
          <p>Studio 요청서 결과를 등급별로 정리합니다. 예약 보고서는 Studio에서 확인하세요.</p>
        </div>
        <button className="daily-report-primary" type="button" disabled={!!busy || !session} aria-busy={busy === 'report'} onClick={() => void ask('report')}>
          {busy === 'report' ? '보고서 작성 중…' : '등급별 보고서 작성'}
        </button>
      </div>
      {busy === 'report' && <p className="studio-report-output" role="status">저장된 대조 결과를 조회하고 있습니다.</p>}
      {report?.error && <p className="studio-report-output" role="alert">{report.error}</p>}
      {report?.answer && <div className="studio-report-output" aria-live="polite"><DailyReportContent text={report.answer}/></div>}
    </section>
    <button className="coworker-launcher" type="button" popoverTarget="coworker-chat">
      <CoworkerAvatar/>질문하기
    </button>
    <section id="coworker-chat" popover="auto" role="dialog" className="daily-report coworker" aria-labelledby="coworker-title"
      onToggle={() => {
        const log = transcript.current;
        if (log) log.scrollTop = log.scrollHeight;
      }}>
      <div className="daily-report-heading">
        <div className="coworker-identity">
          <CoworkerAvatar/>
          <h2 id="coworker-title" className="sr-only">앤디</h2>
          <p className="coworker-message coworker-greeting">안녕하세요, 앤디예요. 계약이나 문서 대조 결과에서 궁금한 점을 물어보세요.</p>
        </div>
        <button className="coworker-close" type="button" popoverTarget="coworker-chat" popoverTargetAction="hide" aria-label="채팅창 닫기"><X size={18} aria-hidden="true"/></button>
      </div>
      {turns.length > 0 && <div className="coworker-log" ref={transcript} role="log" aria-relevant="additions text" aria-label="질문 및 답변" tabIndex={0}>
        {turns.map((turn, index) => <div className="coworker-turn" key={index}>
          <p className="coworker-message coworker-message-user"><span className="sr-only">내 질문 </span>{turn.question}</p>
          <p className="coworker-message" role={turn.reply?.error ? 'alert' : undefined}>
            <span className="sr-only">앤디 </span>{turn.reply?.answer || turn.reply?.error || '업무 기록을 확인하고 있어요…'}
          </p>
        </div>)}
      </div>}
      <div className="coworker-composer">
        {turns.length === 0 && <div className="coworker-suggestions" aria-label="예시 질문">
          {suggestions.map(suggestion => <button key={suggestion.label} type="button" disabled={!session} onClick={() => {setQuestion(suggestion.question); input.current?.focus();}}>{suggestion.label}</button>)}
        </div>}
        <form onSubmit={event => {event.preventDefault(); void ask('chat');}}>
          <label className="sr-only" htmlFor="studio-coworker-question">앤디에게 질문</label>
          <input ref={input} id="studio-coworker-question" value={question} maxLength={1000} disabled={!session} placeholder="질문을 입력하세요" onChange={event => setQuestion(event.target.value)}/>
          <button className="daily-report-primary" type="submit" aria-label="보내기" disabled={!!busy || !session || !question.trim()}><Send size={17} aria-hidden="true"/></button>
        </form>
        {!session && <p role="status">업무 기록이 연결되면 질문할 수 있습니다.</p>}
      </div>
    </section>
  </>;
}
