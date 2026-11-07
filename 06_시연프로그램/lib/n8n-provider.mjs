export class BridgeError extends Error {
  constructor(message,details={}) {super(message);Object.assign(this,details);}
}
export function createN8nProvider(base='http://127.0.0.1:5678/webhook',{prefix='im-demo-',pairPrefix='im-paired-',reportPath='imbank-report-generate',writeBase=base}={}) {
  async function call(path,form,routePrefix=prefix) {
    let response,body;
    try {
      response=await fetch((form?writeBase:base)+'/'+routePrefix+path,{...(form?{method:'POST',body:form}:{}),signal:AbortSignal.timeout(40000)});
      body=await response.json();
    } catch {throw new BridgeError('n8n 응답을 확인하지 못했습니다. 조회로 기존 접수를 확인합니다.',{transport:true});}
    if(!response.ok||body?.ok!==true)throw new BridgeError(typeof body?.error==='string'?body.error:'n8n 처리 응답 확인 필요',{transport:response.status>=500,definitive:response.status>=400&&response.status<500,http_status:response.status});
    return body;
  }
  return {
    executionOwner:'n8n',
    async submit(job,bytes) {
      const form=new FormData();
      form.set('file',new File([new Uint8Array(bytes)],job.filename,{type:'application/pdf'}));
      const keys=['id','session_id','document_id','kind','contract_id','filename','initial_balance','created_at','config_id'];
      form.set('metadata',JSON.stringify({...Object.fromEntries(keys.map(k=>[k,job[k]])),allow_latest:job.configuration_mode==='latest'}));
      return call('submit',form);
    },
    async status(session,id) {return call('jobs?session_id='+encodeURIComponent(session)+'&job_id='+encodeURIComponent(id));},
    async snapshot(session) {return call('jobs?session_id='+encodeURIComponent(session));},
    async submitPair(job,documents) {
      if(!Array.isArray(documents)||documents.length!==2)throw new BridgeError('접수한 PDF 문서 2개가 필요합니다.',{definitive:true});
      const form=new FormData();
      documents.forEach((document,index)=>form.set('file'+index,new File([new Uint8Array(document.bytes)],document.filename,{type:'application/pdf'})));
      const keys=['id','session_id','intake_mode','document_id','documents','filenames','files','kind','contract_id','created_at','config_id'];
      form.set('metadata',JSON.stringify({...Object.fromEntries(keys.map(k=>[k,job[k]])),allow_latest:job.configuration_mode==='latest'}));
      return call('submit',form,pairPrefix);
    },
    async submitLifecycle(job,document) {
      if(!['contract_registration','registered_request'].includes(job.intake_mode)||!document?.bytes)throw new BridgeError('접수 문서를 확인해 주세요.',{definitive:true});
      const form=new FormData();form.set('file0',new File([new Uint8Array(document.bytes)],document.filename,{type:'application/pdf'}));
      const keys=['id','session_id','intake_mode','document_id','documents','filenames','files','kind','contract_id','contract_snapshot','created_at','config_id','analysis_reuse','retry_source_id','retry_root_id'];
      form.set('metadata',JSON.stringify({...Object.fromEntries(keys.map(k=>[k,job[k]])),allow_latest:job.configuration_mode==='latest'}));
      return call('submit',form,pairPrefix);
    },
    async statusPair(session,id) {return call('jobs?session_id='+encodeURIComponent(session)+'&job_id='+encodeURIComponent(id),undefined,pairPrefix);},
    async generateReport(session) {const form=new FormData();form.set('session_id',session);return call(reportPath,form,'');},
    async reports(session) {return call('reports?session_id='+encodeURIComponent(session),undefined,pairPrefix);}
  };
}
