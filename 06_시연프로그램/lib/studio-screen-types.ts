export type StudioRole = 'banker' | 'admin';
export type StudioKind = 'contract' | 'request';
export type StudioConfig = {configuration_mode:'latest'|'pinned'; enabled:boolean; kinds:Record<StudioKind, boolean>};
export type StudioJob = {
  id:string; kind:StudioKind; filename:string; document_id:string; received_at:string; updated_at:string;
  processing_status:'received'|'uploading'|'creating'|'queued'|'in_progress'|'completed'|'failed'|'uncertain';
  evaluation_status:'pending'|'completed'|'incomplete'|'not_applicable'; collection_status:'unconfirmed';
  grade:number|null; decision_label:string|null; reason:string|null; document_routing_required:boolean;
  document_request_id:string|null; document_contract_id:string|null; studio_job_id:string|null;
  configuration_mode:'latest'|'pinned'; resolved_config_id:string|null; error_code:string|null;
  checks:{key:string;label:string;status:string;basis:string}[]; basic_comparison:'match'|'mismatch'|'unknown'; studio_url:string|null;
};
export type StudioSummary = {reportDate:string;cutoff:string;provenance:{scope:'tracked_receipts'};counts:Record<string,number>;gradeCounts:Record<string,number>};
export type StudioSnapshot = {provider:'studio';session_id:string;jobs:StudioJob[];summary:StudioSummary|null;summary_error?:string;configuration_mode:'latest'|'pinned'};
export const validStudioSession = (value:unknown):value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,90}$/.test(value);
const object = (value:unknown):Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
export function readStudioConfig(value:unknown):StudioConfig|null {
  const config=object(value);
  if(config.execution_provider !== 'studio') return null;
  const studio=object(config.studio), kinds=object(studio.kinds);
  if(!['latest','pinned'].includes(String(studio.configuration_mode)) || typeof studio.enabled !== 'boolean' || typeof kinds.contract !== 'boolean' || typeof kinds.request !== 'boolean') throw Error('config_invalid');
  return {configuration_mode:studio.configuration_mode as 'latest'|'pinned',enabled:studio.enabled,kinds:{contract:kinds.contract,request:kinds.request}};
}
export function readStudioSnapshot(value:unknown, session:string, role:StudioRole):StudioSnapshot {
  const state=object(value);
  if(state.provider !== 'studio' || state.session_id !== session || !Array.isArray(state.jobs) || !['latest','pinned'].includes(String(state.configuration_mode))) throw Error('state_invalid');
  const jobs=state.jobs.map(value=>{
    const job={...object(value)};
    if(typeof job.id !== 'string' || !['contract','request'].includes(String(job.kind)) || typeof job.filename !== 'string' || typeof job.document_id !== 'string' || typeof job.received_at !== 'string'
      || !['received','uploading','creating','queued','in_progress','completed','failed','uncertain'].includes(String(job.processing_status))) throw Error('state_invalid');
    const terminal=job.processing_status==='completed' && !job.document_routing_required;
    const checks=Array.isArray(job.checks) ? job.checks.filter(value=>{const check=object(value);return ['key','label','status','basis'].every(key=>typeof check[key]==='string');}) : [];
    Object.assign(job,{checks:terminal ? checks : [],grade:terminal && job.evaluation_status==='completed' && Number.isInteger(job.grade) && Number(job.grade)>=1 && Number(job.grade)<=6 ? job.grade : null,reason:terminal ? job.reason : null,decision_label:terminal ? job.decision_label : null});
    return role === 'banker' ? {...job,grade:null,reason:null,decision_label:null,checks:[],document_request_id:null,document_contract_id:null,studio_url:null,studio_job_id:null,validation:null,purpose_review:null,request_fields:null,matched_contract:null,requested_ratio:null,partial_evidence:false,basic_comparison:'unknown',document_routing_required:job.document_routing_required===true,error_code:null} as unknown as StudioJob : job as StudioJob;
  });
  const summary=state.summary == null ? null : object(state.summary);
  if(summary && (object(summary.provenance).scope!=='tracked_receipts' || typeof summary.reportDate!=='string' || typeof summary.cutoff!=='string' || !Object.keys(object(summary.counts)).length || Object.values(object(summary.counts)).some(value=>typeof value!=='number' || !Number.isFinite(value) || value<0))) throw Error('summary_invalid');
  return {...state,jobs,summary:role==='admin' ? summary : null} as StudioSnapshot;
}
export function studioJobStatus(job:StudioJob, role:StudioRole):string {
  if(job.processing_status === 'uncertain') return '접수 연결 확인 필요 · 자동 재실행 안 함';
  if(job.processing_status === 'failed') return '처리 실패 · 담당자 확인 필요';
  if(job.processing_status !== 'completed') return ({received:'접수 완료 · 처리 대기',uploading:'문서 전송 중',creating:'분석 연결 중',queued:'분석 대기',in_progress:'분석 중'})[job.processing_status];
  if(job.document_routing_required) return role === 'banker' ? '문서 종류 확인 필요 · 대조 대상 아님' : '문서 종류 확인 안내 · 대조 대상 아님';
  if(job.kind === 'contract') return '분석 완료 · 저장 미확인';
  if(role === 'banker') return '처리 완료 · 저장 미확인';
  if(job.evaluation_status === 'incomplete') return '미평가 · 정보 확인 필요';
  if(job.evaluation_status !== 'completed' || !Number.isInteger(job.grade) || Number(job.grade)<1 || Number(job.grade)>6) return '결과 확인 필요';
  return `대조 완료 · ${job.grade}등급`;
}
export function studioNavigation(value:string|null|undefined):string|null {
  try {const url=new URL(value || ''); return url.origin==='https://studio.upstage.ai' && /^\/agents\/[A-Za-z0-9_-]+/.test(url.pathname) && !url.username && !url.password ? url.href : null;} catch {return null;}
}
