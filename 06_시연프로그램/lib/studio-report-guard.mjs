// Confirmed web receipts provide a lower bound, not a collection-wide census.
export function minimumReportRequests(jobs, date) {
  const start = Date.parse(date + 'T00:00:00+09:00');
  return new Set(jobs.filter(job => job.kind === 'request' && !job.document_routing_required
    && job.processing_status === 'completed' && job.collection_status === 'stored'
    && typeof job.document_request_id === 'string' && job.document_request_id.trim()
    && Date.parse(job.received_at) >= start && Date.parse(job.received_at) < start + 86400000)
    .map(job => job.document_request_id)).size;
}

export function validateReportCount(answer, minimum) {
  if (!minimum) return;
  const processing = answer.split('[처리 현황]')[1]?.split(/\n\[/)[0] || '';
  const match = processing.match(/전체(?:\s*요청)?\s*([\d,]+)\s*건/);
  if (!match || Number(match[1].replaceAll(',', '')) < minimum) throw Error('studio_report_count_conflict');
}
