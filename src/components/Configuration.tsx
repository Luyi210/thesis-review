import { useEffect, useRef, useState } from 'react';
import { Download, X, CheckCircle2, CircleDashed, Cpu, BookOpen, ScanLine, FlaskConical } from 'lucide-react';
import { MODELS, RECOGNITION_ADAPTERS, validateSettings } from '../domain/config';
import { STAGES, type MaterialKind, type RulePack, type Settings, type Skill, type Stage } from '../domain/types';
import type { Capability, ModelState } from '../model/runtime';
import { downloadJson, publicAsset } from '../utils';

interface Props {
  settings: Settings;
  onApply: (settings: Settings) => void;
  onClose: () => void;
  pack: RulePack | null;
  skill: Skill | null;
  stage: Stage;
  kind?: MaterialKind;
  capability: Capability | null;
  modelState: ModelState;
  offlineReady: boolean;
  onLoadModel: () => void;
  onCancelModel: () => void;
}

export function Configuration({ settings, onApply, onClose, pack, skill, stage, kind, capability, modelState, offlineReady, onLoadModel, onCancelModel }: Props) {
  const [tab, setTab] = useState('model');
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const [json, setJson] = useState('');
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

  function apply() {
    try { onApply(validateSettings(draft)); onClose(); }
    catch (e) { setError(String((e as Error).message)); }
  }

  const primaryTabs = [
    { id: 'model', name: '本地模型', icon: Cpu },
    { id: 'rules', name: '规范与规则', icon: BookOpen },
    { id: 'recognition', name: '识别范围', icon: ScanLine },
  ];

  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={dialog} className="config-dialog" role="dialog" aria-modal="true" aria-labelledby="config-title">
      <header>
        <h2 id="config-title">引擎与规则设置</h2>
        <button type="button" className="icon-button" autoFocus aria-label="关闭配置" onClick={onClose}><X size={16}/></button>
      </header>
      <div className="config-body">
        <nav className="config-tabs" aria-label="配置分类">
          <div className="config-tabs-main">
            {primaryTabs.map(t => (
              <button type="button" key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                <t.icon size={15}/><span>{t.name}</span>
              </button>
            ))}
          </div>
          <div className="config-tabs-bottom">
            <button type="button" className={tab === 'training' ? 'active' : ''} onClick={() => setTab('training')}>
              <FlaskConical size={15}/><span>高级与微调</span>
            </button>
          </div>
        </nav>

        <div className="config-content">
          {tab === 'model' && <>
            <h3>浏览器本地解释模型</h3>
            <p className="muted">仅在点击「补充解释」时按需运行，规则检查不依赖模型，论文内容不上传云端。</p>

            <label>模型版本
              <select value={draft.modelId} onChange={e => setDraft({ ...draft, modelId: e.target.value })}>
                {MODELS.map(m => <option key={m.id} value={m.id}>{m.name} · {m.download} · {m.role}</option>)}
              </select>
            </label>

            <div className="config-status-strip">
              <div className="status-left">
                <span className={`status-indicator ${capability?.webgpu ? 'ok' : 'idle'}`} aria-hidden="true"/>
                <div>
                  <strong>{capability?.webgpu ? 'WebGPU 可用' : 'WebGPU 尚未就绪'} · {modelState.phase === 'ready' ? '已就绪' : modelState.phase === 'loading' ? '加载中' : '未加载'}</strong>
                  <p>{capability?.device || '正在检测图形设备'}{offlineReady ? ' · 离线资源已缓存' : ''}</p>
                </div>
              </div>
              {['loading', 'ready', 'generating'].includes(modelState.phase) ? (
                <button type="button" className="secondary small" onClick={onCancelModel}>
                  {modelState.phase === 'loading' ? '取消加载' : '释放模型'}
                </button>
              ) : (
                <button type="button" className="secondary small" disabled={draft.modelId !== settings.modelId || draft.contextWindow !== settings.contextWindow} onClick={onLoadModel}>
                  加载模型
                </button>
              )}
            </div>

            {modelState.phase === 'loading' && (
              <div className="model-load-progress">
                <progress aria-label="模型下载进度" value={modelState.progress} max={1}/>
                <span role="status">{modelState.text}</span>
              </div>
            )}

            <label className="checkbox-label">
              <input type="checkbox" checked={draft.autoLoadCached} onChange={e => setDraft({ ...draft, autoLoadCached: e.target.checked })}/>
              <span>下次打开时自动加载已缓存的模型</span>
            </label>

            <details className="technical">
              <summary>推理参数与诊断详情</summary>
              <div className="field-grid">
                <label>上下文预算
                  <select value={draft.contextWindow} onChange={e => setDraft({ ...draft, contextWindow: Number(e.target.value) as 2048 | 4096 })}>
                    <option value={2048}>2048 tokens</option>
                    <option value={4096}>4096 tokens</option>
                  </select>
                </label>
                <label>最大输出 tokens
                  <input type="number" min={128} max={800} step={32} value={draft.maxTokens} onChange={e => setDraft({ ...draft, maxTokens: Number(e.target.value) })}/>
                </label>
              </div>
              <label>温度（0–0.5）
                <input type="number" min={0} max={.5} step={.1} value={draft.temperature} onChange={e => setDraft({ ...draft, temperature: Number(e.target.value) })}/>
              </label>
              <p className="muted">单缓冲上限约 {capability?.maxBufferMB || 0} MB；未启用云端模型或外部 API。</p>
              <pre>{modelState.text}{modelState.error ? `\n${modelState.error}` : ''}</pre>
            </details>

            <details className="technical">
              <summary>导入 / 导出运行配置</summary>
              <div className="tech-actions">
                <button type="button" className="secondary small" onClick={() => downloadJson(draft, '论文审核运行配置.json')}>
                  <Download size={14}/><span>导出配置</span>
                </button>
              </div>
              <textarea aria-label="运行配置JSON" value={json} onChange={e => setJson(e.target.value)} placeholder="粘贴之前导出的运行配置 JSON"/>
              <button type="button" className="secondary small" onClick={() => { try { setDraft(validateSettings(JSON.parse(json))); setError(''); } catch (e) { setError((e as Error).message); } }}>
                校验并载入草稿
              </button>
            </details>
          </>}

          {tab === 'rules' && <>
            <h3>{STAGES[stage]}{kind ? (kind === 'thesis' ? '论文稿' : '阶段报告') : ''} · 学院规范与开关</h3>
            <p className="muted">关闭的规则项会明确显示「未执行」，不会计作通过。</p>
            <div className="config-info">
              <div>
                <strong>{pack?.title || '规则加载中'}</strong>
                <p>规则版本 {pack?.version} · 哈希绑定至学院指南</p>
              </div>
              <a href={publicAsset('rules/guide.pdf')} target="_blank" rel="noreferrer">查看指南原文</a>
            </div>
            {skill && <details className="technical">
              <summary>查看当前阶段解释指令（{skill.name} · {skill.version}）</summary>
              <div className="skill-box">
                <ol>{skill.instructions.map(t => <li key={t}>{t}</li>)}</ol>
                <p>执行链路：原生读取 → 规则核对 → 证据解释</p>
              </div>
            </details>}
            <div className="rule-switches">
              {pack?.rules.filter(r => r.stages.includes(stage) && (!kind || !r.params.kinds || r.params.kinds.includes(kind))).map(r => (
                <label className="rule-switch" key={r.id}>
                  <input type="checkbox" checked={!draft.disabledRules.includes(r.id)} onChange={e => setDraft({ ...draft, disabledRules: e.target.checked ? draft.disabledRules.filter(id => id !== r.id) : [...draft.disabledRules, r.id] })}/>
                  <span>{r.title}<small>{r.id} · {r.source.kind === 'document' ? '本稿内部对照' : `指南第 ${r.source.pdf_page} 页`}</small></span>
                </label>
              ))}
            </div>
          </>}

          {tab === 'recognition' && <>
            <h3>当前解析与识别边界</h3>
            <p className="muted">发现对象与完成审核是两种能力，尚未接入的解析项均保留人工确认。</p>
            {RECOGNITION_ADAPTERS.map(a => (
              <article className="adapter" key={a.id}>
                <div>
                  {a.state === 'ready' ? <CheckCircle2 size={15} className="adapter-ok"/> : <CircleDashed size={15} className="adapter-pending"/>}
                  <strong>{a.name}</strong>
                  <span>{a.state === 'ready' ? '已接入' : '待接入'}</span>
                </div>
                <p>{a.detail}</p>
              </article>
            ))}
          </>}

          {tab === 'training' && <>
            <h3>开发者：基线评估与学院微调准备</h3>
            <p className="muted">当前运行原始开源模型，网页仅负责本地推理，不会在学生设备上启动训练。</p>
            <ol className="training-steps">
              <li>收集去标识的「原文 + 规范 + 教师意见」样例。</li>
              <li>按论文划分训练、验证和独立测试集，保留正确与不确定样例。</li>
              <li>对比原始模型 + Skill 基线与微调后的误报、漏报与建议质量。</li>
              <li>开发侧完成训练、量化与 MLC 编译后发布新版本。</li>
            </ol>
            <button type="button" className="secondary small" onClick={() => downloadJson({
              status: 'example_not_trained',
              base_model: draft.modelId.includes('1.7B') ? 'Qwen/Qwen3-1.7B' : draft.modelId.includes('0.6B') ? 'Qwen/Qwen3-0.6B' : 'Qwen/Qwen3-4B',
              method: 'supervised_finetuning_with_lora',
              dataset: null,
              split_policy: 'by_document_not_by_paragraph',
              targets: ['column_classification', 'evidence_explanation', 'uncertainty'],
              deployment: 'merge_quantize_convert_compile_mlc_then_evaluate',
              output_contract: 'explanations[{issue_id,explanation,steps}]',
            }, '学院微调配置草案.json')}>
              <Download size={14}/><span>导出微调配置草案</span>
            </button>
          </>}

          {error && <p role="alert" className="error-box">{error}</p>}
        </div>
      </div>

      <footer>
        <p>更改规则开关后需重新检查；更换模型后需重新加载。</p>
        <div className="footer-actions">
          <button type="button" className="secondary small" onClick={onClose}>取消</button>
          <button type="button" className="primary small" onClick={apply}>保存设置</button>
        </div>
      </footer>
    </section>
  </div>;
}
