import type { MLCEngineInterface, InitProgressReport } from '@mlc-ai/web-llm';
import type { Check, Explanation, Location, Report, Settings, Skill, Status } from '../domain/types';
import { buildMessages, explanationSchema, explanationTarget, normalizeWebLLMOutput, usesRuleAdviceOnly, validateEvidenceTone, validateExplanations, validateTargetReferences } from './contracts';
import { browserModelConfig } from './college';

export interface Capability { webgpu: boolean; device: string; maxBufferMB: number; reason?: string }
export interface ModelState { phase: 'idle' | 'loading' | 'ready' | 'generating' | 'error'; progress: number; text: string; modelId?: string; error?: string; cached?: boolean }
export interface ModelEvidence {
  explanations: Explanation[]; documentSha256: string; reportId: string; modelId: string;
  targetKey: string; ruleId: string; itemIndex: number; status: Status; sourcePage?: number; location?: Location;
  skillVersion: string; milliseconds: number; usage: unknown; raw: string;
}
export async function probeWebGPU(): Promise<Capability> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ info?: { vendor?: string; architecture?: string }; limits: { maxBufferSize: number } } | null> } }).gpu;
    if (!gpu) return { webgpu: false, device: 'WebGPU不可用', maxBufferMB: 0, reason: '当前浏览器未提供WebGPU。基础规则仍可运行；请使用支持WebGPU的浏览器测试本地模型。' };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { webgpu: false, device: '未取得GPU适配器', maxBufferMB: 0, reason: '浏览器没有返回可用的WebGPU适配器。' };
    return { webgpu: true, device: [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' · ') || 'WebGPU适配器可用', maxBufferMB: Math.round(adapter.limits.maxBufferSize / 1024 ** 2) };
  } catch (e) { return { webgpu: false, device: '设备检查失败', maxBufferMB: 0, reason: e instanceof Error ? e.message : String(e) }; }
}
export class BrowserModel {
  private engine: MLCEngineInterface | null = null;
  private worker: Worker | null = null;
  private listeners = new Set<(state: ModelState) => void>();
  private epoch = 0;
  private loadedContext = 4096;
  private rejectPending: ((reason: Error) => void) | null = null;
  private rejectLoading: ((reason: Error) => void) | null = null;
  state: ModelState = { phase: 'idle', progress: 0, text: '本地模型尚未加载' };
  subscribe(listener: (state: ModelState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(state: ModelState) { this.state = state; this.listeners.forEach(f => f(state)); }
  async checkCache(modelId: string): Promise<boolean> {
    const lib = await import('@mlc-ai/web-llm');
    return lib.hasModelInCache(modelId, browserModelConfig(lib.prebuiltAppConfig));
  }
  async load(settings: Settings): Promise<void> {
    if (this.state.phase === 'loading' || this.state.phase === 'generating') throw new Error('请等待当前模型任务完成，或先取消。');
    this.dispose(); const epoch = ++this.epoch;
    this.update({ phase: 'loading', modelId: settings.modelId, progress: 0, text: '检测设备与准备模型运行库…' });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      this.rejectLoading = reject;
      timeout = setTimeout(() => reject(new Error('模型加载超过10分钟，可检查网络后重试；部分资源可能已缓存。')), 600000);
    });
    try {
      const initialize = async () => {
        const capability = await probeWebGPU();
        if (!capability.webgpu) throw new Error(capability.reason);
        const lib = await import('@mlc-ai/web-llm');
        if (epoch !== this.epoch) throw new Error('模型任务已取消。');
        const appConfig = browserModelConfig(lib.prebuiltAppConfig);
        if (!appConfig.model_list.some(m => m.model_id === settings.modelId)) throw new Error('所选模型未配置，请查看本机模型设置。');
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onerror = () => {
          if (epoch === this.epoch) this.rejectLoading?.(new Error('本机模型运行库未能启动。'));
        };
        const onProgress = (p: InitProgressReport) => {
          if (epoch === this.epoch) this.update({ phase: 'loading', modelId: settings.modelId, progress: Math.max(0, Math.min(1, p.progress)), text: p.text });
        };
        const engine = await lib.CreateWebWorkerMLCEngine(worker, settings.modelId, { appConfig, initProgressCallback: onProgress }, { context_window_size: settings.contextWindow });
        const cached = await lib.hasModelInCache(settings.modelId, appConfig).catch(() => false);
        return { engine, cached };
      };
      const { engine, cached } = await Promise.race([initialize(), deadline]);
      if (epoch !== this.epoch) return;
      this.engine = engine; this.loadedContext = settings.contextWindow;
      this.update({ phase: 'ready', modelId: settings.modelId, progress: 1, text: '浏览器本地模型已加载', cached });
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.dispose();
      const message = e instanceof Error ? e.message : String(e);
      this.update({ phase: 'error', modelId: settings.modelId, progress: 0, text: '模型未完成加载', error: message });
      throw e;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (epoch === this.epoch) this.rejectLoading = null;
    }
  }
  async explain(report: Report, check: Check, skill: Skill, settings: Settings, itemIndex = -1): Promise<ModelEvidence> {
    if (usesRuleAdviceOnly(check, settings.modelId)) throw new Error(check.rule.mode === 'footnote_brackets'
      ? '脚注编号的改法由原稿中的编号直接确定。请查看此处的规则批注。'
      : '学院微调试用版沿用本条固定行距的规则建议。');
    if (!this.engine || this.state.phase !== 'ready' || this.state.modelId !== settings.modelId || this.loadedContext !== settings.contextWindow) throw new Error('请按当前配置加载本地模型。');
    const engine = this.engine; const epoch = this.epoch; const start = performance.now();
    if (report.checks && !report.checks.includes(check)) throw new Error('该检查项不属于当前稿件。');
    const target = explanationTarget(report, check, itemIndex);
    const messages = buildMessages(report, check, skill, itemIndex);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      this.rejectPending = reject;
      timer = setTimeout(() => {
        reject(new Error('单条模型解释超过180秒，已停止；原规则结果保留。'));
        if (epoch === this.epoch) this.cancel();
      }, 180000);
    });
    this.update({ ...this.state, phase: 'generating', text: '正在本机解释选中证据…' });
    try {
      const generate = async () => {
        const tokens = await engine.tokenize(messages.map(m => m.content).join('\n'));
        if (epoch !== this.epoch) throw new Error('模型任务已取消。');
        if (tokens.length + settings.maxTokens + 200 > settings.contextWindow) throw new Error('证据与输出超出当前上下文预算，请改用4096上下文或减少输出长度。');
        return engine.chat.completions.create({ messages, temperature: settings.temperature, max_tokens: settings.maxTokens,
          extra_body: { enable_thinking: false }, response_format: { type: 'json_object', schema: JSON.stringify(explanationSchema(target)) } });
      };
      const response = await Promise.race([generate(), deadline]);
      if (epoch !== this.epoch) throw new Error('模型任务已取消。');
      if (response.choices[0]?.finish_reason !== 'stop') throw new Error('模型输出未正常结束，未采纳；可增加输出长度后重试。');
      const raw = response.choices[0]?.message.content || '';
      const explanations = validateExplanations(normalizeWebLLMOutput(raw), new Set([check.rule.id]), target);
      validateEvidenceTone(explanations, target.status);
      validateTargetReferences(explanations, check, target);
      return { explanations, targetKey: target.key, ruleId: target.ruleId, itemIndex, status: target.status,
        sourcePage: target.sourcePage, location: target.item?.location, documentSha256: report.document.sha256,
        reportId: report.id, modelId: settings.modelId, skillVersion: skill.version,
        milliseconds: performance.now() - start, usage: response.usage, raw };
    } finally {
      if (timer) clearTimeout(timer);
      if (epoch === this.epoch) {
        this.rejectPending = null;
        if (this.engine) this.update({ ...this.state, phase: 'ready', text: '浏览器本地模型已加载' });
      }
    }
  }
  cancel() { this.dispose(); this.update({ phase: 'idle', progress: 0, text: '本地模型已停止，可重新加载' }); }
  dispose() {
    this.epoch++;
    const cancellation = new Error('模型任务已取消。');
    this.rejectLoading?.(cancellation); this.rejectLoading = null;
    this.rejectPending?.(cancellation); this.rejectPending = null;
    this.worker?.terminate(); this.engine = null; this.worker = null;
  }
}
