import { useState } from 'react';
import { Clock3, GitCompareArrows, FileText, Download } from 'lucide-react';
import { CHANGE_LABELS, compareVersions, occurrenceLabel, versionProvenance, type VersionSnapshot, type ChangeKind } from '../domain/versions';
import { LABELS, STAGES } from '../domain/types';
import { downloadJson } from '../utils';

interface Props { versions: VersionSnapshot[]; current: VersionSnapshot | null; baseline: VersionSnapshot | null; onBaseline: (id: string | null) => void; onView: (snapshot: VersionSnapshot) => void; onSelect: (id: string, item: number) => void; locked: boolean }
const time = (s: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(s));
export function VersionsPanel({ versions, current, baseline, onBaseline, onView, onSelect, locked }: Props) {
  const [filter, setFilter] = useState<ChangeKind | 'all'>('all');
  const comparison = baseline && current ? compareVersions(baseline, current) : null;
  const isBaseline = baseline?.result.report.id === current?.result.report.id;
  return <div className="versions-panel">
    <div className="section-intro"><GitCompareArrows size={22}/><h3>看见每次修改的变化</h3><p>先将一版设为对照，再选择修改后的文件检查。请自行确认两份材料属于同一篇论文。</p></div>
    <div className="baseline-picker"><label htmlFor="baseline-version">对照版本</label><select id="baseline-version" aria-label="对照版本" disabled={locked} value={baseline?.result.report.id || ''} onChange={e => onBaseline(e.target.value || null)}><option value="">未选择对照版本</option>{versions.map(v => <option key={v.result.report.id} value={v.result.report.id}>{v.result.report.document.name} · {time(v.result.report.createdAt)}</option>)}</select></div>
    {current && <button className="secondary full-width" disabled={locked || isBaseline} onClick={() => onBaseline(current.result.report.id)}>{isBaseline ? '当前版本已设为对照' : '将当前版本设为对照'}</button>}
    {isBaseline && <p className="version-hint">对照版本已固定。选择修改后的文件，检查完成后即可看到变化。</p>}
    {comparison && !isBaseline && <section className="comparison-results" aria-label="版本比较结果">
      <div className="comparison-heading"><h4>对照结果</h4><button className="text-button" onClick={() => downloadJson({ schema: 'thesis-comparison-0.1', before: versionProvenance(baseline!), after: versionProvenance(current!), ...comparison }, '论文版本对照.json')}><Download size={15}/>导出对照</button></div>
      {!comparison.comparable ? <div className="comparison-blocked"><strong>这两版不能直接判断修正情况</strong><ul>{comparison.reasons.map(r => <li key={r}>{r}</li>)}</ul><p>请用相同阶段、规则与引擎重新检查两份材料。</p></div> : <>
        {comparison.sameFile && <div className="version-hint">两版文件哈希相同，文件内容没有变化；此次为重复检查。</div>}
        <div className="change-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {comparison.rows.length}</button>{Object.entries(CHANGE_LABELS).map(([kind, label]) => <button key={kind} className={filter === kind ? 'active' : ''} onClick={() => setFilter(kind as ChangeKind)}>{label} {comparison.rows.filter(r => r.kind === kind).length}</button>)}</div>
        <p className="version-disclaimer">{comparison.basis}</p>
        {comparison.rows.filter(r => filter === 'all' || r.kind === filter).map(row => <article className={`change-row ${row.kind}`} key={row.id}><div><span className="change-badge">{CHANGE_LABELS[row.kind]}</span><h4>{row.title}</h4></div><div className="change-values"><span>对照：{row.before ? LABELS[row.before.status] : '无记录'}<small>{occurrenceLabel(row.before)}</small></span><span>本版：{row.after ? LABELS[row.after.status] : '无记录'}<small>{occurrenceLabel(row.after)}</small></span></div><p>{row.reason}</p>{row.after && <button className="text-button" onClick={() => { const c = row.after!; const item = c.items.findIndex(i => i.status === c.status); onSelect(row.id, Math.max(0, item)); }}>查看本版检查证据</button>}</article>)}
        {!comparison.rows.length && <p className="version-hint">未发现可列出的规则结论变化；不代表全文没有问题或已完成复核。</p>}
      </>}
    </section>}
    <div className="history-heading"><h4><Clock3 size={16}/>本次会话的检查记录</h4><span>{versions.length} / 5</span></div>
    <p className="session-note">仅在当前页面内存保存，刷新即清空；最多保留5份、原文件合计160 MiB。对照版受保护，较早的其他记录可能被释放。不是教师提交记录。</p>
    {[...versions].reverse().map(v => {
      const report = v.result.report; const active = report.id === current?.result.report.id; const base = report.id === baseline?.result.report.id;
      return <article className={`history-row ${active ? 'active' : ''}`} key={report.id}><FileText size={18}/><div><strong>{report.document.name}</strong><p>{STAGES[report.stage]} · {report.kind === 'thesis' ? '论文稿' : '阶段报告'} · {time(report.createdAt)}</p><small>SHA-256 {report.document.sha256.slice(0, 12)} · {report.engine}</small><div className="history-flags">{active && <span>当前查看</span>}{base && <span>对照版本</span>}</div><div className="history-actions"><button disabled={locked || active} onClick={() => onView(v)}>查看该版</button><button disabled={locked || base} onClick={() => onBaseline(report.id)}>设为对照</button></div></div></article>;
    })}
    {!versions.length && <p className="version-hint">检查第一份材料后，记录会出现在这里。</p>}
  </div>;
}
