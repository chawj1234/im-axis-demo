'use client';
import {useEffect,useState} from 'react';
import {FileText} from 'lucide-react';
import DailyReportContent from './daily-report-content';
import {demoApiUrl} from '../lib/demo-api.mjs';
import './daily-report-panel.css';

type Report={report_key:string;report_date:string;report_text:string;event_count:number;created_at:string;session_id?:string;cutoff_at?:string};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const reportValue=(value:unknown):Report|null=>{
  if(!value||typeof value!=='object')return null;
  const r=value as Record<string,unknown>;
  return typeof r.report_key==='string'&&typeof r.report_date==='string'&&typeof r.report_text==='string'&&typeof r.event_count==='number'&&typeof r.created_at==='string'?{...r,session_id:typeof r.session_id==='string'?r.session_id:undefined,cutoff_at:typeof r.cutoff_at==='string'?r.cutoff_at:undefined} as Report:null;
};
const kstDate=(value:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const reportSession=(report:Report)=>report.session_id|| (report.report_key.startsWith(report.report_date+':')?report.report_key.slice(report.report_date.length+1):'');
const reportScope=(report:Report,session:string)=>reportSession(report)==='all'?'전체 업무 기록':reportSession(report)===session&&session?'현재 업무 기록':'범위 확인 필요';
const reportTime=(value:string|undefined)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value))+' KST':'기록 없음';
export default function DailyReportPanel({session,preview=false}:{session:string;preview?:boolean}){
  const [reports,setReports]=useState<Report[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loadedSession,setLoadedSession]=useState('');
  const hasTodayReport=reports.some(report=>report.report_date===kstDate(new Date())&&reportSession(report)===session);
  const [reload,setReload]=useState(0),[refreshing,setRefreshing]=useState(false);
  const loading=!preview&&(!session||loadedSession!==session||!!refreshing);
  const sortedReports=[...reports].sort((a,b)=>b.report_date.localeCompare(a.report_date)||(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
  useEffect(()=>{
    if(!session||preview)return;
    const controller=new AbortController();
    void fetch(demoApiUrl('/api/reports?session='+encodeURIComponent(session)),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),cache:'no-store'}).then(async response=>{
      if(!response.ok)throw Error('보고서 목록을 불러오지 못했습니다.');
      const data=object(await response.json());
      if(!Array.isArray(data.reports)||data.reports.some(value=>!reportValue(value)))throw Error('invalid_report_list');
      if(!controller.signal.aborted)setReports((Array.isArray(data.reports)?data.reports:[]).flatMap((value:unknown)=>{const report=reportValue(value);return report?[report]:[];}));
    }).catch(()=>{if(!controller.signal.aborted)setError('보고서 목록을 불러오지 못했습니다.');}).finally(()=>{if(!controller.signal.aborted){setLoadedSession(session);setRefreshing(false);}});
    return ()=>controller.abort();
  },[session,preview,reload]);
  async function generate(){
    if(busy||loading||!session||preview)return;setBusy(true);setError('');
    try{
      const response=await fetch(demoApiUrl('/api/reports?session='+encodeURIComponent(session)),{method:'POST',signal:AbortSignal.timeout(65000)}),data=object(await response.json());
      const report=reportValue(data.report);if(!response.ok||!report||data.saved!==true)throw Error('보고서 생성·저장을 확인하지 못했습니다. 잠시 후 저장된 보고서를 확인해 주세요.');
      setReports(current=>[report,...current.filter(item=>item.report_key!==report.report_key)]);
    }catch{setError('보고서 생성·저장을 확인하지 못했습니다. 접수·분석을 다시 실행할 필요는 없습니다.');}
    finally{setBusy(false);}
  }
  return <section className="daily-report" aria-label="일일 요약 보고서">
    <div className="daily-report-heading"><div><h2><FileText size={18} aria-hidden="true"/>일일 요약 보고서</h2><p role="status">{loading?'저장된 보고서를 불러오는 중입니다.':busy?'현재 업무 기록의 당일 접수를 요약하고 있습니다.':reports.length?`저장된 보고서 ${reports.length}건 · 검토용 초안` : error?'저장 상태를 확인하지 못했습니다.':'저장된 보고서가 없습니다.'}</p></div><button className="daily-report-primary" type="button" onClick={()=>void generate()} disabled={preview||!session||loading||busy} aria-busy={busy}>{busy?(hasTodayReport?'보고서 갱신 중…':'보고서 작성 중…'):hasTodayReport?'현재 기준으로 보고서 갱신':'보고서 작성'}</button></div>
    {error?<div className="daily-report-error"><p role="alert">{error}</p><button type="button" disabled={preview||!session||loading||busy} onClick={()=>{setRefreshing(true);setError('');setReload(value=>value+1);}}>보고서 다시 불러오기</button></div>:null}
    <details className="daily-report-schedule"><summary>작성 기준</summary><p>자동 작성은 매일 16:30 전체 업무 기록, 수동 작성은 현재 주소에 연결된 업무 기록의 당일 접수를 집계합니다. 담당자별·기업별 범위는 아닙니다. 기준 시각까지 접수된 자료의 조회 당시 처리상태이며, 전날 접수 후 당일 완료된 건은 포함하지 않습니다.</p><p>같은 날짜·같은 범위의 기존 보고서를 최신 집계로 교체합니다. 기존 보고서가 없으면 새로 작성하며, 이전 버전은 별도로 저장하지 않습니다.</p></details>
    {sortedReports.map((report,index)=><details key={report.report_key+report.created_at} className="daily-report-entry" open={index===0}><summary><time dateTime={report.report_date}>{report.report_date}</time><span className="daily-report-entry-meta">{reportScope(report,session)} · 대상 접수 {report.event_count}건</span></summary><p className="daily-report-times">집계 기준: {reportTime(report.cutoff_at)} · 생성 완료: {reportTime(report.created_at)}</p><DailyReportContent text={report.report_text} compactHeader/></details>)}
  </section>;
}
