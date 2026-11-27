import { useState } from 'react';
import { ChevronRight, Download, FileText } from 'lucide-react';
import { CHANGE_LABELS, compareVersions, occurrenceLabel, versionProvenance, type VersionSnapshot, type ChangeKind } from '../domain/versions';
import { LABELS, STAGES } from '../domain/types';
import { downloadJson } from '../utils';

interface Props {
  versions: VersionSnapshot[];
  current: VersionSnapshot | null;
  baseline: VersionSnapshot | null;
  onBaseline: (id: string | null) => void;
  onView: (snapshot: VersionSnapshot) => void;
  onSelect: (id: string, item: number) => void;
  locked: boolean;
}

const time = (s: string) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
}).format(new Date(s));


export function VersionsPanel({ versions, current, baseline, onBaseline, onView, onSelect, locked }: Props) {
  const [filter, setFilter] = useState<ChangeKind | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const comparison = baseline && current ? compareVersions(baseline, current) : null;
  const isBaseline = baseline?.result.report.id === current?.result.report.id;

  return <div className="versions-panel">
    <div className="baseline-bar">
      <div className="baseline-summary">
        <span className="baseline-label">对照</span>
        <span className="baseline-name" title={baseline ? baseline.result.report.document.name : '未选择'}>
          {baseline ? `${baseline.result.report.document.name} · ${time(baseline.result.report.createdAt)}` : '尚未设定对照版本'}
        </span>
        {versions.length > 0 && (
          <button type="button" className="inline-link" onClick={() => setPicking(v => !v)}>
            {picking ? '收起' : '切换'}
          </button>
        )}
      </div>

      {current && <div className="baseline-summary">
        <span className="baseline-label">本版</span>
        <span className="baseline-name" title={current.result.report.document.name}>
          {current.result.report.document.name} · {time(current.result.report.createdAt)}
        </span>
      </div>}

      {(picking || !baseline) && versions.length > 0 && (
        <div className="baseline-controls">
          <select id="baseline-version" aria-label="对照版本" disabled={locked} value={baseline?.result.report.id || ''} onChange={e => { onBaseline(e.target.value || null); setPicking(false); }}>
            <option value="">未选择对照版本</option>
            {versions.map(v => (
              <option key={v.result.report.id} value={v.result.report.id}>
                {v.result.report.document.name} · {time(v.result.report.createdAt)}
              </option>
            ))}
          </select>
          {current && !isBaseline && (
            <button type="button" className="compact-btn" disabled={locked} onClick={() => { onBaseline(current.result.report.id); setPicking(false); }}>
              将当前版本设为对照
            </button>
          )}
        </div>
      )}
      {isBaseline && <p className="version-hint">已将当前版本设为对照，修改后重新上传即可查看逐项变化。</p>}
    </div>

    {comparison && !isBaseline && <section className="comparison-results" aria-label="版本比较结果">
      {!comparison.comparable ? (
        <div className="comparison-blocked">
          <strong>这两版不能直接判断修正情况</strong>
          <ul>{comparison.reasons.map(r => <li key={r}>{r}</li>)}</ul>
          <p>请使用相同阶段、规则与引擎重新检查两份材料。</p>
        </div>
      ) : <>
        {comparison.sameFile && <p className="version-hint">两版文件哈希一致，内容未发生变化。</p>}

        <div className="underline-filters" role="tablist" aria-label="按变化筛选">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部 <span>{comparison.rows.length}</span>
          </button>
          {(Object.keys(CHANGE_LABELS) as ChangeKind[]).map(kind => {
            const count = comparison.rows.filter(r => r.kind === kind).length;
            if (!count && filter !== kind) return null;
            return (
              <button key={kind} type="button" className={filter === kind ? 'active' : ''} onClick={() => setFilter(kind)}>
                {CHANGE_LABELS[kind]} <span>{count}</span>
              </button>
            );
          })}
          <button type="button" className="export-inline" title="导出版本对照 JSON" onClick={() => downloadJson({ schema: 'thesis-comparison-0.1', before: versionProvenance(baseline!), after: versionProvenance(current!), ...comparison }, '论文版本对照.json')}>
            <Download size={13}/><span>导出</span>
          </button>
        </div>

        <div className="compact-diff-list">
          {comparison.rows.filter(r => filter === 'all' || r.kind === filter).map((row, idx) => {
            const open = expandedId === null ? idx === 0 : expandedId === row.id;
            const beforeText = row.before ? LABELS[row.before.status] : '无';
            const afterText = row.after ? LABELS[row.after.status] : '无';
            const transition = row.kind === 'not_observed'
              ? `${occurrenceLabel(row.before)} → 未检出`
              : row.kind === 'newly_observed'
                ? `新增 · ${occurrenceLabel(row.after)}`
                : `${CHANGE_LABELS[row.kind]} · ${occurrenceLabel(row.after)}`;

            return (
              <article className={`diff-row ${row.kind}${open ? ' open' : ''}`} key={row.id}>
                <button type="button" className="diff-row-head" aria-expanded={open} onClick={() => setExpandedId(open ? '' : row.id)}>
                  <span className={`diff-dot ${row.kind}`} aria-hidden="true"/>
                  <span className="diff-title">{row.title}</span>
                  <span className="diff-transition">{transition}</span>
                  <ChevronRight size={13} className="diff-chevron" aria-hidden="true"/>
                </button>
                {open && (
                  <div className="diff-row-detail">
                    <div className="diff-meta-line">
                      <span>对照：{beforeText}（{occurrenceLabel(row.before)}）</span>
                      <span>→</span>
                      <span>本版：{afterText}（{occurrenceLabel(row.after)}）</span>
                    </div>
                    <p>{row.reason}</p>
                    {row.after && (
                      <button type="button" className="inline-link" onClick={() => {
                        const c = row.after!;
                        const item = c.items.findIndex(i => i.status === c.status);
                        onSelect(row.id, Math.max(0, item));
                      }}>查看本版检查证据</button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {!comparison.rows.length && <p className="version-hint">未发现可列出的规则结论变化；不代表全文没有问题或已完成复核。</p>}
        </div>

        <p className="version-footnote">{comparison.basis}</p>
      </>}
    </section>}

    <div className="history-section">
      <div className="history-heading">
        <h4>本次会话记录</h4>
        <span>{versions.length} / 5</span>
      </div>
      <div className="history-list">
        {[...versions].reverse().map(v => {
          const report = v.result.report;
          const active = report.id === current?.result.report.id;
          const base = report.id === baseline?.result.report.id;
          return (
            <article className={`history-item${active ? ' active' : ''}`} key={report.id}>
              <div className="history-item-main">
                <FileText size={14} className="history-icon" aria-hidden="true"/>
                <div className="history-info">
                  <strong title={report.document.name}>{report.document.name}</strong>
                  <span className="history-sub">{STAGES[report.stage]} · {time(report.createdAt)}{active ? ' · 当前' : ''}{base ? ' · 对照' : ''}</span>
                </div>
              </div>
              <div className="history-actions">
                {!active && <button type="button" disabled={locked} onClick={() => onView(v)}>查看</button>}
                {!base && <button type="button" disabled={locked} onClick={() => onBaseline(report.id)}>设为对照</button>}
              </div>
            </article>
          );
        })}
        {!versions.length && <p className="version-hint">检查第一份材料后，记录会出现在这里。</p>}
      </div>
      <p className="version-footnote">仅保存在当前页面内存（最多 5 份 / 160 MiB），刷新即清空，不是教师提交记录。</p>
    </div>
  </div>;
}
