import {validSession} from './record-store.mjs';

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PAIR_BODY_BYTES = MAX_PDF_BYTES * 2 + 1024 * 1024;

/** Validate the complete pair before persisting any receipt or customer notice. */
export async function validatePairedIntake(form, session, inspectPages) {
  if (!validSession(session) || form.get('session_id') !== session) throw Error('접수 세션이 일치하지 않습니다.');
  const allowed = new Set(['files', 'session_id', 'receipt_id']);
  for (const key of form.keys()) if (!allowed.has(key)) throw Error('문서 두 개와 접수 정보만 입력할 수 있습니다.');
  if (form.getAll('session_id').length !== 1 || form.getAll('receipt_id').length > 1) throw Error('접수 정보를 확인해 주세요.');
  const receiptId = form.get('receipt_id');
  if (receiptId !== null && (typeof receiptId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(receiptId))) throw Error('접수 식별자를 확인해 주세요.');
  const selected = form.getAll('files');
  if (selected.length !== 2 || selected.some(file => !(file instanceof File))) throw Error('계약서와 실행 요청서, PDF 두 개를 선택해 주세요.');
  const files = [];
  for (const file of selected) {
    if (!/\.pdf$/i.test(file.name) || file.size < 5 || file.size > MAX_PDF_BYTES) throw Error('각 파일은 25MB 이하 PDF여야 합니다.');
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('유효한 PDF를 올려 주세요.');
    const filename = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 180);
    files.push({bytes, filename});
  }
  if (files[0].bytes.equals(files[1].bytes)) throw Error('서로 다른 두 PDF 문서를 선택해 주세요.');
  for (const file of files) {
    file.pages = await inspectPages(file.bytes);
    if (!Number.isInteger(file.pages) || file.pages < 1 || file.pages > 20) throw Error('이번 데모는 20페이지 이하 PDF를 지원합니다.');
  }
  return files;
}
