import type {ReactNode} from 'react';

/** Render the report's fixed Markdown subset as text and tables, never raw HTML. */
export default function DailyReportContent({text,compactHeader=false}: {text: string;compactHeader?:boolean}) {
  const lines = text.split(/\r?\n/);
  const content: ReactNode[] = [];
  let criteria: ReactNode[] | null = null;
  const headerCriteria: ReactNode[] = [];
  const push = (node: ReactNode) => (criteria || content).push(node);
  const knownReport = /^# (?:일일 문서 대조 요약 보고서|일일 요약 보고서)/.test(text);
  const firstSection = lines.findIndex(line => /^## /.test(line));
  const cells = (line: string) => line.trim().slice(1, -1).split('|').map(cell => cell.trim());
  let heading = '보고서';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (compactHeader && knownReport && (/^집계 대상 \d+건\.$/.test(line) || /^집계 (?:시작|기준) 시각\(KST\):/.test(line))) continue;
    if (compactHeader && knownReport && /^담당자 확인 필요 합계에는/.test(line) && !criteria) {headerCriteria.push(<p key={`meaning-${index}`}>{line}</p>);continue;}
    if (compactHeader && knownReport && index < firstSection) {
      if (!/^# |^대상 접수일:|^집계 범위:/.test(line)) headerCriteria.push(<p key={`header-${index}`}>{line}</p>);
      continue;
    }
    const title = /^#{1,3}\s+(.+)$/.exec(line) || /^(\[(?:집계 범위|처리 현황|주요 불일치|담당자 확인 목록)\])$/.exec(line);
    if (title) {
      heading = title[1];
      if (criteria) {content.push(<details key={`criteria-${index}`} className="daily-report-criteria"><summary>집계 기준·용어 안내</summary>{criteria}</details>);criteria=null;}
      if (heading === '집계 기준') {criteria=[];continue;}
      push(<h3 key={index}>{heading}</h3>);
    } else if (line.startsWith('|') && line.endsWith('|') && /^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(lines[index + 1]?.trim() || '')) {
      const start = index;
      const headers = cells(line);
      const rows: string[][] = [];
      index++;
      while (lines[index + 1]?.trim().startsWith('|') && lines[index + 1].trim().endsWith('|')) rows.push(cells(lines[++index]));
      push(<div key={start} className="daily-report-table" role="region" aria-label={`${heading} 표 · 가로 스크롤 가능`} tabIndex={0}>
        <table>{headers.length === 2 && headers[1] === '요청 수' && <colgroup><col style={{width:'65%'}}/><col style={{width:'35%'}}/></colgroup>}<caption>{heading}</caption><thead><tr>{headers.map((header, column) => <th key={column} scope="col">{header}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, column) => <td key={column}>{row[column] || '—'}</td>)}</tr>)}</tbody></table>
      </div>);
    } else push(<p key={index}>{line}</p>);
  }
  if (criteria || headerCriteria.length) content.push(<details key="criteria-final" className="daily-report-criteria"><summary>집계 기준·용어 안내</summary>{headerCriteria}{criteria}</details>);
  return <div className="daily-report-body">{content}</div>;
}
