import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ArrowRight, ExternalLink, List, LocateFixed } from 'lucide-react';
import { buildMarginPositions, inspectMarginSelection, marginAdvice, marginValues, type MarginFinding, type MarginSelection } from '../domain/marginNotes';
import { explanationKey, usesRuleAdviceOnly } from '../model/contracts';
import { OccurrenceExplanation, type ExplanationControls } from './OccurrenceExplanation';
import { FindingFeedback } from './TeacherFeedback';
import { LABELS, type Report, type Status } from '../domain/types';
import { prettyItemPosition, prettyPosition, publicAsset } from '../utils';
import { RuleSource } from './RuleSource';

interface Props {
  report: Report | null;
  selected: MarginSelection | null;
  onSelect: (id: string, item: number) => void;
  controls?: ExplanationControls;
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

function Finding({ finding, report, controls, onSelect }: {
  finding: MarginFinding; report: Report; controls?: ExplanationControls; onSelect: Props['onSelect'];
}) {
  const { check, item, status } = finding;
  const target = explanationKey(report.id, check.rule.id, finding.itemIndex);
  const allowModel = !usesRuleAdviceOnly(check);
  const result = allowModel ? controls?.results[target] : undefined;
  const expanded = result?.explanations[0];
  const values = marginValues(finding);
  const advice = marginAdvice(finding, report);
  const statusLabel = !check.executed && status === 'manual' ? '未执行' : LABELS[status];

  return <section className="note-finding">
    <header className="note-title">
      <h3>{noteTitle(finding)}</h3>
      <span className={`note-status ${status}`}>{statusLabel}</span>
    </header>
    {values && <div className="note-evidence">
      {item?.formatSpan && (
        <button type="button" className="format-quote-inline" title="在左侧原稿中定位这段文字" onClick={() => onSelect(check.rule.id, finding.itemIndex)}>
          <q>{item.formatSpan.text}{item.formatSpan.truncated ? '…' : ''}</q>
        </button>
      )}
      <span className="evidence-pair">
        <span className="evidence-observed"><span className="sr-only">当前记录：</span>{values.observed}</span>
        {values.expected && <>
          <ArrowRight size={14} aria-hidden="true"/>
          <strong className="evidence-expected">
            <span className="sr-only">{check.rule.source.kind === 'document' ? '建议写法：' : '要求：'}</span>
            {values.expected}
          </strong>
        </>}
      </span>
    </div>}
    {!values && item?.formatSpan && (
      <button type="button" className="format-quote" title="定位这段格式异常或待核对的文字" onClick={() => onSelect(check.rule.id, finding.itemIndex)}>
        <span>涉及文字</span><q>{item.formatSpan.text}{item.formatSpan.truncated ? '…' : ''}</q>
      </button>
    )}
    {item?.reason && <p className="note-reason">{item.reason}</p>}
    {!item && <p className="note-reason">{check.summary}</p>}
    {advice && <p className="note-advice">{advice}</p>}
    <div className="note-meta-bar">
      <RuleSource className="note-source" source={check.rule.source}/>
    </div>
    {check.executed && status !== 'not_applicable' && <div className="finding-follow-up">
      {controls && allowModel && <OccurrenceExplanation controls={controls} target={target} check={check} itemIndex={finding.itemIndex}/>}
      <FindingFeedback report={report} finding={finding} modelAdvice={result && expanded ? {
        text: expanded.explanation, steps: expanded.steps, modelId: result.modelId, skillVersion: result.skillVersion,
      } : undefined}/>
    </div>}
  </section>;
}

export function MarginNotes({ report, selected, onSelect, controls }: Props) {
  const [listAnchor, setListAnchor] = useState<{ reportId: string; selection: MarginSelection | null } | null>(null);
  const listOpen = listAnchor !== null && listAnchor.reportId === report?.id && listAnchor.selection === selected;
  const listId = useId();
  const listButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const positions = useMemo(() => report ? buildMarginPositions(report) : [], [report]);
  const findings = useMemo(() => positions.flatMap(position => position.findings), [positions]);
  const current = useMemo(() => report ? inspectMarginSelection(report, positions, selected) : undefined, [positions, report, selected]);
  const activeFinding = current?.findings.find(f => f.check.rule.id === selected?.id && f.itemIndex === selected.item) ?? current?.findings[0];
  const index = useMemo(() => current ? positions.indexOf(current) : -1, [positions, current]);
  const location = activeFinding?.item?.location;
  const canLocate = report?.document.format === 'pdf' ? Boolean(location?.page)
    : Boolean(location?.paragraph || location?.objectId || location?.excerpt);

  useLayoutEffect(() => {
    if (listOpen) list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [listOpen]);

  const counts = useMemo(() => {
    let fail = 0; let warning = 0; let manual = 0;
    for (const f of findings) {
      if (f.status === 'fail') fail++;
      else if (f.status === 'warning') warning++;
      else if (f.status === 'manual') manual++;
    }
    return { fail, warning, manual };
  }, [findings]);

  function navigate(to: number) {
    const finding = positions[to]?.findings[0];
    if (finding) onSelect(finding.check.rule.id, finding.itemIndex);
  }
  function jumpToStatus(targetStatus: Status) {
    const start = index >= 0 ? index + 1 : 0;
    const ordered = [...positions.slice(start), ...positions.slice(0, start)];
    const hit = ordered.find(p => p.findings.some(f => f.status === targetStatus));
    const finding = hit?.findings.find(f => f.status === targetStatus);
    if (finding) onSelect(finding.check.rule.id, finding.itemIndex);
  }

  const firstAlert = useMemo(() => positions.findIndex(p => p.findings[0].status !== 'manual'), [positions]);
  const first = firstAlert < 0 ? 0 : firstAlert;

  return <div className="margin-notes">
    <header className="margin-heading margin-notes-header">
      <div className="margin-heading-row">
        <h2>页边批注</h2>
        {report && findings.length > 0 && <div className="margin-heading-actions">
          <button type="button" ref={listButton} className="note-list-toggle" aria-expanded={listOpen} aria-controls={listId}
            onClick={() => setListAnchor(listOpen ? null : { reportId: report.id, selection: selected })}>
            <List size={14} aria-hidden="true"/>{listOpen ? '返回批注' : `全部批注（${findings.length} 项）`}
          </button>
          {!listOpen && <nav className="note-navigation" aria-label="批注导航">
            <button type="button" aria-label="上一处批注" title="上一处批注" disabled={index <= 0} onClick={() => navigate(index - 1)}><ChevronLeft size={15}/></button>
            <span>{index < 0 ? `共 ${positions.length} 处` : `${index + 1} / ${positions.length}`}</span>
            <button type="button" aria-label="下一处批注" title="下一处批注" disabled={index >= positions.length - 1} onClick={() => navigate(index < 0 ? first : index + 1)}><ChevronRight size={15}/></button>
          </nav>}
        </div>}
      </div>
      {positions.length > 0 && <div className="margin-summary-strip" aria-label="位置与问题计数">
        <span className="sum-positions">{positions.length} 处位置</span>
        {counts.fail > 0 && <button type="button" className="sum-chip fail" onClick={() => jumpToStatus('fail')}>{counts.fail} 项明确不符</button>}
        {counts.warning > 0 && <button type="button" className="sum-chip warning" onClick={() => jumpToStatus('warning')}>{counts.warning} 项建议调整</button>}
        {counts.manual > 0 && <button type="button" className="sum-chip manual" onClick={() => jumpToStatus('manual')}>{counts.manual} 项待核对</button>}
      </div>}
    </header>

    <ol className="margin-list" id={listId} ref={list} aria-label="全部批注" hidden={!listOpen}>
      {listOpen && report && findings.map(finding => {
        const { check, item, itemIndex, status } = finding;
        const excerpt = item?.formatSpan?.text ?? item?.location.excerpt;
        return <li key={explanationKey(report.id, check.rule.id, itemIndex)}>
          <button type="button" className="margin-list-item" aria-current={activeFinding === finding ? true : undefined}
            onClick={() => {
              setListAnchor(null);
              onSelect(check.rule.id, itemIndex);
              listButton.current?.focus({ preventScroll: true });
            }}>
            <span className="margin-list-title">
              <strong>{noteTitle(finding)}</strong>
              <span className={`note-status ${status}`}>{LABELS[status]}</span>
            </span>
            <span className="margin-list-context">
              <span>{item ? prettyItemPosition(check.rule, item) : '整份材料'}</span>
              {excerpt && <q>{excerpt.slice(0, 32)}{excerpt.length > 32 || item?.formatSpan?.truncated ? '…' : ''}</q>}
            </span>
          </button>
        </li>;
      })}
    </ol>
    <div className="margin-body" hidden={listOpen}>
      {current && report ? (
        <div className="margin-track">
          <div className={`note-content status-${activeFinding?.status ?? 'manual'}`} role="region" aria-label="当前批注" aria-live="polite">
            <p className="note-location">
              <span>{activeFinding?.item ? prettyItemPosition(activeFinding.check.rule, activeFinding.item) : current.location ? prettyPosition(current.location) : '整份材料'}</span>
              {current.findings.length > 1 && <span className="note-location-count">· {current.findings.length} 项</span>}
              {canLocate && activeFinding && <button type="button" className="note-locate"
                onClick={() => onSelect(activeFinding.check.rule.id, activeFinding.itemIndex)}>
                <LocateFixed size={13} aria-hidden="true"/>定位原文
              </button>}
            </p>
            {activeFinding && (
              <Finding key={explanationKey(report.id, activeFinding.check.rule.id, activeFinding.itemIndex)} finding={activeFinding} report={report} controls={controls} onSelect={onSelect}/>
            )}
          </div>

          {current.findings.length > 1 && (
            <div className="related-findings" aria-label="同一位置的其他批注">
              <p className="related-heading">同一位置的其他批注</p>
              <div className="related-list">
                {current.findings.filter(f => f !== activeFinding).map(f => {
                  const vals = marginValues(f);
                  return (
                    <button type="button" className="related-row" key={explanationKey(report.id, f.check.rule.id, f.itemIndex)} onClick={() => onSelect(f.check.rule.id, f.itemIndex)}>
                      <span className={`dot ${f.status}`} aria-hidden="true"/>
                      <span className="related-title">
                        {noteTitle(f)}
                        {f.item?.formatSpan && <q>{f.item.formatSpan.text.slice(0, 24)}{(f.item.formatSpan.text.length > 24 || f.item.formatSpan.truncated) && '…'}</q>}
                      </span>
                      {vals?.expected && <span className="related-pair">{vals.observed} → {vals.expected}</span>}
                      <ChevronRight size={14} className="related-chevron" aria-hidden="true"/>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : !report ? (
        <div className="margin-guide">
          <p className="guide-lead">上传后，点选原文标记查看批注。</p>
          <ol className="guide-steps">
            <li>
              <span className="step-num">01</span>
              <div><strong>上传原稿</strong><p>支持 Word 与 PDF，仅在本地浏览器解析，不改动原文件。</p></div>
            </li>
            <li>
              <span className="step-num">02</span>
              <div><strong>点选红笔标记</strong><p>左侧定位到具体段落或词句，右侧查看实测偏差与《撰写指南》原页。</p></div>
            </li>
            <li>
              <span className="step-num">03</span>
              <div><strong>修改后重传对比</strong><p>在 Word/WPS 调整后重新上传，在「对比」里核对哪些问题未再检出。</p></div>
            </li>
          </ol>
          <a className="guide-pdf-link" href={publicAsset('rules/guide.pdf')} target="_blank" rel="noreferrer">
            <span>查看《学院撰写指南》原文 (PDF)</span><ExternalLink size={13}/>
          </a>
        </div>
      ) : (
        <div className="margin-placeholder">
          <p>{!positions.length ? '本次检查没有可列出的批注。' : firstAlert < 0 ? '当前仅有待人工核对的项目。' : '点选原文标记，查看这一处的问题和修改建议。'}</p>
          {!positions.length && report.checks.some(c => !c.executed && c.status === 'manual') && <p>待人工核对项可在「更多工具 → 完整检查记录」中查看。</p>}
          {positions.length > 0 && <button type="button" className="note-start" onClick={() => navigate(first)}>
            {firstAlert < 0 ? '查看待核对项' : '查看第一处批注'} <ArrowRight size={14}/>
          </button>}
        </div>
      )}
    </div>
  </div>;
}
