import { useEffect, useRef, useState } from 'react';
import { Download, X, CheckCircle2, CircleDashed, Cpu, BookOpen, ScanLine, FlaskConical } from 'lucide-react';
import { MODELS, RECOGNITION_ADAPTERS, validateSettings } from '../domain/config';
import { STAGES, type RulePack, type Settings, type Skill, type Stage } from '../domain/types';
import type { Capability, ModelState } from '../model/runtime';
import { downloadJson, publicAsset } from '../utils';

interface Props { settings: Settings; onApply: (settings: Settings) => void; onClose: () => void; pack: RulePack | null; skill: Skill | null; stage: Stage; capability: Capability | null; modelState: ModelState; offlineReady: boolean; onLoadModel: () => void; onCancelModel: () => void }
export function Configuration({ settings, onApply, onClose, pack, skill, stage, capability, modelState, offlineReady, onLoadModel, onCancelModel }: Props) {
  const [tab, setTab] = useState('model'); const [draft, setDraft] = useState(settings); const [error, setError] = useState(''); const [json, setJson] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  useEffect(() => {
    const previous = returnFocus.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') || []].filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  function apply() { try { onApply(validateSettings(draft)); onClose(); } catch (e) { setError(String((e as Error).message)); } }
  const tabs = [{ id: 'model', name: '本地模型', icon: Cpu }, { id: 'rules', name: '规范与 Skill', icon: BookOpen }, { id: 'recognition', name: '识别组件', icon: ScanLine }, { id: 'training', name: '微调准备', icon: FlaskConical }];
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} className="config-dialog" role="dialog" aria-modal="true" aria-labelledby="config-title">
    <header><div><span className="eyebrow">ENGINE CONFIGURATION</span><h2 id="config-title">审核引擎配置</h2></div><button className="icon-button" autoFocus aria-label="关闭配置" onClick={onClose}><X/></button></header>
    <div className="config-body"><nav className="config-tabs" aria-label="配置分类">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={17}/>{t.name}</button>)}</nav><div className="config-content">
      {tab === 'model' && <><h3>浏览器内运行，模型由产品加载</h3><p className="muted">首次准备需要下载模型资源；规则检查可独立运行。内存为预置配置估计，不是整机总占用。</p>
        <label>模型版本<select value={draft.modelId} onChange={e => setDraft({ ...draft, modelId: e.target.value })}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.name} · {m.download} · {m.role}</option>)}</select></label>
        <div className="field-grid"><label>上下文预算<select value={draft.contextWindow} onChange={e => setDraft({ ...draft, contextWindow: Number(e.target.value) as 2048 | 4096 })}><option value={2048}>2048 tokens</option><option value={4096}>4096 tokens</option></select></label><label>最大输出 tokens<input type="number" min={128} max={800} step={32} value={draft.maxTokens} onChange={e => setDraft({ ...draft, maxTokens: Number(e.target.value) })}/></label></div>
        <label>温度（0–0.5）<input type="number" min={0} max={.5} step={.1} value={draft.temperature} onChange={e => setDraft({ ...draft, temperature: Number(e.target.value) })}/></label>
        <label className="checkbox-label"><input type="checkbox" checked={draft.autoLoadCached} onChange={e => setDraft({ ...draft, autoLoadCached: e.target.checked })}/>下次打开时自动尝试加载已有缓存的模型</label>
        <div className="config-info"><strong>{capability?.webgpu ? 'WebGPU 适配器可用' : 'WebGPU 尚未就绪'}</strong><p>{capability?.device || '检测中'}；单缓冲上限约 {capability?.maxBufferMB || 0} MB</p><p>页面离线资源：{offlineReady ? '已缓存' : '未确认（开发模式不启用离线缓存）'}</p><p>模型状态：{modelState.phase}。缓存存在不等于已完成离线推理验证。</p></div>
        <div className="model-runtime-actions"><p role="status">{modelState.text}</p>
          {modelState.phase === 'loading' && <progress aria-label="模型下载进度" value={modelState.progress} max={1}/>}
          {['loading', 'ready', 'generating'].includes(modelState.phase) ? <button className="secondary" onClick={onCancelModel}>{modelState.phase === 'loading' ? '取消加载' : '停止并释放模型'}</button> :
            <button className="secondary" disabled={draft.modelId !== settings.modelId || draft.contextWindow !== settings.contextWindow} onClick={onLoadModel}>加载本地模型</button>}
        </div>
        <details className="technical"><summary>加载进度与错误详情</summary><pre>{modelState.text}{modelState.error ? `\n${modelState.error}` : ''}</pre></details>
        <details className="technical"><summary>导入 / 导出运行配置</summary><button className="secondary" onClick={() => downloadJson(draft, '论文审核运行配置.json')}><Download size={16}/>导出配置</button><textarea aria-label="运行配置JSON" value={json} onChange={e => setJson(e.target.value)} placeholder="粘贴之前导出的运行配置 JSON"/><button className="secondary" onClick={() => { try { setDraft(validateSettings(JSON.parse(json))); setError(''); } catch (e) { setError((e as Error).message); } }}>校验并载入草稿</button></details>
        <div className="config-info"><strong>云端模型：未启用</strong><p>DeepSeek接口保留为后续适配项。本版没有密钥输入或云端请求；统一Key需要代理服务。</p></div>
      </>}
      {tab === 'rules' && <><h3>{STAGES[stage]} · 学院依据与 Skill</h3><p className="muted">规范数值由版本化规则文件维护；本页可控制执行项目，关闭的项目会明确显示“未执行”。</p><div className="config-info"><strong>{pack?.title || '规则加载中'}</strong><p>规则版本 {pack?.version} · 待学院教师确认</p><a href={publicAsset('rules/guide.pdf')} target="_blank" rel="noreferrer">查看哈希绑定的学院依据</a></div>
        {skill && <div className="skill-box"><strong>{skill.name} · {skill.version}</strong><ol>{skill.instructions.map(t => <li key={t}>{t}</li>)}</ol><p>已注册工具：原生读取 → 规则核对 → 证据解释</p></div>}
        <div className="rule-switches">{pack?.rules.filter(r => r.stages.includes(stage)).map(r => <label className="rule-switch" key={r.id}><input type="checkbox" checked={!draft.disabledRules.includes(r.id)} onChange={e => setDraft({ ...draft, disabledRules: e.target.checked ? draft.disabledRules.filter(id => id !== r.id) : [...draft.disabledRules, r.id] })}/><span>{r.title}<small>{r.id} · 指南第{r.source.pdf_page}页</small></span></label>)}</div>
      </>}
      {tab === 'recognition' && <><h3>识别能力逐项登记</h3><p className="muted">发现对象与审核对象是两种能力。尚未接入的模型不会自动显示通过。</p>{RECOGNITION_ADAPTERS.map(a => <article className="adapter" key={a.id}><div>{a.state === 'ready' ? <CheckCircle2 size={18}/> : <CircleDashed size={18}/>}<strong>{a.name}</strong><span>{a.state === 'ready' ? '已接入' : '待接入'}</span></div><p>{a.detail}</p></article>)}</>}
      {tab === 'training' && <><h3>先建立基线，再做学院微调</h3><p>当前使用的是原始开源模型，尚未经过学院论文数据微调。网页仅运行推理，不在学生电脑上启动训练。</p><ol className="training-steps"><li>收集可用于训练的去标识“原文＋规范＋教师意见”样例。</li><li>按论文划分训练、验证和独立测试材料，保留正确与不确定样例。</li><li>比较现成模型＋Skill与微调后的误报、漏报、解释质量。</li><li>开发侧训练，合并及量化，转换和编译后发布新模型版本。</li></ol>
        <button className="secondary" onClick={() => downloadJson({ status: 'example_not_trained', base_model: draft.modelId.includes('1.7B') ? 'Qwen/Qwen3-1.7B' : draft.modelId.includes('0.6B') ? 'Qwen/Qwen3-0.6B' : 'Qwen/Qwen3-4B', method: 'supervised_finetuning_with_lora', dataset: null, split_policy: 'by_document_not_by_paragraph', targets: ['column_classification', 'evidence_explanation', 'uncertainty'], deployment: 'merge_quantize_convert_compile_mlc_then_evaluate', output_contract: 'explanations[{issue_id,explanation,steps}]' }, '学院微调配置草案.json')}><Download size={16}/>导出微调配置草案</button><div className="config-info">这份配置只明确训练目标与发布路径，缺少教师标注数据，不能直接宣称已经训练完成。</div>
      </>}
      {error && <p role="alert" className="error-box">{error}</p>}
    </div></div><footer><p>更换模型或上下文后需要重新加载；规则开关改变后需要重新检查。</p><button className="primary" onClick={apply}>保存配置</button></footer>
  </section></div>;
}
