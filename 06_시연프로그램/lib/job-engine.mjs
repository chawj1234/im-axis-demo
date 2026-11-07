import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RecordStore} from './record-store.mjs';
import {AGENT_ID,extractResult,confirmedTransientFailure} from './studio-results.mjs';
import {rules} from './verification.mjs';
import {isLifecycleJob,isFeedbackJob,isRegisteredContract,lifecycleReceiptNotice,lifecycleCustomerActivity} from './document-lifecycle.mjs';
import {pairedCustomerActivities,pairedReceiptNotices} from './paired-notifications.mjs';
import {currentDocumentJobs} from './retry-lineage.mjs';

export const DELAY_MS=360000,END_MS=720000;
const terminal=new Set(['completed','failed','ended']);
const errorText=e=>e instanceof Error?e.message:String(e);
const iso=t=>new Date(t).toISOString();
const mismatchMessage='계약서와 요청서의 정보가 일치하지 않는 항목이 있습니다. 담당자에게 확인해 주세요.';
const warningMessage=(job,result)=>isFeedbackJob(job)?mismatchMessage:result?.customer?.message||mismatchMessage;
const needsWarning=(job,result)=>isFeedbackJob(job)
  ?['contract-request-six-grade-v1','contract-request-expanded-grade-v2'].includes(result?.policy_version)&&result.evaluation_status==='completed'&&Array.isArray(result.checks)&&result.checks.some(check=>check.status==='mismatch')
  :result?.warning_required===true;
