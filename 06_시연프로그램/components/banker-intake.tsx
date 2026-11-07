'use client';

import {useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent} from 'react';
import {ArrowDownToLine, ArrowRight, CheckCircle2, FileText, FolderOpen, Info, LoaderCircle, Search, X} from 'lucide-react';
import type {IntakeReceiptResult, OperationsContract, OperationsReceipt} from '../lib/operations-types';
import {formatDateTime, formatWon, formatReceiptId} from '../lib/operations-format';
import {Select as ContractSelect} from 'radix-ui';
import {groupReceipts} from '../lib/receipt-groups.mjs';
import './banker-intake.css';

export interface BankerIntakeProps {
  receipts: OperationsReceipt[];
  contracts: OperationsContract[];
  onRegisterContract: (file: File) => Promise<IntakeReceiptResult>;
  onSubmitRequest: (file: File, contractId: string) => Promise<IntakeReceiptResult>;
  onContinueDocument: (receiptId: string, contractId?: string) => Promise<IntakeReceiptResult>;
  canSubmit: boolean;
  preview?: boolean;
  requestMatching?: 'local' | 'studio';
  enabledKinds?: Record<'contract' | 'request', boolean>;
  recordsState?: 'loading' | 'error' | 'ready';
}
type IntakeMode = 'contract' | 'request';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function validateFile(file: File | null): string | null {
  if (!file) return '접수할 PDF 파일 1개를 선택해 주세요.';
  if (!/\.pdf$/i.test(file.name) || file.type && file.type !== 'application/pdf') return 'PDF로 저장한 문서를 선택해 주세요.';
  if (!file.size) return '선택한 파일이 비어 있습니다. 파일을 확인해 주세요.';
  if (file.size > MAX_FILE_BYTES) return '문서 용량이 25 MB를 넘습니다. 용량을 줄인 PDF를 선택해 주세요.';
  return null;
}

