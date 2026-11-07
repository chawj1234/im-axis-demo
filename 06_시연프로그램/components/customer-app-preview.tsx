'use client';

import {useCallback, useRef, useState} from 'react';
import CustomerApp from './customer-app';
import {customerAppActivities, customerAppNotices} from '../lib/customer-app-model';
import './customer-app-preview.css';

interface PreviewNotice {
  id: string;
  contract_id?: string;
  job_id?: string;
  kind: 'receipt' | 'warning';
  document_kind: 'contract' | 'request';
  created_at: string;
  displayed_at: string | null;
  message: string;
}

interface PreviewJob {
  id: string;
  contract_id?: string;
  kind: 'contract' | 'request';
  created_at: string;
  stage: 'received' | 'completed';
  result?: {warning_required: boolean; masked_account?: string};
}

/** Isolated screen preview. These buttons do not submit files or call the workflow. */
export default function CustomerAppPreview() {
  const [notices, setNotices] = useState<PreviewNotice[]>([]);
  const [jobs, setJobs] = useState<PreviewJob[]>([]);
  const sequence = useRef(0);
  const acknowledge = useCallback((id: string) => {
    if (document.visibilityState !== 'visible') return;
    setNotices(current => current.map(notice => notice.id === id && !notice.displayed_at
      ? {...notice, displayed_at: new Date().toISOString()} : notice));
  }, []);

  function send(kind: 'contract' | 'request' | 'warning') {
    const at = new Date().toISOString();
    const documentKind = kind === 'contract' ? 'contract' : 'request';
    const id = 'preview-' + ++sequence.current;
    setNotices(current => [...current, {
      id, job_id: 'preview-job-' + documentKind, kind: kind === 'warning' ? 'warning' : 'receipt', document_kind: documentKind,
      created_at: at, displayed_at: null,
      message: kind === 'contract' ? '고객님의 대출 계약서가 접수되었습니다.'
        : kind === 'request' ? '고객님의 대출 실행 요청서가 접수되었습니다.'
        : '실행 요청서의 수취계좌가 계약서에 기재된 계좌와 다릅니다. 담당자에게 요청 내용을 확인해 주세요.',
    }]);
    setJobs(current => {
      const existing = current.find(job => job.kind === documentKind);
      const next: PreviewJob = {
        id: existing?.id || 'preview-job-' + documentKind, contract_id: 'CON-PREVIEW-00001234', kind: documentKind,
        created_at: existing?.created_at || at, stage: kind === 'warning' ? 'completed' : 'received',
        ...(kind === 'warning' ? {result: {warning_required: true, masked_account: '•••• 1234'}} : {}),
      };
      return [...current.filter(job => job.kind !== documentKind), next];
    });
  }

  return <div className="customer-preview">
    <aside className="customer-preview-tools" aria-label="고객 화면 미리보기">
      <strong>고객 화면 미리보기</strong>
      <p>예시 알림으로 화면을 확인합니다. 실제 문서 접수는 진행하지 않습니다.</p>
      <div>
        <button type="button" onClick={() => send('contract')}>계약서 접수 알림</button>
        <button type="button" onClick={() => send('request')}>요청서 접수 알림</button>
        <button type="button" onClick={() => send('warning')}>불일치 확인 알림</button>
      </div>
    </aside>
    <CustomerApp notices={customerAppNotices(notices)} activities={customerAppActivities(jobs)}
      connected onNoticeVisible={acknowledge} preview/>
  </div>;
}
