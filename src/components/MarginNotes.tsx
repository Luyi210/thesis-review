import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { buildMarginPositions, inspectMarginSelection, marginAdvice, marginValues, type MarginFinding, type MarginSelection } from '../domain/marginNotes';
import { LABELS, type Report } from '../domain/types';
import { prettyPosition, publicAsset } from '../utils';

interface Props {
  report: Report | null;
  selected: MarginSelection | null;
  onSelect: (id: string, item: number) => void;
}

function noteTitle({ check, item, status }: MarginFinding) {
  if (!item || status !== 'fail') return check.rule.title;
  switch (check.rule.mode) {
    case 'body_font': return '正文中文字体不符';
    case 'body_size': {
      const sizes = item.observed.split('、').map(Number);
      const expected = check.rule.params.expected_pt;
      if (expected && sizes.every(n => n > 0 && n < expected)) return '正文字号偏小';
      if (expected && sizes.every(n => n > expected)) return '正文字号偏大';
      return '正文字号不符';
    }
    case 'body_line': return '正文行距不符';
    case 'body_spacing': return '字符间距不符';
    case 'page_size': return '纸张大小不符';
    case 'keywords': return '关键词数量不符';
    case 'caption_position': return '题注位置不符';
    case 'caption_number': return '题注编号不符';
    default: return check.rule.title;
  }
}

function Finding({ finding, report }: { finding: MarginFinding; report: Report }) {
  const { check, item, status } = finding;
  const values = marginValues(finding);
  const advice = marginAdvice(finding, report);
  const page = check.rule.source.pdf_page;
  const statusLabel = !check.executed && status === 'manual' ? '未执行' : LABELS[status];
  return <section className="note-finding">
    <header className="note-title"><span className={`note-status ${status}`}>{statusLabel}</span><h3>{noteTitle(finding)}</h3></header>
    {values && <p className="note-evidence"><span><span className="sr-only">当前记录：</span>{values.observed}</span>
      {values.expected && <><ArrowRight size={15} aria-hidden="true"/><strong><span className="sr-only">要求：</span>{values.expected}</strong></>}</p>}
    {item?.reason && <p className="note-reason">{item.reason}</p>}
    {!item && <p className="note-reason">{check.summary}</p>}
    {advice && <p className="note-advice">{advice}</p>}
    <a className="note-source" href={publicAsset(`rules/guide.pdf#page=${page}`)} target="_blank" rel="noreferrer"
      title={`${check.rule.source.section}　${check.rule.source.quote}`}>《撰写指南》第 {page} 页</a>
  </section>;
}

export function MarginNotes({ report, selected, onSelect }: Props) {
  const positions = useMemo(() => report ? buildMarginPositions(report) : [], [report]);
  const current = useMemo(() => report ? inspectMarginSelection(report, positions, selected) : undefined, [positions, report, selected]);
  const index = useMemo(() => current ? positions.indexOf(current) : -1, [positions, current]);
  function navigate(to: number) {
    const finding = positions[to]?.findings[0];
    if (finding) onSelect(finding.check.rule.id, finding.itemIndex);
  }
  const firstAlert = useMemo(() => positions.findIndex(p => p.findings[0].status !== 'manual'), [positions]);
  const first = firstAlert < 0 ? 0 : firstAlert;
  return <div className="margin-notes">
    <header className="margin-heading margin-notes-header">
      <h2>页边批注</h2>
      {positions.length > 0 && <nav className="note-navigation" aria-label="批注导航">
        <button type="button" aria-label="上一处批注" title="上一处批注" disabled={index <= 0} onClick={() => navigate(index - 1)}><ChevronLeft size={17}/></button>
        <span>{index < 0 ? `共 ${positions.length} 项` : `${index + 1} / ${positions.length}`}</span>
        <button type="button" aria-label="下一处批注" title="下一处批注" disabled={index >= positions.length - 1} onClick={() => navigate(index < 0 ? first : index + 1)}><ChevronRight size={17}/></button>
      </nav>}
    </header>
    <div className="margin-body">
      {current && report ? <div className="margin-track"><div className="note-content" role="region" aria-label="当前批注" aria-live="polite">
        <p className="note-location">{current.location ? prettyPosition(current.location) : '整份材料'}{current.findings.length > 1 && ` · ${current.findings.length} 项`}</p>
        {current.findings.map(f => <Finding key={`${f.check.rule.id}:${f.itemIndex}`} finding={f} report={report}/>)}
      </div></div> : <div className="margin-placeholder">
        <p>{!report ? '上传后，点选原文标记查看批注。' : !positions.length ? '本次检查没有可列出的批注。' : firstAlert < 0 ? '当前仅有待人工核对的项目。' : '点选原文标记，查看这一处的问题和修改建议。'}</p>
        {report && !positions.length && report.checks.some(c => !c.executed && c.status === 'manual') && <p>待人工核对项可在「更多工具 → 完整检查记录」中查看。</p>}
        {positions.length > 0 && <button type="button" className="note-start" onClick={() => navigate(first)}>{firstAlert < 0 ? '查看待核对项' : '查看第一处批注'} <ArrowRight size={14}/></button>}
      </div>}
    </div>
  </div>;
}
