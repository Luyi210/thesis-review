import { useState } from 'react';
import { LABELS, type Report, type Status } from '../domain/types';
import { prettyItemPosition } from '../utils';
import { RuleSource } from './RuleSource';

interface Props {
  report: Report;
  onSelect: (id: string, item: number) => void;
}
export function FullReport({ report, onSelect }: Props) {
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
      return <article className="record-row" key={id}>
        <button className="record-title" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
          <small>{check.executed ? LABELS[check.status] : check.status === 'not_applicable' ? '不适用' : '未执行'}</small>{check.rule.title}
        </button>
        {open === id && <div className="record-detail">
          <p>{check.summary}</p>
          {check.items.map((item, i) => <button className="record-location" key={i} onClick={() => onSelect(id, i)}>
            {prettyItemPosition(check.rule, item)} · {LABELS[item.status]}{item.formatSpan && <q>{item.formatSpan.text}{item.formatSpan.truncated && '…'}</q>}<br/>{item.observed}{item.expected && ' → ' + item.expected}
          </button>)}
          <blockquote>{check.rule.source.quote}</blockquote>
          <RuleSource source={check.rule.source}/>
          {check.executed && check.status !== 'not_applicable' && <button className="text-button" onClick={() => onSelect(id, -1)}>在页边查看整项记录</button>}
        </div>}
      </article>;
    })}
    {!rows.length && <p>此分类暂无记录。</p>}
  </div>;
}