export default function BankerIntake({receipts, contracts, onRegisterContract, onSubmitRequest, onContinueDocument, canSubmit, recordsState = 'ready', requestMatching = 'local', enabledKinds}: BankerIntakeProps) {
  const studioMatching = requestMatching === 'studio';
  const registered = contracts.filter(contract => contract.status === 'registered');
  const [mode, setMode] = useState<IntakeMode>(() => studioMatching || registered.length ? 'request' : 'contract');
  const [files, setFiles] = useState<Record<IntakeMode, File | null>>({contract:null, request:null});
  const [contractId, setContractId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{mode:IntakeMode;receipt:IntakeReceiptResult} | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [routingOnly, setRoutingOnly] = useState(false);
  const [routingContracts,setRoutingContracts]=useState<Record<string,string>>({});
  const [routingBusy,setRoutingBusy]=useState<string|null>(null);
  const [routingError,setRoutingError]=useState<{id:string;message:string}|null>(null);
  const [routingResult,setRoutingResult]=useState<IntakeReceiptResult|null>(null);
  const routingLock=useRef(false);
  const continuedRowRef=useRef<HTMLTableRowElement>(null);
  const focusedContinuation=useRef('');
  const pendingRoutes=receipts.filter(receipt=>receipt.routing&&!receipt.routing.continuedAs);

  const pickerButtonRef = useRef<HTMLButtonElement>(null), restorePickerFocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null), submitLock = useRef(false), dragDepth = useRef(0);
  const id = useId(), helpId = `${id}-help`, errorId = `${id}-error`, connectionId = `${id}-connection`;
  const registering = mode === 'contract';
  const file = files[mode];
  const chosenContract = registered.find(contract => contract.id === contractId);
  const noContract = !studioMatching && !registering && !registered.length;
  const kindEnabled = enabledKinds?.[mode] !== false;
  const canSubmitKind = canSubmit && kindEnabled;
  const contractReceipts = receipts.filter(receipt => receipt.kind === 'contract' && !receipt.routing?.continuedAs);
  const contractPending = contractReceipts.some(receipt => receipt.status !== 'failed' && (!receipt.documentStatus || receipt.documentStatus === 'checking'));
  const contractAttention = contractReceipts.some(receipt => receipt.status === 'failed' || receipt.documentStatus === 'needs_attention' || receipt.documentStatus === 'completed' || receipt.documentStatus === 'routing');
  const contractGuidance = recordsState === 'loading' ? '계약 정보를 불러오는 중입니다.' : recordsState === 'error' ? '계약 정보를 확인하지 못했습니다.' : contractPending ? '계약 등록 처리 중입니다.' : contractAttention ? '계약 등록 상태를 확인해 주세요.' : '먼저 계약서를 접수해 주세요.';
  const ready = !!file && (registering || studioMatching || !!chosenContract);
  const groups: {latest:OperationsReceipt;items:OperationsReceipt[]}[] = useMemo(() => groupReceipts(receipts), [receipts]);
  const histories = new Map<string,OperationsReceipt[]>(groups.map(group=>[group.latest.id,group.items]));
  const matchingReceipts = groups.filter(group=>(!routingOnly || group.items.some(receipt=>receipt.routing&&!receipt.routing.continuedAs)) && (!search.trim() || group.items.some(receipt=>`${receipt.id} ${receipt.originalReceiptId||''} ${receipt.fileNames.join(' ')} ${receipt.contractReference||''} ${receipt.companyName||''}`.toLocaleLowerCase('ko-KR').includes(search.trim().toLocaleLowerCase('ko-KR'))))).map(group=>group.latest);
  const visibleReceipts = showAll ? matchingReceipts : matchingReceipts.slice(0,6);

  useEffect(() => {
    if (!file && restorePickerFocus.current) {
      restorePickerFocus.current=false;
      pickerButtonRef.current?.focus();
    }
  }, [file]);

  useEffect(() => {
    const receiptId=routingResult?.receiptId;
    if (!receiptId || receiptId===focusedContinuation.current || !continuedRowRef.current) return;
    continuedRowRef.current.focus({preventScroll:true});
    continuedRowRef.current.scrollIntoView({block:'nearest'});
    focusedContinuation.current=receiptId;
  }, [routingResult?.receiptId, receipts]);

  function changeMode(next: IntakeMode) {
    if (submitLock.current) return;
    setMode(next); setError(null); setDragging(false); dragDepth.current=0;
  }
  function addFiles(selected: File[]) {
    if (submitLock.current || !selected.length || noContract) return;
    if (selected.length !== 1) {setError('한 번에 PDF 파일 1개만 선택해 주세요.'); return;}
    const message=validateFile(selected[0]);
    if (message) {setError(message); return;}
    setFiles(current=>({...current,[mode]:selected[0]}));setError(null);setResult(null);
  }
  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.currentTarget.files||[]));event.currentTarget.value='';
  }
  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();dragDepth.current=0;setDragging(false);addFiles(Array.from(event.dataTransfer.files));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || !canSubmitKind) return;
    const message=validateFile(file);
    if (message || !file) {setError(message);return;}
    if (!registering && !studioMatching && !chosenContract) {setError('요청서를 접수할 등록 계약을 선택해 주세요.');return;}
    submitLock.current=true;setBusy(true);setError(null);setResult(null);
    try {
      const header=new Uint8Array(await file.slice(0,5).arrayBuffer());
      if (header.length!==5 || String.fromCharCode(...header)!=='%PDF-') throw Error('PDF 형식을 확인할 수 없습니다. 정상적인 PDF 파일을 다시 선택해 주세요.');
      const receipt=registering ? await onRegisterContract(file) : await onSubmitRequest(file,studioMatching ? '' : chosenContract!.id);
      setResult({mode,receipt});setFiles(current=>({...current,[mode]:null}));
    } catch(cause) {setError(cause instanceof Error ? cause.message : '접수하지 못했습니다. 선택한 문서는 유지되므로 다시 접수해 주세요.');}
    finally {submitLock.current=false;setBusy(false);}
  }

  async function continueReceipt(receipt: OperationsReceipt) {
    if(routingLock.current||!canSubmit)return;
    const selected=routingContracts[receipt.id];
    if(receipt.routing?.detectedKind==='request'&&!registered.some(contract=>contract.id===selected)){
      setRoutingError({id:receipt.id,message:'요청서를 접수할 등록 계약을 선택해 주세요.'});return;
    }
    routingLock.current=true;setRoutingBusy(receipt.id);setRoutingError(null);setRoutingResult(null);
    try {
      const accepted=await onContinueDocument(receipt.id,receipt.routing?.detectedKind==='request'?selected:undefined);
      setRoutingOnly(false);setSearch('');setShowAll(true);setRoutingResult(accepted);
    }
    catch(cause){setRoutingError({id:receipt.id,message:cause instanceof Error?cause.message:'접수를 이어가지 못했습니다. 다시 시도해 주세요.'});}
    finally{routingLock.current=false;setRoutingBusy(null);}
  }
  function receiptStatus(receipt: OperationsReceipt) {
    if(receipt.stateLabel)return receipt.stateLabel;
    if(receipt.status==='failed')return '접수 실패';
    if(receipt.outcome==='extraction_failed')return '필수값 추출 실패';
    if(receipt.outcome==='technical_error')return '기술 오류';
    if(receipt.outcome==='registered')return '계약 등록 완료';
    if(receipt.outcome==='compared')return '대조 완료';
    return receipt.documentStatus==='checking'?'문서 확인 중':receipt.documentStatus==='routing'?'접수 단계 변경 필요':receipt.documentStatus==='continued'?(receipt.routing?.detectedKind==='contract'?'계약 등록으로 전환됨':receipt.routing?.detectedKind==='request'?'실행 요청으로 전환됨':'다른 접수 단계로 연결됨'):receipt.documentStatus==='needs_attention'?'문서 확인 필요':receipt.documentStatus==='completed'?'처리 종료 · 결과 확인':'접수 완료';
  }

  function routingDetails(receipt: OperationsReceipt) {
    if (!receipt.routing || receipt.routing.continuedAs) return null;
    return <details className="bki-routing-details" open={routingOnly || undefined}>
      <summary>접수 단계 변경 안내</summary>
      <div className="bki-routing-content"><strong>{receipt.routing.message}</strong>
              {receipt.routing!.canContinue ? <>
                <p>올린 파일과 기존 분석을 사용합니다. 문서를 다시 올리지 않아도 됩니다.</p>
                {receipt.routing!.detectedKind==='request' && (registered.length ? <label className="bki-routing-picker">연결할 계약<select aria-label={`${receipt.fileNames.join(' ')} 연결할 계약`} disabled={routingBusy!==null} value={routingContracts[receipt.id]||''} onChange={event=>{setRoutingContracts(current=>({...current,[receipt.id]:event.target.value}));setRoutingError(null);}}><option value="">계약을 선택하세요</option>{registered.map(contract=><option key={contract.id} value={contract.id}>{contract.companyName} · {contract.reference} · {formatWon(contract.amount)}</option>)}</select></label> : <p>{contractGuidance} 이 요청서는 접수 내역에 보관됩니다.</p>)}
                {receipt.routing!.detectedKind==='request'&&!registered.length ? !contractPending && recordsState === 'ready' && <button type="button" className="bki-select-button" disabled={busy || enabledKinds?.contract === false} onClick={()=>changeMode('contract')}>계약 등록으로 이동<ArrowRight size={16}/></button> : <button type="button" className="bki-select-button" disabled={!canSubmit||routingBusy!==null||(receipt.routing!.detectedKind==='request'&&!registered.some(c=>c.id===routingContracts[receipt.id]))} onClick={()=>void continueReceipt(receipt)}>{routingBusy===receipt.id?<><LoaderCircle size={16} className="bki-spin"/>접수 연결 중</>:<>{receipt.routing!.detectedKind==='request'?'이 계약으로 요청 접수':'계약 등록으로 이어가기'}<ArrowRight size={16}/></>}</button>}
              </> : <><p>{studioMatching ? '문서 종류와 접수 업무를 확인한 뒤 올바른 문서를 다시 접수해 주세요. 자동 전환은 지원하지 않습니다.' : '문서 보완이 필요해 기존 분석을 재사용할 수 없습니다. 내용을 확인하고 보완한 문서를 올려 주세요.'}</p><button type="button" className="bki-select-button" disabled={busy} onClick={()=>changeMode(receipt.routing!.detectedKind)}>올바른 접수 단계로 이동<ArrowRight size={16}/></button></>}
              {routingError?.id===receipt.id&&<p className="bki-receipt-error" role="alert">{routingError.message}</p>}
      </div>
    </details>;
  }

  return <div className="bki-root">
    {pendingRoutes.length>0&&<div className="bki-routing-summary" role="status"><span><Info size={18} aria-hidden="true"/>접수 단계 확인이 필요한 문서가 {pendingRoutes.length}건 있습니다.</span><a href={`#${id}-receipts-title`} onClick={()=>{setSearch('');setRoutingOnly(true);setShowAll(true);}}>안내 확인<ArrowDownToLine size={15}/></a></div>}
    <div className="bki-workflow" aria-label="문서 접수 업무 선택">
      <span className="bki-workflow-label">접수 업무</span>
      <button type="button" className={'bki-workflow-step'+(registering?' is-active':'')} aria-pressed={registering} disabled={busy || enabledKinds?.contract === false} onClick={()=>changeMode('contract')}>
        계약 등록
      </button>
      <button type="button" className={'bki-workflow-step'+(!registering?' is-active':'')} aria-pressed={!registering} disabled={busy || enabledKinds?.request === false} onClick={()=>changeMode('request')}>
        실행 요청 접수
      </button>
    </div>
    {studioMatching && <p className="bki-file-help">요청서의 계약번호로 Studio에 등록된 계약을 대조합니다. 여기서 계약을 선택하지 않습니다.</p>}
    {enabledKinds?.contract === false && <p className="bki-connection-note">계약 등록 Agent 미설정 · 새 계약 접수는 사용할 수 없습니다.</p>}
    {enabledKinds?.request === false && <p className="bki-connection-note">실행 요청 Agent 연결 설정이 필요합니다.</p>}
    <div className="bki-intake-layout">
      <section className="bki-panel bki-upload-panel" aria-labelledby={`${id}-intake-title`}>
        <h2 className="bki-visually-hidden" id={`${id}-intake-title`}>{registering?'계약서 등록':'실행 요청서 접수'}</h2>
        {noContract ? <div className="bki-contract-empty"><span><FolderOpen size={30}/></span><strong>{contractGuidance}</strong><p>{contractPending ? '계약서가 접수되었습니다. 등록이 완료되면 실행 요청서를 접수할 수 있습니다.' : contractAttention ? '접수 내역을 확인하고 필요한 경우 관리자에게 문의해 주세요.' : '등록된 계약이 있어야 실행 요청서를 접수할 수 있습니다.'}</p>{!contractPending && recordsState === 'ready' && <button type="button" className="bki-select-button" onClick={()=>changeMode('contract')}>계약 등록으로 이동<ArrowRight size={17}/></button>}</div> : <form onSubmit={submit} noValidate>
          {!registering && !studioMatching && <div className="bki-contract-picker"><label htmlFor={`${id}-contract`}>등록 계약</label><ContractSelect.Root value={chosenContract?.id||''} disabled={busy} onValueChange={value=>{setContractId(value);setError(null);setResult(null);}}><ContractSelect.Trigger id={`${id}-contract`} className="bki-contract-trigger" aria-label="등록 계약" title={chosenContract?`${chosenContract.companyName} · ${chosenContract.reference}`:undefined}><ContractSelect.Value placeholder="계약 선택"/><ContractSelect.Icon>⌄</ContractSelect.Icon></ContractSelect.Trigger><ContractSelect.Portal><ContractSelect.Content className="bki-contract-menu" position="popper" align="start" sideOffset={4}><ContractSelect.Viewport>{registered.map(contract=><ContractSelect.Item className="bki-contract-option" key={contract.id} value={contract.id}><ContractSelect.ItemText>{contract.companyName} · {contract.reference}</ContractSelect.ItemText></ContractSelect.Item>)}</ContractSelect.Viewport></ContractSelect.Content></ContractSelect.Portal></ContractSelect.Root>{chosenContract && <dl className="bki-contract-summary" aria-label="선택한 계약 정보"><div><dt>총 계약금액</dt><dd>{formatWon(chosenContract.amount)}</dd></div></dl>}</div>}
          <input ref={inputRef} id={`${id}-files`} className="bki-hidden-input" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={selectFile} tabIndex={-1} aria-label={registering?'계약서 PDF 선택':'실행 요청서 PDF 선택'}/>
          {!file && <div className={'bki-dropzone'+(dragging?' bki-dropzone--active':'')}
            onDragEnter={event=>{event.preventDefault();if(!busy){dragDepth.current++;setDragging(true);}}}
            onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';}}
            onDragLeave={event=>{event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}} onDrop={dropFile}>
            <span className="bki-single-document" aria-hidden="true"><FileText size={35} strokeWidth={1.5}/></span>
            <strong>{registering?'계약서 PDF를 여기에 놓아주세요':'실행 요청서 PDF를 여기에 놓아주세요'}</strong>
            <button ref={pickerButtonRef} type="button" className="bki-select-button" disabled={busy} onClick={()=>inputRef.current?.click()} aria-describedby={helpId}><FolderOpen size={17}/>파일 선택</button>
          </div>}
          {file && <div className="bki-selected"><div className="bki-file"><span className="bki-file-icon"><FileText size={20}/></span><div className="bki-file-info"><small>{registering?'계약서':'실행 요청서'}</small><strong>{file.name}</strong><span>PDF · {fileSize(file.size)}</span></div><div className="bki-file-actions"><button type="button" className="bki-change-button" disabled={busy} onClick={()=>inputRef.current?.click()} aria-label={`${file.name} 파일 변경`}>파일 변경</button><button type="button" className="bki-remove-button" disabled={busy} aria-label={`${file.name} 선택 해제`} onClick={()=>{restorePickerFocus.current=true;setFiles(current=>({...current,[mode]:null}));setError(null);setResult(null);}}><X size={18}/></button></div></div></div>}
          <p id={helpId} className="bki-file-help">PDF 1개 · 최대 25 MB · 20쪽 이하</p>
          {error && <div id={errorId} className="bki-error" role="alert"><Info size={18}/><p>{error}</p></div>}
          {result?.mode===mode && <div className="bki-success" role="status"><CheckCircle2 size={21}/><div><strong>{result.receipt.duplicate?'이미 접수된 문서입니다.':registering?'계약서가 접수되었습니다.':'실행 요청서가 접수되었습니다.'}</strong><p>진행 상태는 접수 내역에서 확인할 수 있습니다.</p><p>접수번호 <span title={result.receipt.receiptId}>{formatReceiptId(result.receipt.receiptId)}</span> · {formatDateTime(result.receipt.receivedAt)}</p></div></div>}
          {file && <div className="bki-submit-row"><button type="submit" className="bki-submit-button" disabled={busy||!canSubmitKind||!ready} aria-describedby={!canSubmitKind?connectionId:error?errorId:helpId}>{busy?<><LoaderCircle className="bki-spin" size={18}/>접수 중</>:<>{registering?'계약서 등록하기':'실행 요청서 접수하기'}<ArrowRight size={18}/></>}</button></div>}
          {!canSubmitKind && <p id={connectionId} className="bki-connection-note"><Info size={15}/>접수 기능을 사용할 수 없습니다. 상단의 접수 기능 안내를 확인해 주세요.</p>}
        </form>}
      </section>
    </div>
      <section className="bki-panel bki-receipts" aria-labelledby={`${id}-receipts-title`}>
        <div className="bki-receipts-header">
          <div><h2 id={`${id}-receipts-title`}>{routingOnly?'접수 단계 확인':'접수 문서'} <span>{routingOnly?pendingRoutes.length:groups.length}</span></h2>{routingOnly && <button type="button" className="bki-show-all" onClick={()=>{setRoutingOnly(false);setSearch('');setShowAll(false);}}>전체 내역 보기</button>}</div>
          <div className="bki-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="접수번호 또는 파일명 검색" placeholder="접수번호 또는 파일명 검색" value={search} onChange={(event) => {setSearch(event.target.value); setShowAll(false);}} /></div>
        </div>
        {routingResult&&<div className="bki-routing-success" role="status"><CheckCircle2 size={16}/><span>접수를 연결했습니다.</span><span title={routingResult.receiptId}>접수 {formatReceiptId(routingResult.receiptId)}</span></div>}
        {recordsState !== 'ready' ? <div className="bki-empty" role="status"><strong>{recordsState === 'loading' ? '접수 내역을 불러오는 중입니다.' : '접수 내역을 확인하지 못했습니다.'}</strong><p>{recordsState === 'loading' ? '잠시만 기다려 주세요.' : '상단에서 접수 기록을 다시 불러와 주세요.'}</p></div> : matchingReceipts.length ? (
          <>
            <div className="bki-table-scroll">
              <table className="bki-table">
                <thead><tr><th scope="col">접수 문서</th><th scope="col">접수 시각</th><th scope="col">상태</th></tr></thead>
                <tbody>{visibleReceipts.map((receipt) => <tr key={receipt.id} ref={receipt.id===routingResult?.receiptId?continuedRowRef:undefined} tabIndex={receipt.id===routingResult?.receiptId?-1:undefined} className={receipt.id===routingResult?.receiptId?'bki-receipt--continued':undefined}>
                  <td data-label="접수 문서"><ul className="bki-receipt-files">{receipt.fileNames.map((name, index) => <li key={`${name}-${index}`}><FileText size={15} aria-hidden="true" /><span>{name}</span></li>)}</ul><div className="bki-receipt-meta">{receipt.kind && <span className="bki-receipt-kind">{receipt.kind==='contract'?'계약 등록':'실행 요청'}</span>}{(histories.get(receipt.id)||[]).filter(item=>item.originalReceiptId).length>0 && <span>재분석 {(histories.get(receipt.id)||[]).filter(item=>item.originalReceiptId).length}회</span>}</div><details className="bki-receipt-history"><summary>접수 이력 {(histories.get(receipt.id)||[]).length}건</summary><ol>{(histories.get(receipt.id)||[receipt]).map(item=><li key={item.id}><time>{formatDateTime(item.receivedAt)}</time><span>{receiptStatus(item)}</span><span title={item.id}>접수 {formatReceiptId(item.id)}</span>{item.contractReference&&<span>계약 {item.contractReference}</span>}</li>)}</ol></details>{routingDetails(receipt)}</td>
                  <td data-label="접수 시각"><time dateTime={receipt.receivedAt}>{formatDateTime(receipt.receivedAt)}</time></td>
                  <td data-label="상태"><span className={`bki-status${receipt.status === 'failed'||receipt.documentStatus==='routing'||receipt.documentStatus==='needs_attention' ? ' bki-status--failed' : receipt.documentStatus==='checking'||receipt.documentStatus==='completed'?' bki-status--checking':''}`}><span aria-hidden="true" />{receiptStatus(receipt)}</span>{receipt.routing?.continuedAs&&<p className="bki-routing-file" title={receipt.routing.continuedAs}>연결 접수 {formatReceiptId(receipt.routing.continuedAs)}</p>}{receipt.documentStatus==='needs_attention'&&<p className="bki-receipt-error">관리자 확인 필요</p>}{receipt.status === 'failed' && receipt.error && <p className="bki-receipt-error">{receipt.error}</p>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="bki-list-footer">{(search.trim() || matchingReceipts.length>visibleReceipts.length) && <span>문서 {matchingReceipts.length}건 중 {visibleReceipts.length}건 표시</span>}{matchingReceipts.length > 6 && <button type="button" onClick={() => setShowAll(!showAll)}>{showAll ? '간단히 보기' : '접수 내역 더 보기'}<ArrowDownToLine size={15} aria-hidden="true" /></button>}</div>
          </>
        ) : (
          <div className="bki-empty"><span><FolderOpen size={29} strokeWidth={1.5} aria-hidden="true" /></span><strong>{search.trim() ? '검색 결과가 없습니다' : routingOnly ? '단계 확인이 필요한 문서가 없습니다' : '아직 접수한 문서가 없습니다'}</strong><p>{search.trim() ? '접수번호나 파일명을 다시 확인해 주세요.' : routingOnly ? '전체 내역에서 연결된 접수의 진행 상태를 확인할 수 있습니다.' : '계약서나 실행 요청서를 접수하면 이곳에 내역이 표시됩니다.'}</p></div>
        )}
      </section>
    </div>
;
}
