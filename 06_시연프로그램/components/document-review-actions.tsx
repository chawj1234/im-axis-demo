'use client';

import {useRef, useState} from 'react';
import {ExternalLink, RotateCw} from 'lucide-react';
import type {StaffAlert} from './staff-alert-banner';
import './document-review-actions.css';

function studioUrl(value?: string): string | undefined {
  try {
    const url = new URL(value || '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {return undefined;}
}

export function DocumentRetryAction({alert, onRetry, busy = false, errorMessage = ''}: {alert: StaffAlert; onRetry?: (jobId: string) => Promise<void>; busy?: boolean; errorMessage?: string}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const url = studioUrl(alert.studio_review?.url);
  const ids = [...new Set((alert.studio_review?.job_ids || []).filter(id => /^job_[A-Za-z0-9_-]+$/.test(id)))];
  const retry = async () => {
    if (!onRetry || lock.current || busy) return;
    lock.current = true; setPending(true); setError('');
    try {await onRetry(alert.job_id);}
    catch (cause) {setError(cause instanceof Error ? cause.message : '원문 재분석 요청을 확인하지 못했습니다.');}
    finally {lock.current = false; setPending(false);}
  };
  if (!url && !onRetry) return null;
  return <section className="document-retry" aria-label="추출 결과 검토 및 재분석">
    <div className="document-review-actions">
      {url && <a href={url} target="_blank" rel="noopener noreferrer">Studio에서 확인<ExternalLink size={14} aria-hidden="true" /></a>}
      {onRetry && <button type="button" onClick={() => void retry()} disabled={pending || busy} aria-busy={pending || busy} title="저장된 같은 PDF를 다시 분석합니다. Studio에서 교정한 추출값을 가져오는 기능은 아닙니다."><RotateCw size={16} aria-hidden="true" />{pending || busy ? '요청 중…' : '다시 분석'}</button>}
    </div>
    {url && (ids.length > 0 || alert.studio_review?.notice) && <details className="document-review-ids"><summary>작업 ID</summary><p>Studio에서 API를 선택하세요.</p>{alert.studio_review?.notice && <p>{alert.studio_review.notice}</p>}{ids.map(id => <code key={id} tabIndex={0}>{id}</code>)}</details>}
    {(errorMessage || error) && <p className="document-retry-error" role="alert">{errorMessage || error}</p>}
  </section>;
}
