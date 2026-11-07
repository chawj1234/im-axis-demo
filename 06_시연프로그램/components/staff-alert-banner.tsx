'use client';

import {AlertTriangle, ArrowRight} from 'lucide-react';
import './staff-alert-banner.css';

export interface StaffAlert {
  id: string;
  job_id: string;
  created_at: string;
  document_name?: string;
  message?: string;
  retry_count?: number;
  supplement_required?: boolean;
  can_retry?: boolean;
  studio_review?: {url: string; job_ids: string[]; notice?: string};
}

export default function StaffAlertBanner({alerts, onOpen}: {
  alerts: StaffAlert[];
  onOpen?: (jobId: string) => void;
}) {
  if (!alerts.length) return null;
  return <section className="staff-alert staff-alert-summary" aria-label="담당자 확인 알림">
    <AlertTriangle size={18} aria-hidden="true"/><strong>문서 확인 필요 {alerts.length}건</strong>
    {alerts.length === 1 ? <button type="button" className="staff-alert-open" onClick={() => onOpen?.(alerts[0].job_id)}><span>{alerts[0].document_name || '접수 문서'}</span><span>{alerts[0].supplement_required ? '필수정보 확인' : '처리 이력 확인'}</span><ArrowRight size={16} aria-hidden="true"/></button> : <details className="staff-alert-list"><summary>목록 보기</summary><ul>{alerts.map((alert, index) => <li key={alert.id}><button type="button" onClick={() => onOpen?.(alert.job_id)}>{alert.document_name || `문서 ${index + 1}`} · {alert.supplement_required ? '필수정보 확인' : '처리 이력 확인'}<ArrowRight size={15} aria-hidden="true"/></button></li>)}</ul></details>}
  </section>;
}
