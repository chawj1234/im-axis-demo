'use client';

import {useState} from 'react';

export interface ReviewRecord {
  id: string;
  job_id: string;
  confirmed: boolean;
  memo: string;
  recorded_at: string;
}

// The parent remounts this editor for a different receipt. Polling does not
// discard an unsaved draft; the saved history remains separately visible.
export default function LiveReview({records, save}: {
  records: ReviewRecord[];
  save: (input: {confirmed: boolean; memo: string}) => Promise<ReviewRecord>;
}) {
  const latest = records.at(-1);
  const [confirmed, setConfirmed] = useState(latest?.confirmed || false);
  const [memo, setMemo] = useState(latest?.memo || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      await save({confirmed, memo});
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '검토 기록을 저장하지 못했습니다.');
    } finally { setSaving(false); }
  }
  return <form className="ld-card" onSubmit={submit}>
    <h2>검토 기록</h2>
    <label className="ld-checkbox"><input type="checkbox" checked={confirmed} disabled={saving}
      onChange={e => {setConfirmed(e.target.checked); setSaved(false);}}/>확인 여부</label>
    <label htmlFor="review-memo">검토 메모</label>
    <textarea id="review-memo" maxLength={2000} value={memo} disabled={saving} rows={4}
      onChange={e => {setMemo(e.target.value); setSaved(false);}}/>
    <p className="ld-muted">확인 여부와 메모만 기록합니다. 추출값·등급·경고는 유지됩니다.</p>
    <button disabled={saving} className="ld-primary">{saving ? '저장 중' : '확인·메모 저장'}</button>
    {saved && <p role="status">검토 기록을 저장했습니다.</p>}
    {error && <p role="alert" className="ld-warning">{error}</p>}
    {records.map(record => <div className="ld-review" key={record.id}>
      <small>{new Date(record.recorded_at).toLocaleString('ko-KR')} · {record.confirmed ? '확인' : '확인 전'}</small>
      <p>{record.memo || '(메모 없음)'}</p>
    </div>)}
  </form>;
}
