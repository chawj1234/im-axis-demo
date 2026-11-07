// Navigation only. Reviewed-value retrieval and result mutation are not implied.
export function studioReviewForJob(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const job=value;
  if(job.validation?.verdict!=='red'&&job.error!=='studio_validation_red')return undefined;
  if(typeof job.agent_id!=='string'||!/^agt_[A-Za-z0-9]+$/.test(job.agent_id))return undefined;
  const attempts=[...(Array.isArray(job.attempts)?job.attempts:[]),
    ...(Array.isArray(job.documents)?job.documents:[]).flatMap(d=>Array.isArray(d?.attempts)?d.attempts:[])];
  const ids=[...new Set(attempts.map(a=>a?.job_id).filter(id=>typeof id==='string'&&/^job_[A-Za-z0-9_-]{1,120}$/.test(id)))];
  if(!ids.length)return undefined;
  // The former agent now returns 404. Navigation to its replacement is not
  // evidence that historical jobs were migrated or that runtime uses it.
  if(job.agent_id==='agt_nRqvtkgk55jzFJhJrfXoXe')return {
    url:'https://studio.upstage.ai/agents/agt_NwAUNFvvZTG8RhWam5A9Mh?configVer=5',
    job_ids:ids,
    notice:'현재 요청용 설정을 엽니다. 아래 작업 ID는 이전 워크플로우의 실행 기록이며 이 설정으로 이전된 것은 아닙니다.',
  };
  const url=new URL('https://studio.upstage.ai/agents/'+job.agent_id);
  const config=String(job.config_id??'');
  if(/^[1-9]\d{0,8}$/.test(config))url.searchParams.set('configVer',config);
  return {url:url.href,job_ids:ids};
}