const addNotice=(record,job,kind,at,message)=>{
  const id=job.id+':'+kind;
  if(!record.notifications.some(n=>n.id===id))record.notifications.push({id,job_id:job.id,kind,created_at:at,message,displayed_at:{}});
};
const paired=job=>job.intake_mode==='paired';
const addStaffFailure=(record,job,at)=>{
  if(!isFeedbackJob(job)||job.resolution_status==='needs_document_routing')return;
  record.staff_notifications ||= [];
  const id=job.id+':staff:extraction_failure';
  if(record.staff_notifications.some(n=>n.id===id))return;
  const retryCount=Math.max(0,...(job.documents||[]).map(d=>Math.max(0,(d.attempts?.length||0)-1)),(job.attempts?.length||0)-1);
  record.staff_notifications.push({id,job_id:job.id,kind:'extraction_failure',audience:'staff',created_at:at,stage:job.stage,retry_count:retryCount,...(job.supplement_request?.status==='required'?{code:'studio_validation_red',supplement_required:true}:{}),message:job.supplement_request?.status==='required'?job.supplement_request.message:'문서 자동 확인을 완료하지 못했습니다. 관리 현황에서 접수를 확인해 주세요.'});
};
async function durableFile(folder,name,data) {
  const temp=join(folder,'.'+name+'.'+randomUUID()+'.tmp');
  const handle=await open(temp,'wx',0o600);
  try {await handle.writeFile(data);await handle.sync();} finally {await handle.close();}
  try {await rename(temp,join(folder,name));const dir=await open(folder,'r');try {await dir.sync();} finally {await dir.close();}} finally {await rm(temp,{force:true});}
}
export class JobEngine {
  /** @param {{root:string, provider:any, clock?:()=>number, configId?:string|null, allowLatest?:boolean, lateWarnings?:boolean}} options */
  constructor({root,provider,clock=()=>Date.now(),configId=null,allowLatest=false,lateWarnings=false}) {
    this.root=root;this.store=new RecordStore(root);this.provider=provider;this.clock=clock;this.configId=configId;this.allowLatest=allowLatest;this.lateWarnings=lateWarnings;this.ticking=false;
  }
  async submit({session,bytes,filename,kind,contract_id='',initial_balance=null,received_at=iso(this.clock())}) {
    const document_id=createHash('sha256').update(session).update(bytes).digest('hex');
    return this.store.update(session,async record=>{
      const old=record.jobs.find(j=>j.document_id===document_id);
      if(old)return {duplicate:true,job:old};
      if(kind==='request'&&!record.contracts.some(c=>c.contract_id===contract_id&&c.session_id===session))throw Error('같은 시연 세션에 등록된 계약을 선택해 주세요.');
      if(kind==='contract'&&(!Number.isSafeInteger(initial_balance)||initial_balance<0))throw Error('계약 등록에는 원 단위 초기 모의 잔액이 필요합니다.');
      const folder=join(this.root,document_id);await mkdir(folder,{recursive:true,mode:0o700});
      await writeFile(join(folder,'source.pdf'),bytes,{mode:0o600});
      const job={id:'REQ-'+randomUUID(),session_id:session,document_id,filename,kind,contract_id:kind==='contract'?'CON-'+randomUUID():contract_id,initial_balance,created_at:received_at,updated_at:received_at,stage:'received',processing_status:'received',evaluation_status:'pending',review_status:'pending',final_grade:null,attempts:[],timeline:[{stage:'received',at:received_at}],delivery:{},agent_id:AGENT_ID,config_id:this.configId,configuration_mode:this.configId?'pinned':this.allowLatest?'latest':'unconfirmed',mirror:{status:'not_ready'},late_result:null};
      record.jobs.push(job);
      if(this.provider.executionOwner==='n8n'){job.execution_owner='n8n';job.submission={status:'pending'};}
      if(kind==='request')addNotice(record,job,'receipt',received_at,'대출 실행 요청이 접수되었습니다. 요청하신 내용인지 확인해 주세요.');
      return {duplicate:false,job};
    });
  }
  async submitPair({session,files,received_at=iso(this.clock())}) {
    if(!Array.isArray(files)||files.length!==2)throw Error('계약서와 실행 요청서, PDF 문서 2개가 필요합니다.');
    const documents=files.map(file=>{
      if(!(file?.bytes instanceof Uint8Array))throw Error('PDF 파일 데이터를 확인해 주세요.');
      const bytes=Buffer.from(file.bytes);
      if(bytes.length>25*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('25 MB 이하의 유효한 PDF 문서가 필요합니다.');
      if(!Number.isInteger(file.pages)||file.pages<1||file.pages>20)throw Error('이번 데모는 20페이지 이하 PDF를 지원합니다.');
      if(typeof file.filename!=='string'||!file.filename.trim())throw Error('PDF 파일명을 확인해 주세요.');
      const filename=file.filename.replace(/[\r\n]/g,'').slice(0,180);
      return {bytes,filename,pages:file.pages,document_id:createHash('sha256').update(session).update(bytes).digest('hex')};
    });
    if(documents[0].document_id===documents[1].document_id)throw Error('같은 PDF 문서를 중복 접수할 수 없습니다. 서로 다른 두 문서를 선택해 주세요.');
    const document_id=createHash('sha256').update('paired\0').update(session).update('\0').update(documents.map(d=>d.document_id).sort().join('\0')).digest('hex');
    return this.store.update(session,async record=>{
      const old=record.jobs.find(j=>paired(j)&&j.document_id===document_id);
      if(old)return {duplicate:true,job:old};
      for(const document of documents) {
        const folder=join(this.root,document.document_id);await mkdir(folder,{recursive:true,mode:0o700});
        await durableFile(folder,'source.pdf',document.bytes);
        await durableFile(folder,'meta.json',JSON.stringify({session,filename:document.filename,pages:document.pages}));
      }
      const job={id:'REQ-'+randomUUID(),session_id:session,intake_mode:'paired',document_id,documents:documents.map(({filename,pages,document_id})=>({filename,pages,document_id})),filenames:documents.map(d=>d.filename),files:documents.map(d=>({name:d.filename,document_id:d.document_id})),kind:'request',contract_id:'CON-'+randomUUID(),created_at:received_at,updated_at:received_at,stage:'received',processing_status:'received',evaluation_status:'pending',review_status:'pending',final_grade:null,attempts:[],timeline:[{stage:'received',at:received_at}],delivery:{},agent_id:AGENT_ID,config_id:this.configId,configuration_mode:this.configId?'pinned':this.allowLatest?'latest':'unconfirmed',mirror:{status:'not_ready'},late_result:null,execution_owner:'n8n',submission:{status:'pending'}};
      record.jobs.push(job);
      record.notifications.push(...pairedReceiptNotices(job));
      return {duplicate:false,job};
    });
  }
  async submitContract({session,file,received_at=iso(this.clock())}) {
    return this.submitLifecycle({session,file,received_at,mode:'contract_registration'});
  }
  async submitRequest({session,file,contract_id,received_at=iso(this.clock())}) {
    return this.submitLifecycle({session,file,contract_id,received_at,mode:'registered_request'});
  }
  async continueDocument(session,id,contract_id) {
    const record=await this.store.read(session),source=record.jobs.find(j=>j.id===id);
    if(!source||!isLifecycleJob(source)||source.resolution_status!=='needs_document_routing'||source.document_routing?.can_continue!==true)throw Error('이어갈 수 있는 문서 접수를 찾지 못했습니다.');
    const file={...source.documents[0],bytes:await readFile(join(this.root,source.document_id,'source.pdf'))};
    return this.submitLifecycle({session,file,contract_id,received_at:iso(this.clock()),mode:source.document_routing.detected_kind==='contract'?'contract_registration':'registered_request',source_job_id:id});
  }
  async retryDocument(session,id) {
    if(!/^[A-Za-z0-9_-]{8,90}$/.test(session||'')||!/^REQ-[A-Za-z0-9-]{1,80}$/.test(id||''))throw Error('재시도할 접수 정보를 확인해 주세요.');
    return this.store.update(session,async record=>{
      const source=record.jobs.find(job=>job.id===id);
      if(!source||source.session_id!==session||!isLifecycleJob(source))throw Error('재시도할 문서 접수를 찾지 못했습니다.');
      // The source remains immutable as a failed analysis; repeat clicks only
      // retrieve its one durable retry, even after that retry has finished.
      const previous=record.jobs.find(job=>job.id===source.retry_job_id&&job.retry_source_id===source.id);
      if(previous)return {duplicate:true,job:previous};
      if(source.retry_job_id)throw Error('기존 재시도 기록을 확인하지 못했습니다. 새 분석을 만들지 않습니다.');
      if(source.stage!=='failed'||source.error!=='studio_validation_red'||source.validation?.verdict!=='red'||source.submission?.status!=='accepted'||source.remote_synced!==true)throw Error('Studio 검증 RED로 종료된 문서만 재시도할 수 있습니다.');
      if(source.document_routing?.detected_kind&&source.document_routing.detected_kind!==source.kind)throw Error('문서 종류에 맞는 접수 단계에서 진행해 주세요.');
      if(typeof this.configId!=='string'||!/^[1-9]\d{0,8}$/.test(this.configId))throw Error('재시도에 사용할 Studio 저장 설정을 확인해 주세요.');
      if(this.provider.executionOwner!=='n8n')throw Error('문서 재시도 연결을 확인해 주세요.');
      const document=source.documents?.[0];
      if(source.documents?.length!==1||document?.document_id!==source.document_id||!/^[a-f0-9]{64}$/.test(source.document_id)||!Number.isInteger(document.pages)||document.pages<1||document.pages>20||typeof document.filename!=='string'||!document.filename.trim())throw Error('재시도할 원본 문서 정보를 확인하지 못했습니다.');
      const bytes=await readFile(join(this.root,source.document_id,'source.pdf'));
      if(bytes.length>25*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||createHash('sha256').update(session).update(bytes).digest('hex')!==source.document_id)throw Error('원본 PDF가 접수 기록과 다릅니다. 재시도하지 않았습니다.');
      let contract;
      if(source.intake_mode==='registered_request'){
        contract=record.contracts.find(value=>value.contract_id===source.contract_id&&isRegisteredContract(value,session));
        if(!contract)throw Error('같은 세션에 등록 완료된 원래 계약을 확인해 주세요.');
      }else if(record.contracts.some(value=>value.contract_id===source.contract_id))throw Error('이미 등록된 계약은 실패 문서로 재등록하지 않습니다.');
      const at=iso(this.clock()),job={id:'REQ-'+randomUUID(),session_id:session,intake_mode:source.intake_mode,kind:source.kind,contract_id:source.contract_id,
        document_id:source.document_id,filename:document.filename,documents:[{filename:document.filename,pages:document.pages,document_id:document.document_id}],
        filenames:[document.filename],files:[{name:document.filename,document_id:document.document_id}],...(contract?{contract_snapshot:structuredClone(contract)}:{}),
        created_at:at,updated_at:at,stage:'received',processing_status:'received',evaluation_status:'pending',review_status:'pending',final_grade:null,
        attempts:[],timeline:[{stage:'received',at}],delivery:{},agent_id:AGENT_ID,config_id:this.configId,configuration_mode:'pinned',
        mirror:{status:'not_ready'},late_result:null,execution_owner:'n8n',submission:{status:'pending'},retry_source_id:source.id,retry_root_id:source.retry_root_id||source.id};
      source.retry_job_id=job.id;source.updated_at=at;
      source.audit_logs||=[];source.audit_logs.push({at,label:'문서 재시도',detail:job.id});
      record.jobs.push(job);
      // This is a new analysis of an existing receipt, not another customer receipt.
      return {duplicate:false,job};
    });
  }
  async submitLifecycle({session,file,contract_id,received_at,mode,source_job_id}) {
    if(!/^[A-Za-z0-9_-]{8,90}$/.test(session||''))throw Error('접수 세션을 확인해 주세요.');
    if(!(file?.bytes instanceof Uint8Array))throw Error('PDF 파일 데이터를 확인해 주세요.');
    const bytes=Buffer.from(file.bytes);
    if(bytes.length>25*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('25 MB 이하의 유효한 PDF 문서가 필요합니다.');
    if(!Number.isInteger(file.pages)||file.pages<1||file.pages>20)throw Error('20페이지 이하 PDF가 필요합니다.');
    if(typeof file.filename!=='string'||!file.filename.trim())throw Error('PDF 파일명을 확인해 주세요.');
    const filename=file.filename.replace(/[\r\n]/g,'').slice(0,180);
    const document_id=createHash('sha256').update(session).update(bytes).digest('hex');
    return this.store.update(session,async record=>{
      let analysis_reuse;
      if(source_job_id){
        const source=record.jobs.find(j=>j.id===source_job_id),document=source?.documents?.[0];
        const kind=mode==='contract_registration'?'contract':'request';
        if(!isLifecycleJob(source)||source.resolution_status!=='needs_document_routing'||source.document_routing?.can_continue!==true||source.document_routing.detected_kind!==kind||source.document_id!==document_id||document?.validation?.verdict!=='green'||document.kind!==kind||!document.extracted||!/^job_[A-Za-z0-9_-]+$/.test(document.attempts?.at(-1)?.job_id||''))throw Error('기존 문서 분석을 재사용할 수 없습니다.');
        const continued=record.jobs.find(j=>j.continuation_source_id===source_job_id||j.id===source.document_routing.continued_as);
        if(continued)return {duplicate:true,job:continued};
        analysis_reuse={source_job_id,document_id,studio_job_id:document.attempts.at(-1).job_id,config_id:source.config_id};
      }
      let contract=null;
      if(mode==='registered_request') {
        contract=record.contracts.find(c=>c.contract_id===contract_id&&isRegisteredContract(c,session));
        if(!contract)throw Error('같은 세션에서 등록 완료된 계약을 선택해 주세요.');
      }
      const old=record.jobs.find(j=>j.intake_mode===mode&&j.document_id===document_id&&(mode==='contract_registration'||j.contract_id===contract_id));
      if(old){if(source_job_id)record.jobs.find(j=>j.id===source_job_id).document_routing.continued_as=old.id;return {duplicate:true,job:old};}
      const folder=join(this.root,document_id);await mkdir(folder,{recursive:true,mode:0o700});
      await durableFile(folder,'source.pdf',bytes);await durableFile(folder,'meta.json',JSON.stringify({session,filename,pages:file.pages}));
      const kind=mode==='contract_registration'?'contract':'request';
      const document={filename,pages:file.pages,document_id};
      const job={id:'REQ-'+randomUUID(),session_id:session,intake_mode:mode,kind,contract_id:kind==='contract'?'CON-'+randomUUID():contract_id,document_id,filename,documents:[document],filenames:[filename],files:[{name:filename,document_id}],...(contract?{contract_snapshot:structuredClone(contract)}:{}),created_at:received_at,updated_at:received_at,stage:'received',processing_status:'received',evaluation_status:'pending',review_status:'pending',final_grade:null,attempts:[],timeline:[{stage:'received',at:received_at}],delivery:{},agent_id:AGENT_ID,config_id:this.configId,configuration_mode:this.configId?'pinned':this.allowLatest?'latest':'unconfirmed',mirror:{status:'not_ready'},late_result:null,execution_owner:'n8n',submission:{status:'pending'},...(analysis_reuse?{analysis_reuse,continuation_source_id:source_job_id,config_id:analysis_reuse.config_id}:{})};
      if(source_job_id)record.jobs.find(j=>j.id===source_job_id).document_routing.continued_as=job.id;
      record.jobs.push(job);record.notifications.push(lifecycleReceiptNotice(job));return {duplicate:false,job};
    });
  }
  async importReference(session,state) {
    await this.store.update(session,r=>{
      for(const key of ['contracts','ledger'])for(const value of state[key]||[])if(value.session_id===session&&!r[key].some(c=>c.contract_id===value.contract_id))r[key].push(value);
    });
  }
  async change(session,id,fn) {return this.store.update(session,r=>{const j=r.jobs.find(j=>j.id===id);if(!j)throw Error('접수를 찾지 못했습니다.');const result=fn(j,r);j.updated_at=iso(this.clock());return result;});}
  stage(job,value) {job.stage=value;job.processing_status=terminal.has(value)?value:'analyzing';job.timeline.push({stage:value,at:iso(this.clock())});}
  async tick() {
    if(this.ticking)return;this.ticking=true;
    const failures=[];
    try {
      for(const session of await this.store.sessions()) {
        let record;
        try {record=await this.store.read(session);}
        catch {
          // Preserve unreadable journals. Never replace them with empty receipts.
          failures.push({scope:'session',session_id:session,code:'record_read_failed'});
          continue;
        }
        if(record.jobs.some(j=>!j||typeof j.id!=='string'||!/^[A-Za-z0-9_-]{1,190}$/.test(j.id))) {
          // Nested corruption makes this journal unsafe for later ID lookups too.
          failures.push({scope:'session',session_id:session,code:'job_record_invalid'});
          continue;
        }
        for(const j of record.jobs) {
          try {await this.store.lock('worker-'+j.id,()=>this.step(session,j.id),{tryOnly:true});}
          catch {
            // Other jobs still enforce their own prerequisites and delivery intent.
            // Do not expose arbitrary exception text (which may contain document data).
            failures.push({scope:'job',session_id:session,job_id:j.id,code:'job_step_failed'});
          }
        }
      }
      return {failures};
    } finally {this.ticking=false;}
  }
  async step(session,id) {
    let record=await this.store.read(session),job=record.jobs.find(j=>j.id===id);
    if(!job)return;
    if(job.execution_owner==='n8n')return this.remoteStep(session,job);
    const elapsed=this.clock()-Date.parse(job.created_at);
    if(!terminal.has(job.stage)&&elapsed>=END_MS) {
      await this.change(session,id,j=>{this.stage(j,'ended');j.closed_at=iso(this.clock());j.error='최초 접수 후 12분이 지나 자동 확인을 종료했습니다. Studio 작업의 실패·취소를 의미하지 않습니다.';});
    } else if(!terminal.has(job.stage)&&elapsed>=DELAY_MS&&!job.delayed_at) {
      await this.change(session,id,j=>{j.delayed_at=iso(this.clock());j.processing_status='delayed';});
    }
    record=await this.store.read(session);job=record.jobs.find(j=>j.id===id);
    if(job.mirror.status==='sending') {
      await this.change(session,id,j=>{j.mirror={status:'unknown',error:'저장 응답을 확인하기 전에 작업자가 종료되었습니다.'};});return;
    }
    if(job.mirror.status==='unknown'&&this.provider.snapshot) {
      try {
        const saved=await this.provider.snapshot(session);
        const present=job.kind==='contract'?saved.contracts?.some(c=>c.contract_id===job.contract_id)&&saved.ledger?.some(c=>c.contract_id===job.contract_id):saved.requests?.some(q=>q.request_id===job.id);
        if(present)await this.change(session,id,j=>{j.mirror={status:'saved',at:iso(this.clock()),reconciled:true};});
      } catch { /* Keep an unknown write unknown; never replay it on absence alone. */ }
      return;
    }
    if(job.result&&job.mirror.status==='pending')return this.mirror(session,job);
    if(job.stage==='completed'||job.stage==='failed')return;
    const attempt=job.attempts.at(-1);
    if(job.stage==='ended'&&attempt?.next_poll_at&&this.clock()<Date.parse(attempt.next_poll_at))return;
    if(attempt?.phase==='creating') {
      // Re-entering here means the previous worker died after its durable
      // creation intent. It is never evidence that Studio did not create a job.
      await this.change(session,id,j=>{j.attempts.at(-1).phase='creation_unknown';j.error='작업 생성 응답을 확인하지 못했습니다. 중복 분석을 막기 위해 자동 재생성하지 않습니다.';});return;
    }
    if(attempt?.phase==='creation_unknown'||job.upload_status==='unknown')return;
    if(attempt?.job_id&&['polling','fetch_all'].includes(attempt.phase))return this.poll(session,job,attempt);
    if(job.stage==='ended')return;
    if(!job.file_id) {
      if(elapsed>=DELAY_MS)return;
      if(job.upload_status==='uploading') {await this.change(session,id,j=>{j.upload_status='unknown';j.error='파일 업로드 응답 확인이 필요합니다.';});return;}
      await this.change(session,id,j=>{j.upload_status='uploading';this.stage(j,'analyzing');});
      try {
        const response=await this.provider.upload(await readFile(join(this.root,job.document_id,'source.pdf')));
        if(typeof response.id!=='string'||!/^file[-_][A-Za-z0-9_-]+$/.test(response.id))throw Error('Studio file_id를 확인하지 못했습니다.');
        await this.change(session,id,j=>{j.file_id=response.id;j.upload_status='uploaded';});
      } catch(e) {await this.change(session,id,j=>{j.upload_status=e.definitive?'rejected':'unknown';j.error=errorText(e);if(e.definitive)this.stage(j,'failed');});}
      return;
    }
    if(elapsed>=DELAY_MS)return;
    if(!this.configId&&!this.allowLatest) {
      await this.change(session,id,j=>{j.error='현재 Studio 설정 버전 확인이 필요합니다. DEMO_STUDIO_CONFIG_ID를 설정해 주세요.';j.configuration_required=true;});return;
    }
    if(attempt?.phase==='failed'&&(!attempt.transient||job.attempts.length>=2))return;
    if(job.attempts.length>=2)return;
    const created=iso(this.clock());
    await this.change(session,id,j=>{j.error=null;j.attempts.push({number:j.attempts.length+1,phase:'creating',requested_at:created,config_id:this.configId});});
    try {
      const response=await this.provider.create({file_id:job.file_id,config_id:this.configId,agent_id:AGENT_ID});
      if(typeof response.id!=='string'||!/^job_[A-Za-z0-9_-]+$/.test(response.id))throw Error('Studio job_id를 확인하지 못했습니다.');
      await this.change(session,id,j=>{const a=j.attempts.at(-1);a.job_id=response.id;a.phase='polling';a.status=response.status;j.studio_job_id=response.id;});
    } catch(e) {await this.change(session,id,j=>{j.attempts.at(-1).phase=e.definitive?'creation_rejected':'creation_unknown';j.error=errorText(e);if(e.definitive)this.stage(j,'failed');});}
  }
  async remoteStep(session,job) {
    // The local process owns delivery and display, never Studio orchestration.
    const age=this.clock()-Date.parse(job.created_at);
    if(!terminal.has(job.stage)&&age>=END_MS)await this.change(session,job.id,(j,r)=>{this.stage(j,'ended');j.closed_at=iso(this.clock());j.error='최초 접수 후 12분이 지나 자동 확인을 종료했습니다. Studio 작업의 실패·취소를 의미하지 않습니다.';addStaffFailure(r,j,iso(this.clock()));});
    else if(!terminal.has(job.stage)&&age>=DELAY_MS&&!job.delayed_at)await this.change(session,job.id,j=>{j.delayed_at=iso(this.clock());j.processing_status='delayed';});
    if(['completed','failed'].includes(job.stage)&&job.remote_synced)return;
    if(job.submission.status==='pending') {
      if(age>=DELAY_MS)return;
      // Save send intent before I/O. A lost ACK or process restart only queries.
      await this.change(session,job.id,j=>{j.submission={status:'sending',at:iso(this.clock())};});
      try {
        const r=isLifecycleJob(job)
          ?await this.provider.submitLifecycle(job,{...job.documents[0],bytes:await readFile(join(this.root,job.document_id,'source.pdf'))})
          :paired(job)
          ?await this.provider.submitPair(job,await Promise.all(job.documents.map(async document=>({...document,bytes:await readFile(join(this.root,document.document_id,'source.pdf'))}))))
          :await this.provider.submit(job,await readFile(join(this.root,job.document_id,'source.pdf')));
        if(r.job_id!==job.id||!r.job)throw Error('n8n 접수 식별자를 확인하지 못했습니다.');
        await this.change(session,job.id,j=>{j.submission={status:'accepted',at:iso(this.clock())};});
        await this.importRemote(session,job.id,r.job);
      } catch(e) {await this.change(session,job.id,(j,r)=>{j.submission={status:e.definitive?'rejected':'unknown',error:errorText(e)};j.error=errorText(e);if(e.definitive){this.stage(j,'failed');addStaffFailure(r,j,iso(this.clock()));}});}
      return;
    }
    if(job.submission.status==='rejected')return;
    if(job.submission.status==='sending')await this.change(session,job.id,j=>{j.submission.status='unknown';});
    try {
      const r=isFeedbackJob(job)?await this.provider.statusPair(session,job.id):await this.provider.status(session,job.id);
      if(r.found&&r.job)await this.importRemote(session,job.id,r.job);
      else await this.change(session,job.id,j=>{j.query_error='n8n 접수 기록을 확인하지 못했습니다. 자동 재접수하지 않습니다.';});
    } catch(e){await this.change(session,job.id,j=>{j.query_error=errorText(e);});}
  }
  async importRemote(session,id,remote) {
    if(remote.id!==id||remote.session_id!==session)throw Error('다른 접수·세션의 결과입니다.');
    await this.change(session,id,(j,r)=>{
      if(remote.document_id!==j.document_id||remote.kind!==j.kind||remote.contract_id!==j.contract_id||remote.created_at!==j.created_at)throw Error('원래 접수 정보와 n8n 결과가 다릅니다.');
      if(isFeedbackJob(j)) {
        if(remote.intake_mode!==j.intake_mode||!Array.isArray(remote.documents)||remote.documents.length!==(paired(j)?2:1)||new Set(remote.documents.map(d=>d.document_id)).size!==(paired(j)?2:1)||remote.documents.some(d=>!j.documents.some(local=>local.document_id===d.document_id&&local.filename===d.filename&&local.pages===d.pages)))throw Error('원래 접수 문서와 n8n 결과가 다릅니다.');
        j.documents=remote.documents;j.files=Array.isArray(remote.files)?remote.files:j.files;
        if(j.intake_mode==='registered_request'&&JSON.stringify(remote.contract_snapshot)!==JSON.stringify(j.contract_snapshot))throw Error('등록 계약의 기준 정보가 변경되었습니다.');
        if(j.kind==='contract'&&remote.stage==='completed'&&(!isRegisteredContract(remote.result?.contract,session)||remote.result.contract.contract_id!==j.contract_id||remote.result.contract.source_document_id!==j.document_id))throw Error('완료된 계약 등록 결과를 확인하지 못했습니다.');
        if(j.kind==='request'&&remote.stage==='completed'&&remote.result&&(!['contract-request-six-grade-v1','contract-request-expanded-grade-v2'].includes(remote.result.policy_version)||!['completed','incomplete'].includes(remote.result.evaluation_status)||!Array.isArray(remote.result.checks)))throw Error('새 문서 대조 정책으로 확인한 결과가 아닙니다.');
      }
      j.submission={status:'accepted',at:j.submission.at||iso(this.clock())};j.query_error=null;
      for(const key of ['phase','attempts','file_id','upload_status','studio_job_id','extract_stage','studio_stages','additional_values','context','mirror','configuration_required','config_id','validation','supplement_request','resolution_status','last_failure','audit_logs','document_routing'])if(remote[key]!==undefined){if(key==='document_routing'&&j.document_routing?.continued_as)j[key]={...remote[key],continued_as:j.document_routing.continued_as};else j[key]=remote[key];}
      j.remote_updated_at=remote.updated_at;j.remote_execution_owner='n8n';
      if(remote.delayed_at)j.delayed_at=remote.delayed_at;
      const localEnded=j.stage==='ended';
      if(remote.late_result) {
        j.late_result=remote.late_result;
        if(j.kind==='request'&&this.lateWarnings&&needsWarning(j,remote.late_result.result))addNotice(r,j,'late_warning',iso(this.clock()),warningMessage(j,remote.late_result.result));
      }
      if(remote.result&&remote.stage==='completed') {
        // n8n's completion is authoritative after a local UI process restart.
        j.result=remote.result;j.extracted=remote.extracted;j.error=remote.error||null;if(isLifecycleJob(j))j.evaluation_status=remote.result.evaluation_status;
        if(j.kind==='contract') {
          for(const key of ['contracts','ledger']) {const value=remote.result[key==='contracts'?'contract':'ledger'];if(value&&!r[key].some(c=>c.contract_id===value.contract_id))r[key].push(value);}
        } else {
          j.evaluation_status=remote.result.evaluation_status;j.final_grade=remote.result.final_grade;
          if(needsWarning(j,remote.result))addNotice(r,j,'warning',iso(this.clock()),warningMessage(j,remote.result));
        }
        if(j.stage!=='completed')this.stage(j,'completed');j.remote_synced=remote.mirror?.status==='saved';
      } else if(['failed','ended'].includes(remote.stage)) {if(j.stage!==remote.stage)this.stage(j,remote.stage);j.error=remote.error||null;j.evaluation_status=remote.evaluation_status||'incomplete';j.final_grade=null;if(remote.closed_at)j.closed_at=remote.closed_at;j.remote_synced=remote.stage==='failed';addStaffFailure(r,j,iso(this.clock()));}
      else if(!localEnded) {if(j.stage!==remote.stage)this.stage(j,remote.stage);j.error=remote.error||null;j.processing_status=remote.processing_status;}
    });
  }
  async poll(session,job,attempt) {
    try {
      const response=await this.provider.retrieve(attempt.job_id,attempt.phase==='fetch_all'?'all':'last');
      if(!['queued','in_progress','completed','failed'].includes(response.status))throw Error('Studio 작업 상태를 확인하지 못했습니다.');
      if(response.status==='queued'||response.status==='in_progress') {
        await this.change(session,job.id,j=>{j.attempts.at(-1).status=response.status;j.attempts.at(-1).next_poll_at=iso(this.clock()+(j.stage==='ended'?30000:0));j.last_checked_at=iso(this.clock());j.query_error=null;});return;
      }
      if(response.status==='failed') {
        await this.change(session,job.id,j=>{
          const a=j.attempts.at(-1);a.phase='failed';a.status='failed';a.failure=response.error||null;a.transient=confirmedTransientFailure(response);
          const mayRetry=a.transient&&j.attempts.length<2&&this.clock()-Date.parse(j.created_at)<DELAY_MS&&j.stage!=='ended';
          if(!mayRetry&&j.stage!=='ended')this.stage(j,'failed');
          j.error='Studio가 분석 실패를 반환했습니다: '+(response.error?.code||'원인 미확인');
        });return;
      }
      if(attempt.phase!=='fetch_all') {await this.change(session,job.id,j=>{j.attempts.at(-1).phase='fetch_all';});return;}
      const result=extractResult(response);
      await this.change(session,job.id,(j,r)=>{
        const a=j.attempts.at(-1);a.phase='completed';a.status='completed';a.completed_at=iso(this.clock());
        j.studio_stages=result.stages;j.extract_stage=result.stage_name;j.additional_values=result.additional_values;
        if(result.kind!==j.kind)throw Error('선택한 접수 종류와 Studio 분류 결과가 다릅니다. 추출값을 변경하지 않고 확인이 필요합니다.');
        const context={session_id:session,contract_id:j.contract_id,request_id:j.id,document_id:j.document_id,filename:j.filename,studio_job_id:a.job_id,initial_balance_krw:j.initial_balance,balance_as_of:j.created_at.slice(0,10),received_at:j.created_at,evidence:result.additional_values};
        let evaluation;
        if(j.kind==='contract')evaluation=rules().register(result.extracted,context);
        else evaluation=rules().verify(result.extracted,r.contracts.find(c=>c.contract_id===j.contract_id),r.ledger.find(c=>c.contract_id===j.contract_id),context);
        const late=j.stage==='ended'||this.clock()-Date.parse(j.created_at)>=END_MS;
        if(late) {
          if(j.stage!=='ended'){this.stage(j,'ended');j.closed_at=iso(this.clock());}
          j.late_result={received_at:iso(this.clock()),extracted:result.extracted,result:evaluation};
          if(j.kind==='request'&&evaluation.warning_required&&this.lateWarnings)addNotice(r,j,'late_warning',iso(this.clock()),evaluation.customer.message);
          return;
        }
        j.extracted=result.extracted;j.result=evaluation;j.context=context;j.error=null;
        if(j.kind==='contract') {r.contracts.push(evaluation.contract);r.ledger.push(evaluation.ledger);}
        else {
          j.evaluation_status=evaluation.evaluation_status;j.final_grade=evaluation.final_grade;
          if(evaluation.warning_required)addNotice(r,j,'warning',iso(this.clock()),evaluation.customer.message);
        }
        this.stage(j,'completed');j.mirror={status:'pending'};
      });
    } catch(e) {
      await this.change(session,job.id,j=>{
        j.query_error=errorText(e);
        // Only a malformed completed payload is final; GET/transport failures
        // keep checking the same job and never consume a reanalysis.
        if(attempt.phase==='fetch_all'&&!(e.transport||e.http_status)) {
          j.attempts.at(-1).phase='result_invalid';j.error=errorText(e);if(j.stage!=='ended')this.stage(j,'failed');
        }
      });
    }
  }
  async mirror(session,job) {
    if(!this.provider.persist)return;
    await this.change(session,job.id,j=>{j.mirror={status:'sending',at:iso(this.clock())};});
    try {
      await this.store.lock('data-tables-writer',()=>this.provider.persist(job));
      await this.change(session,job.id,j=>{j.mirror={status:'saved',at:iso(this.clock())};});
    } catch(e) {await this.change(session,job.id,j=>{j.mirror={status:e.definitive?'pending':'unknown',error:errorText(e)};});}
  }
  async acknowledge(session,{notification_id,role}) {
    if(!['customer','banker','reviewer','admin'].includes(role))throw Error('알림 표시 역할을 확인해 주세요.');
    return this.store.update(session,r=>{
      const n=r.notifications.find(n=>n.id===notification_id);if(!n||(role==='customer'&&n.audience&&n.audience!=='customer'))throw Error('이 세션의 알림을 찾지 못했습니다.');
      n.displayed_at[role] ||= iso(this.clock());
      return {id:n.id,displayed_at:n.displayed_at[role]};
    });
  }
  async review(session,id,input) {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['confirmed','memo'].includes(k))||typeof input.confirmed!=='boolean'||typeof input.memo!=='string'||input.memo.length>2000)throw Error('검토에는 확인 여부와 2,000자 이내 메모만 저장할 수 있습니다.');
    return this.change(session,id,(j,r)=>{
      const review={id:randomUUID(),job_id:id,confirmed:input.confirmed,memo:input.memo,recorded_at:iso(this.clock())};
      r.reviews.push(review);j.review_status=input.confirmed?'confirmed':'pending';return review;
    });
  }
  async linkContract(session,id,contractId) {
    return this.change(session,id,(j,r)=>{
      if(j.result||j.late_result||terminal.has(j.stage))throw Error('대조 또는 종료 후에는 계약 연결을 변경할 수 없습니다.');
      if(j.execution_owner==='n8n'&&j.submission.status!=='pending')throw Error('n8n 접수 이후에는 기준 계약을 변경할 수 없습니다.');
      if(!r.contracts.some(c=>c.contract_id===contractId&&c.session_id===session))throw Error('같은 시연 세션의 계약만 연결할 수 있습니다.');
      j.contract_id=contractId;return {contract_id:contractId};
    });
  }
  async state(session,role) {
    const r=await this.store.read(session);
    const maskedResult=result=>result?{request_id:result.request_id,title:result.title,message:result.message,masked_account:result.masked_account,warning_required:result.warning_required,evaluation_status:result.evaluation_status,issue_labels:result.issue_labels}:null;
    if(role==='customer')return {jobs:currentDocumentJobs(r.jobs).filter(j=>j.kind==='request'||isLifecycleJob(j)).flatMap(j=>isLifecycleJob(j)?[lifecycleCustomerActivity(j)]:paired(j)?pairedCustomerActivities(j):[{id:j.id,contract_id:j.contract_id,kind:j.kind,created_at:j.created_at,stage:j.stage,processing_status:j.processing_status,evaluation_status:j.evaluation_status,delayed_at:j.delayed_at||null,result:maskedResult(j.result?.customer),late_result:j.late_result?{received_at:j.late_result.received_at,result:maskedResult(j.late_result.result.customer)}:null}]),notifications:r.notifications.filter(n=>!n.audience||n.audience==='customer').map(({displayed_at,...n})=>({...n,displayed_at:displayed_at?.customer||null})),connection:'live'};
    return {...r,requests:r.jobs.filter(j=>j.kind==='request'&&j.result).map(j=>({...j.result,review_status:j.review_status})),connection:'live'};
  }
}
