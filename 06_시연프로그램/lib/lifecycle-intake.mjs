import {validSession} from './record-store.mjs';
import {MAX_PDF_BYTES} from './paired-intake.mjs';

export const MAX_SINGLE_BODY_BYTES = MAX_PDF_BYTES + 1024 * 1024;

/** A contract is registered once; later requests contain only their own PDF. */
export async function validateLifecycleIntake(form, session, kind, inspectPages) {
  if (!['contract', 'request'].includes(kind)) throw Error('접수 종류를 확인해 주세요.');
  if (!validSession(session) || form.getAll('session_id').length !== 1 || form.get('session_id') !== session) throw Error('접수 세션이 일치하지 않습니다.');
  const allowed = new Set(['session_id', 'file', ...(kind === 'request' ? ['contract_id'] : [])]);
  for (const key of form.keys()) if (!allowed.has(key)) throw Error('접수에 필요한 문서와 정보만 입력해 주세요.');
  let contract_id;
  if (kind === 'request') {
    contract_id = form.get('contract_id');
    if (form.getAll('contract_id').length !== 1 || typeof contract_id !== 'string' || !/^CON-[A-Za-z0-9-]{1,80}$/.test(contract_id)) throw Error('등록된 계약을 선택해 주세요.');
  }
  const files = form.getAll('file');
  if (files.length !== 1 || !(files[0] instanceof File)) throw Error('PDF 문서 한 개를 선택해 주세요.');
  const selected = files[0];
  if (!/\.pdf$/i.test(selected.name) || selected.size < 5 || selected.size > MAX_PDF_BYTES) throw Error('파일은 25MB 이하 PDF여야 합니다.');
  const bytes = Buffer.from(await selected.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('유효한 PDF를 올려 주세요.');
  const pages = await inspectPages(bytes);
  if (!Number.isInteger(pages) || pages < 1 || pages > 20) throw Error('이번 데모는 20페이지 이하 PDF를 지원합니다.');
  const filename = selected.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 180);
  return {file: {bytes, filename, pages}, ...(contract_id ? {contract_id} : {})};
}
