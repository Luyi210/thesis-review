import type { Location, Report, Status } from '../domain/types';
import { prettyPosition } from '../utils';

interface Props { report: Report; onLocate: (location: Location) => void }
const NAMES = { image: '图片 / 绘图', table: '原生表格', formula: '原生公式', embedded: '嵌入对象' };
const RESULT: Partial<Record<Status, string>> = { pass: '已核对', fail: '明确偏差', manual: '待人工确认' };
export function CoveragePanel({ report, onLocate }: Props) {
  const structure = report.structure;
  const positional = report.checks.find(c => c.rule.mode === 'caption_position');
  const numbering = report.checks.find(c => c.rule.mode === 'caption_number');
  const objects = [...report.document.objects].sort((a, b) => (a.location.paragraph || 0) - (b.location.paragraph || 0));
  const linked = structure?.objects.filter(o => o.caption).length || 0;
  return <section className="object-coverage" aria-label="图表公式覆盖清单">
    <header><h4>图表与公式覆盖</h4><span>{objects.length} 个主文档原生对象 · {linked} 个题注关联</span></header>
    <p>对象被发现，不等于已完成审核。题注关联只覆盖可确定的原生结构。</p>
    {report.document.format === 'pdf' && <div className="coverage-empty">PDF 图表与公式尚未结构化识别；“0 个原生对象”不代表文件里没有图表或公式。</div>}
    {report.document.format === 'docx' && !objects.length && <div className="coverage-empty">本次未发现受支持的原生对象；图片中的公式等内容仍可能需要人工检查。</div>}
    {objects.map((object, index) => {
      const r = structure?.objects.find(r => r.objectId === object.id);
      const applicable = object.kind === 'image' || object.kind === 'table';
      const label = (check: typeof positional, status: Status | undefined) => !check || check.status === 'not_applicable' ? '本阶段不适用' : !check.executed ? '未执行' : RESULT[status || 'manual'];
      return <article key={object.id || index} className="object-row">
        <div className="object-row-title"><strong>{NAMES[object.kind]}</strong><small>{prettyPosition(object.location)}</small></div>
        <p>{object.detail}</p>
        {applicable ? <div className="object-results"><span>题注顺序：{label(positional, r?.position)}</span><span>分章编号：{label(numbering, r?.numbering)}</span></div> : <div className="object-results"><span>已发现并定位 · 内容审核未执行</span></div>}
        {r?.captionText && <blockquote>{r.captionText}</blockquote>}
        <p className="coverage-reason">{r?.reason || '结构关联未完成。'}{r?.numberReason ? ` ${r.numberReason}` : ''}</p>
        <div className="object-links"><button onClick={() => onLocate(object.location)}>定位对象</button>{r?.caption && <button onClick={() => onLocate(r.caption!)}>定位题注</button>}</div>
      </article>;
    })}
    {!!structure?.orphanCaptions.length && <p>另有 {structure.orphanCaptions.length} 处题注线索未唯一关联，见题注检查项；这些线索未计为完成核对。</p>}
    <details className="coverage-note"><summary>查看未覆盖范围与读取限制</summary><ul>{report.document.limitations.map((l, i) => <li key={i}>{l.message}</li>)}</ul><p>三线表、跨页关系、图片OCR、公式排版与数学正确性未审核；实际分页请核对 Word/WPS。</p></details>
  </section>;
}
