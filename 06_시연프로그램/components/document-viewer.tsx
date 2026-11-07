'use client';

import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, RotateCw, X, ZoomIn, ZoomOut} from 'lucide-react';
import type {OperationsSource} from '../lib/operations-types';
import './document-viewer.css';

type DocumentInfo = {pages: number; filename: string};
type DocumentAction = 'info' | 'page' | 'pdf';

function documentUrl(value: string | undefined, action: DocumentAction, page = 1): string | undefined {
  if (!value || value.startsWith('//')) return undefined;
  try {
    const url = new URL(value, 'http://document.local');
    if (!['http:', 'https:'].includes(url.protocol) || !['/api/document', '/api/studio/document'].includes(url.pathname)) return undefined;
    if (!url.searchParams.get('session') || !/^[a-f0-9]{64}$/.test(url.searchParams.get('id') || '')) return undefined;
    for (const key of ['page', 'info', 'format']) url.searchParams.delete(key);
    url.hash = '';
    if (action === 'info') url.searchParams.set('info', '1');
    if (action === 'page') url.searchParams.set('page', String(page));
    if (action === 'pdf') url.searchParams.set('format', 'pdf');
    return value.startsWith('/') ? url.pathname + url.search : url.href;
  } catch {return undefined;}
}

function PageImage({url, name, page}: {url: string; name: string; page: number}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return <>
    {state === 'loading' && <div className="doc-viewer-image-status" role="status"><LoaderCircle className="doc-viewer-spin" size={20} aria-hidden="true" />페이지를 불러오는 중입니다.</div>}
    {state === 'error' && <div className="doc-viewer-image-status" role="alert"><p>이 페이지를 불러오지 못했습니다.</p><button type="button" onClick={() => {setState('loading'); setAttempt(value => value + 1);}}><RotateCw size={16} aria-hidden="true" />페이지 다시 불러오기</button></div>}
    {/* eslint-disable-next-line @next/next/no-img-element -- PDF page images have variable dimensions and use the authenticated document endpoint. */}
    <img key={attempt} src={url} alt={`${name} ${page}쪽 원문`} onLoad={() => setState('loaded')} onError={() => setState('error')} hidden={state === 'error'} />
  </>;
}

