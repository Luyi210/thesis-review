import { createContext, useContext, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LABELS, STAGES, type Report } from '../domain/types';
import type { MarginFinding } from '../domain/marginNotes';
import {
  FEEDBACK_TEXT_LIMIT, accuracyNames, adviceNames, checkedLabels, emptyLabels, feedbackExport,
  findingFeedbackKey, reportMissed, reviewFinding, saveFeedback, suggestionSnapshot, teacherRewriteDraft,
  type Accuracy, type AdviceRating, type AdviceSnapshot, type FeedbackEntry, type FeedbackModelAdvice,
  type MissedFinding, type ReviewedFinding, type ReviewLabels,
} from '../domain/feedback';
import { downloadJson, prettyPosition } from '../utils';
import './teacherFeedback.css';

interface Session {
  entries: FeedbackEntry[];
  save: (entry: FeedbackEntry) => void;
  remove: (key: string) => void;
}
const FeedbackContext = createContext<Session | null>(null);

export function TeacherFeedbackProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  // One synchronous copy also protects rapid saves made from different forms.
  const latest = useRef(entries);
  function replace(next: FeedbackEntry[]) {
    latest.current = next;
    setEntries(next);
  }
  return <FeedbackContext.Provider value={{ entries,
    save: entry => replace(saveFeedback(latest.current, entry)),
    remove: key => replace(latest.current.filter(entry => entry.key !== key)),
  }}>{children}</FeedbackContext.Provider>;
}

