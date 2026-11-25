import { useState } from 'react';
import { LABELS, type Check, type Report, type Status } from '../domain/types';
import type { ModelEvidence } from '../model/runtime';
import { prettyPosition, publicAsset } from '../utils';

interface Props {
  report: Report;
  explanations: Record<string, ModelEvidence>;
  canExplain: boolean;
  onExplain: (check: Check) => void;
  onSelect: (id: string, item: number) => void;
}
export function FullReport({ report, explanations, canExplain, onExplain, onSelect }: Props) {
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = report.checks.filter(c => filter === 'all' ? c.status !== 'not_applicable' : c.status === filter);
  return <div className="full-report">
    <label>检查结果 <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
      <option value="all">全部适用项目</option>
      {Object.entries(LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    {rows.map(check => {
      const id = check.rule.id;
      const explanation = explanations[id]?.explanations[0];
      return <article className="record-row" key={id}>
        <button className="record-title" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
          <small>{check.executed ? LABELS[check.status] : check.status === 'not_applicable' ? '不适用' : '未执行'}</small>{check.rule.title}
        </button>
        {open === id && <div className="record-detail">
          <p>{check.summary}</p>
          {check.items.map((item, i) => <button className="record-location" key={i} onClick={() => onSelect(id, i)}>
            {prettyPosition(item.location)} · {LABELS[item.status]}<br/>{item.observed}{item.expected && ' → ' + item.expected}
          </button>)}
          <blockquote>{check.rule.source.quote}</blockquote>
          <a href={publicAsset('rules/guide.pdf#page=' + check.rule.source.pdf_page)} target="_blank" rel="noreferrer">《撰写指南》第 {check.rule.source.pdf_page} 页</a>
          {explanation && <div><strong>本地模型解释 · 待核实</strong><p>{explanation.explanation}</p><ol>{explanation.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
          {check.status !== 'not_applicable' && <button className="text-button" disabled={!canExplain} title="可在更多 → 引擎配置中加载本地模型" onClick={() => onExplain(check)}>用本地模型解释本项</button>}
        </div>}
      </article>;
    })}
    {!rows.length && <p>此分类暂无记录。</p>}
  </div>;
}
