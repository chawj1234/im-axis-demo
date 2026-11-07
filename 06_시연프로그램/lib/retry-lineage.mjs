/** Current document attempts only; all source records remain in the journal. */
export function currentDocumentJobs(jobs) {
  if(!Array.isArray(jobs))return [];
  const rows=jobs.filter(job=>job&&typeof job==='object'&&!Array.isArray(job));
  // Avoid relying on object identity or Map/Set iterator traversal when this
  // function is serialized into n8n's wrapped expression sandbox.
  const unique=rows.filter(job=>rows.filter(other=>other.id===job.id).length===1);
  const candidates=[];
  for(const child of rows){
    const source=unique.find(job=>job.id===child.retry_source_id);
    if(!source||!unique.some(job=>job.id===child.id)||child.id===source.id)continue;
    if(!/^REQ-[A-Za-z0-9-]{1,80}$/.test(child.id||'')||!/^REQ-[A-Za-z0-9-]{1,80}$/.test(source.id||''))continue;
    if(!/^[A-Za-z0-9_-]{8,90}$/.test(source.session_id||'')||!/^[a-f0-9]{64}$/.test(source.document_id||'')||!/^CON-[A-Za-z0-9-]{1,80}$/.test(source.contract_id||''))continue;
    if(!['contract_registration','registered_request'].includes(source.intake_mode)||source.kind!==(source.intake_mode==='contract_registration'?'contract':'request'))continue;
    if(['session_id','document_id','kind','intake_mode','contract_id'].some(key=>child[key]!==source[key]))continue;
    if(source.stage!=='failed'||source.error!=='studio_validation_red'||source.validation?.verdict!=='red')continue;
    if(source.retry_job_id&&source.retry_job_id!==child.id)continue;
    candidates.push({source:source.id,child:child.id});
  }
  const next=candidates.filter(edge=>candidates.filter(other=>other.source===edge.source).length===1);
  const superseded=[];
  for(const edge of next){
    const seen=[];let id=edge.source;
    while(next.some(item=>item.source===id)&&!seen.includes(id)){seen.push(id);id=next.find(item=>item.source===id).child;}
    // Cycles (and paths entering them) are malformed; do not hide their records.
    if(!seen.includes(id))superseded.push(edge.source);
  }
  return rows.filter(job=>!superseded.includes(job.id));
}