type RatedSuggestion = { value: AdviceSnapshot | null; label: string };
function ReviewForm({ initial, options, errorStatus, onSave }: {
  initial: ReviewLabels; options: RatedSuggestion[]; errorStatus: boolean;
  onSave: (labels: ReviewLabels, suggestion: AdviceSnapshot | null) => void;
}) {
  const [labels, setLabels] = useState(initial);
  const [rated, setRated] = useState(options[0]);
  const [message, setMessage] = useState('');
  // Keep the selected wording stable when the model is reloaded or the saved
  // suggestion is reordered. Ratings must still refer to the text reviewed.
  const option = options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(rated.value));
  const choices = option < 0 ? [...options, rated] : options;
  const suggestion = rated.value;
  function change(next: Partial<ReviewLabels>) {
    setLabels(previous => ({ ...previous, ...next }));
    setMessage('');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    try { onSave(checkedLabels(labels, suggestion), suggestion); setMessage('已记录在本次会话。'); }
    catch (err) { setMessage((err as Error).message); }
  }
  const accuracyChoices: Accuracy[] = ['unrated', 'correct', errorStatus ? 'false_positive' : 'incorrect', 'uncertain'];
  return <form className="feedback-form" onSubmit={submit}>
    <label>问题判断<select value={labels.accuracy} onChange={e => change({ accuracy: e.target.value as Accuracy })}>
      {accuracyChoices.map(value => <option key={value} value={value}>{accuracyNames[value]}</option>)}
    </select></label>
    {choices.length > 1 ? <label>评价哪条建议<select value={option < 0 ? choices.length - 1 : option} onChange={e => { setRated(choices[Number(e.target.value)]); change({ advice: 'unrated', replacement: '' }); }}>
      {choices.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
    </select></label> : <p className="feedback-meta">{rated.label}</p>}
    {suggestion && <details className="feedback-quote"><summary>查看本次评价的建议</summary><p>{suggestion.text}</p>
      {suggestion.source === 'model' && <ol>{suggestion.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
    </details>}
    <label>修改建议<select value={labels.advice} onChange={e => change({ advice: e.target.value as AdviceRating })}>
      <option value="unrated">{adviceNames.unrated}</option>
      {suggestion && <option value="usable">{adviceNames.usable}</option>}
      <option value="rewrite">{adviceNames.rewrite}</option>
    </select></label>
    {labels.advice === 'rewrite' && <label>你会怎样建议学生修改？<textarea required maxLength={FEEDBACK_TEXT_LIMIT}
      value={labels.replacement} onChange={e => change({ replacement: e.target.value })}/></label>}
    <label>判断说明（可选）<textarea maxLength={FEEDBACK_TEXT_LIMIT}
      value={labels.comment} onChange={e => change({ comment: e.target.value })}/></label>
    <button type="submit" className="feedback-save">保存反馈</button>
    <p className="feedback-status" role="status">{message}</p>
  </form>;
}

interface FindingProps { report: Report; finding: MarginFinding; modelAdvice?: FeedbackModelAdvice }
const sourceLabel = (s: AdviceSnapshot | null) => !s ? '此处暂无修改建议' :
  s.source === 'model' ? '本地模型建议 · ' + s.modelId : '页边规则建议';

function FeedbackDisclosure({ saved, children }: { saved: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="finding-feedback" onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>教师反馈{saved && ' · 已记录'}</summary>{expanded && children}
  </details>;
}

export function FindingFeedback({ report, finding, modelAdvice }: FindingProps) {
  const session = useContext(FeedbackContext);
  if (!session) return null;
  const key = findingFeedbackKey(report.id, finding.check.rule.id, finding.itemIndex);
  const existing = session.entries.find((entry): entry is ReviewedFinding => entry.key === key && entry.type === 'finding');
  const ruleAdvice = suggestionSnapshot(report, finding);
  const options: RatedSuggestion[] = [];
  for (const suggestion of [existing?.reviewedAdvice, ruleAdvice, modelAdvice && suggestionSnapshot(report, finding, modelAdvice)]) {
    if (suggestion === undefined || options.some(o => JSON.stringify(o.value) === JSON.stringify(suggestion))) continue;
    options.push({ value: suggestion, label: suggestion?.source === 'model' && existing?.reviewedAdvice === suggestion ? '已记录 · ' + sourceLabel(suggestion) : sourceLabel(suggestion) });
  }
  return <FeedbackDisclosure key={key} saved={Boolean(existing)}>
    <ReviewForm key={key} initial={existing?.labels ?? emptyLabels} options={options}
      errorStatus={finding.status === 'fail' || finding.status === 'warning'}
      onSave={(labels, suggestion) => session.save(reviewFinding(report, finding, labels, suggestion))}/>
  </FeedbackDisclosure>;
}

function FindParagraph({ report, choose }: { report: Report; choose: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [];
    const options: { number: number; snippet: string }[] = [];
    for (const p of report.document.paragraphs) {
      const start = p.text.indexOf(needle);
      if (start < 0) continue;
      const left = Math.max(start - 12, 0);
      options.push({ number: p.index, snippet: p.text.slice(left, start + needle.length + 20) });
      if (options.length === 8) break;
    }
    return options;
  }, [report, query]);
  return <details className="feedback-quote"><summary>按原文查找段号</summary>
    <label>原文片段<input type="search" maxLength={100} value={query}
      onChange={e => setQuery(e.target.value)}/></label>
    {query.trim() && !matches.length && <p>未找到含此片段的段落。</p>}
    {matches.map(m => <button type="button" className="feedback-match" key={m.number} onClick={() => {
      choose(String(m.number)); setQuery('');
    }}>源段落 {m.number} · {m.snippet}</button>)}
    {matches.length === 8 && <small>已显示前 8 处，可输入更多文字缩小范围。</small>}
  </details>;
}

function MissedForm({ report, existing, onSave }: {
  report: Report | null; existing?: MissedFinding; onSave: (entry: MissedFinding) => void;
}) {
  const [position, setPosition] = useState(String(existing?.location.page ?? existing?.location.paragraph ?? ''));
  const [ruleId, setRuleId] = useState(existing?.rule?.id ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [message, setMessage] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      let record: MissedFinding;
      if (report) {
        record = reportMissed(report, { position, ruleId, description });
        if (existing) record.key = existing.key;
      } else {
        if (!existing || !description.trim()) throw new Error('请描述漏掉的问题。');
        record = { ...existing, updatedAt: new Date().toISOString(), description: description.trim() };
      }
      onSave(record);
      if (!existing) { setPosition(''); setRuleId(''); setDescription(''); }
      setMessage('漏报已记录在本次会话。');
    } catch (e) { setMessage((e as Error).message); }
  }
  return <form className="feedback-form" onSubmit={submit}>
    {report ? <>
      <label>{report.document.format === 'pdf' ? 'PDF 文件页码' : 'Word 源段号'}<input type="number" min="1" step="1" required
        max={report.document.format === 'pdf' ? report.document.pageCount : undefined} value={position}
        onChange={e => { setPosition(e.target.value); setMessage(''); }}/></label>
      {report.document.format === 'docx' && <FindParagraph report={report} choose={value => { setPosition(value); setMessage(''); }}/>}
      <label>相关规则（可选）<select value={ruleId} onChange={e => setRuleId(e.target.value)}><option value="">未指定</option>
        {report.checks.filter(c => c.status !== 'not_applicable').map(c => <option key={c.rule.id} value={c.rule.id}>{c.rule.title}</option>)}
      </select></label>
    </> : existing && <p>{prettyPosition(existing.location)} · {existing.rule?.title ?? '未指定规则'}</p>}
    <label>漏掉了什么？<textarea required maxLength={FEEDBACK_TEXT_LIMIT} value={description}
      onChange={e => { setDescription(e.target.value); setMessage(''); }}/></label>
    <button type="submit" className="feedback-save">保存漏报</button>
    <p className="feedback-status" role="status">{message}</p>
  </form>;
}

function recordLocation(entry: FeedbackEntry) {
  return prettyPosition(entry.type === 'missed' ? entry.location : entry.evidence.location ?? {});
}
function RecordEditor({ entry, current, session, onSelect }: {
  entry: FeedbackEntry; current: Report | null; session: Session; onSelect: (id: string, item: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  return <div className="feedback-existing">
    <p className="feedback-meta">{recordLocation(entry)} · {STAGES[entry.report.stage]} · {entry.report.format.toUpperCase()}
      {' · ' + new Date(entry.report.createdAt).toLocaleString('zh-CN', { hour12: false })} · {entry.report.fileHash.slice(0, 8)}</p>
    {entry.type === 'finding' ? <>
      <p>原判定 · {LABELS[entry.evidence.status]}</p>
      {(entry.evidence.observed || entry.evidence.expected) && <p>{entry.evidence.observed} {entry.evidence.expected && '→ ' + entry.evidence.expected}</p>}
      {entry.evidence.formatSpan && <blockquote>{entry.evidence.formatSpan.text}</blockquote>}
      {entry.evidence.reason && <p>{entry.evidence.reason}</p>}
      <p>问题判断 · {accuracyNames[entry.labels.accuracy]}</p><p>修改建议 · {adviceNames[entry.labels.advice]}</p>
      {entry.labels.replacement && <blockquote>{entry.labels.replacement}</blockquote>}
      {entry.labels.comment && <p>{entry.labels.comment}</p>}
    </> : <p>{entry.description}</p>}
    <div className="feedback-actions">
      {entry.type === 'finding' && current && <button type="button" onClick={() => onSelect(entry.rule.id, entry.itemIndex)}>查看对应批注</button>}
      <button type="button" onClick={() => setEditing(!editing)}>{editing ? '收起编辑' : '编辑反馈'}</button>
      <button type="button" onClick={() => session.remove(entry.key)}>移除这条反馈</button>
    </div>
    {editing && (entry.type === 'missed' ? <MissedForm existing={entry} report={current} onSave={e => { session.save(e); setEditing(false); }}/> :
      <ReviewForm initial={entry.labels} options={[{ value: entry.reviewedAdvice, label: sourceLabel(entry.reviewedAdvice) }]}
        errorStatus={entry.evidence.status === 'fail' || entry.evidence.status === 'warning'}
        onSave={labels => { session.save({ ...entry, labels, updatedAt: new Date().toISOString() }); setEditing(false); }}/>)}
  </div>;
}

export function FeedbackPanel({ report, onSelect }: {
  report: Report | null; onSelect: (id: string, item: number) => void;
}) {
  const session = useContext(FeedbackContext);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!session) return null;
  const visible = session.entries.filter(e => all || !report || e.report.id === report.id);
  const draft = teacherRewriteDraft(visible);
  return <div className="feedback-panel">
    <p className="feedback-meta">反馈保存在本次页面会话，刷新前可导出。导出文件包含所评位置的原文摘录和手工意见。</p>
    {report && <details key={report.id} className="missed-feedback"><summary>登记此稿的漏报</summary>
      <MissedForm report={report} onSave={session.save}/>
    </details>}
    <div className="feedback-tools">
      {report && <label>记录范围<select value={all ? 'all' : 'current'} onChange={e => setAll(e.target.value === 'all')}>
        <option value="current">当前检查</option><option value="all">本次会话全部</option>
      </select></label>}
      <button type="button" disabled={!session.entries.length} onClick={() => downloadJson(feedbackExport(session.entries), '教师复核反馈.json')}>
        导出全部反馈（{session.entries.length}）</button>
    </div>
    <details className="missed-feedback"><summary>准备微调样例</summary>
      <p className="feedback-meta">仅收录当前范围内已选“判得对”且由老师写下改法的具体批注。导出后请核对原文摘录和改写，并将同一篇论文的不同版本分在同一组。</p>
      <button type="button" className="feedback-save" disabled={!draft.examples.length}
        onClick={() => downloadJson(draft, '教师改写样例草案.json')}>导出教师改写（{draft.examples.length}）</button>
    </details>
    {!visible.length && <p>此范围还没有反馈记录。</p>}
    {[...visible].reverse().map(entry => <article className="feedback-entry" key={entry.key}>
      <button type="button" aria-expanded={open === entry.key} onClick={() => setOpen(open === entry.key ? null : entry.key)}>
        <span>{entry.type === 'missed' ? '漏报 · ' : ''}{entry.rule?.title ?? '手工登记'}</span>
        <small>{entry.report.id === report?.id ? '当前检查' : '历史检查'} · {recordLocation(entry)}</small>
      </button>
      {open === entry.key && <RecordEditor entry={entry} current={entry.report.id === report?.id ? report : null} session={session} onSelect={onSelect}/>}
    </article>)}
  </div>;
}
