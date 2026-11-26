import type { Check } from '../domain/types';
import type { ModelEvidence, ModelState } from '../model/runtime';

export interface ExplanationControls {
  phase: ModelState['phase'];
  pendingKey: string | null;
  errors: Record<string, string>;
  results: Record<string, ModelEvidence>;
  onExplain: (check: Check, itemIndex: number) => void;
  onLoadModel?: () => void;
  modelDownload?: string;
  modelProgress?: number;
  onConfigure: () => void;
  onCancel: () => void;
}

export function OccurrenceExplanation({ controls, target, check, itemIndex }: {
  controls: ExplanationControls; target: string; check: Check; itemIndex: number;
}) {
  const result = controls.results[target];
  const explanation = result?.explanations[0];
  const pending = controls.pendingKey === target;
  const available = controls.phase === 'ready' && controls.pendingKey === null;
  const loadModel = controls.onLoadModel;
  return <details className="occurrence-explanation">
    <summary>补充解释</summary>
    {explanation && <div className="explanation-text">
      <p>{explanation.explanation}</p>
      <ol>{explanation.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      <small>本地模型 · {result.modelId}</small>
    </div>}
    {controls.errors[target] && <p role="status">{controls.errors[target]}</p>}
    {pending ? <div role="status">正在解释这一处… <button type="button" onClick={controls.onCancel}>停止生成</button></div> :
      available ? <button type="button" onClick={() => controls.onExplain(check, itemIndex)}>{explanation ? '重新解释' : itemIndex >= 0 ? '用本地模型解释这一处' : '用本地模型解释整项记录'}</button> :
      controls.phase === 'generating' || controls.pendingKey !== null ? <p>本地模型正在解释另一处批注。</p> :
      controls.phase === 'loading' ? <>
        <div className="model-load-progress">
          <progress aria-label="本机模型准备进度" value={controls.modelProgress ?? 0} max={1}/>
          <span role="status">正在准备本机模型…</span>
        </div>
        <button type="button" onClick={controls.onCancel}>取消准备本机模型</button>
      </> : loadModel ? <>
        <button type="button" onClick={loadModel}>下载或加载本机模型</button>
        {controls.modelDownload && <p>首次下载{controls.modelDownload}，之后复用浏览器缓存。</p>}
      </> : <button type="button" onClick={controls.onConfigure}>查看本机模型配置</button>}
  </details>;
}