function SelectedDocument({source}: {source: OperationsSource}) {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(Number.isInteger(source.page) && source.page! >= 1 ? source.page! : 1);
  const [zoom, setZoom] = useState(100);
  const infoUrl = documentUrl(source.url, 'info');
  const pdfUrl = documentUrl(source.url, 'pdf');

  useEffect(() => {
    if (!infoUrl) return;
    const controller = new AbortController();
    void fetch(infoUrl, {signal: controller.signal, cache: 'no-store'}).then(async response => {
      if (!response.ok) throw Error('document_info_failed');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object') throw Error('document_info_invalid');
      const data = value as Record<string, unknown>;
      if (typeof data.pages !== 'number' || !Number.isInteger(data.pages) || data.pages < 1 || data.pages > 20 || typeof data.filename !== 'string') throw Error('document_info_invalid');
      if (!controller.signal.aborted) {
        setInfo({pages: data.pages, filename: data.filename});
        setPage(current => Math.min(current, data.pages as number));
      }
    }).catch(() => {if (!controller.signal.aborted) setError('원문 정보를 불러오지 못했습니다. 연결 상태를 확인하고 다시 불러와 주세요.');});
    return () => controller.abort();
  }, [infoUrl, retry]);

  const imageUrl = info ? documentUrl(source.url, 'page', page) : undefined;
  return <>
    <div className="doc-viewer-toolbar">
      <div className="doc-viewer-pages" role="group" aria-label="원문 페이지 이동">
        <button type="button" aria-label="이전 페이지" disabled={!info || page <= 1} onClick={() => setPage(value => value - 1)}><ArrowLeft size={17} aria-hidden="true" /></button>
        <label>페이지<select aria-label="원문 페이지 선택" value={info ? page : ''} disabled={!info} onChange={event => setPage(Number(event.target.value))}>{info ? Array.from({length: info.pages}, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / {info.pages}쪽</option>) : <option value="">불러오는 중</option>}</select></label>
        <button type="button" aria-label="다음 페이지" disabled={!info || page >= info.pages} onClick={() => setPage(value => value + 1)}><ArrowRight size={17} aria-hidden="true" /></button>
      </div>
      <div className="doc-viewer-zoom" role="group" aria-label="원문 확대 축소">
        <button type="button" aria-label="원문 축소" disabled={zoom <= 75} onClick={() => setZoom(value => Math.max(75, value - 25))}><ZoomOut size={17} aria-hidden="true" /></button><span aria-live="polite">{zoom}%</span><button type="button" aria-label="원문 확대" disabled={zoom >= 250} onClick={() => setZoom(value => Math.min(250, value + 25))}><ZoomIn size={17} aria-hidden="true" /></button>
      </div>
      {pdfUrl && <a className="doc-viewer-pdf" href={pdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" />원본 PDF 열기</a>}
    </div>
    <div className="doc-viewer-stage" aria-label={`${info?.filename || source.name} 원문`}>
      {!info && !error && <div className="doc-viewer-message" role="status"><LoaderCircle className="doc-viewer-spin" size={24} aria-hidden="true" /><p>원문을 불러오는 중입니다.</p></div>}
      {error && <div className="doc-viewer-message" role="alert"><p>{error}</p><button type="button" onClick={() => {setError(''); setRetry(value => value + 1);}}><RotateCw size={16} aria-hidden="true" />다시 불러오기</button></div>}
      {imageUrl && <div className="doc-viewer-sheet" style={{width: `${zoom}%`}}><PageImage key={imageUrl} url={imageUrl} name={info!.filename} page={page} /></div>}
    </div>
    {info && <p className="doc-viewer-caption" aria-live="polite">{info.filename} · 전체 {info.pages}쪽 중 {page}쪽</p>}
  </>;
}

export default function DocumentViewer({files, initialSource, onClose}: {files: OperationsSource[]; initialSource: OperationsSource; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState(initialSource);
  const choices = useMemo(() => {
    const result = new Map<string, OperationsSource>();
    for (const source of [...files, initialSource]) {
      const key = documentUrl(source.url, 'pdf') || 'unlinked:' + source.name;
      if (!result.has(key)) result.set(key, source);
    }
    return [...result.values()];
  }, [files, initialSource]);
  const selectedKey = documentUrl(selected.url, 'pdf');

  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node?.showModal(); close.current?.focus();
    return () => {node?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus({preventScroll: true});};
  }, []);

  return <dialog ref={dialog} className="doc-viewer" aria-labelledby={titleId} onCancel={event => {event.preventDefault(); onClose();}} onClick={event => {if (event.target === event.currentTarget) onClose();}}>
    <div className="doc-viewer-panel">
      <header className="doc-viewer-header"><div><h2 id={titleId}>원문 보기</h2></div><button ref={close} type="button" className="doc-viewer-close" aria-label="원문 뷰어 닫기" onClick={onClose}><X size={21} aria-hidden="true" /></button></header>
      <div className="doc-viewer-file">{choices.length === 1 ? <strong className="doc-viewer-filename">{selected.name}</strong> : <><label htmlFor={titleId + '-file'}>열람할 문서</label><select id={titleId + '-file'} value={selectedKey || ''} onChange={event => {const source = choices.find(item => documentUrl(item.url, 'pdf') === event.target.value); if (source) setSelected(source);}}>{choices.map(source => {const key = documentUrl(source.url, 'pdf'); return <option key={key || source.name} value={key || 'unlinked:' + source.name} disabled={!key}>{source.name}{!key ? ' · 원문 연결 없음' : ''}</option>;})}</select><span>{choices.length}개 파일</span></>}</div>
      {selectedKey ? <SelectedDocument key={selectedKey} source={selected} /> : <div className="doc-viewer-message"><p>연결된 원문이 없습니다.</p></div>}
    </div>
  </dialog>;
}
