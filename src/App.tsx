import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { AlertCircle, Info, LoaderCircle, MoreHorizontal, Upload, X } from 'lucide-react';
import { Configuration } from './components/Configuration';
import { marginInitialSelection } from './domain/marginNotes';
import { FullReport } from './components/FullReport';
import { MarginNotes } from './components/MarginNotes';
import { useMarginLeader } from './components/useMarginLeader';
import { DocumentViewer } from './components/DocumentViewer';
import { CoveragePanel } from './components/CoveragePanel';
import { VersionsPanel } from './components/VersionsPanel';
import { captureVersion, compareVersions, retainVersions, versionProvenance, type VersionSnapshot } from './domain/versions';
import type { Location } from './domain/types';
import { loadSkill, readSettings } from './domain/config';
import { loadRules } from './domain/rules';
import { STAGES, type Check as AuditCheck, type MaterialKind, type RulePack, type Settings, type Skill, type Stage } from './domain/types';
import { runWorkflow, type WorkflowResult } from './domain/workflow';
import { BrowserModel, probeWebGPU, type Capability, type ModelEvidence, type ModelState } from './model/runtime';
import { downloadJson, publicAsset } from './utils';

const UTILITY_TITLES = { records: '完整检查记录', coverage: '图表与公式', versions: '版本对比' } as const;
type Panel = 'notes' | keyof typeof UTILITY_TITLES;
const SAMPLES = [
  { url: 'samples/structure-mixed.docx', name: '合成样稿_图表公式结构核对.docx', label: 'Word 图表公式样稿' },
  { url: 'samples/known-errors.docx', name: '合成样稿_含已知格式错误.docx', label: 'Word 格式样稿' },
  { url: 'samples/corrected-format.docx', name: '合成样稿_基础格式修正对照.docx', label: 'Word 修正对照稿' },
  { url: 'samples/native-pdf.pdf', name: '合成样稿_PDF字号候选.pdf', label: 'PDF 原页样稿' },
  { url: 'samples/mixed-pdf.pdf', name: '合成样稿_混合页面图片声明.pdf', label: 'PDF 混合页' },
];
export default function App() {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [stage, setStage] = useState<Stage>('predefense'); const [kind, setKind] = useState<MaterialKind>('thesis');
  const [file, setFile] = useState<File | null>(null); const [data, setData] = useState<WorkflowResult | null>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]); const [baselineId, setBaselineId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('notes');
  const [pack, setPack] = useState<RulePack | null>(null); const [skill, setSkill] = useState<Skill | null>(null);
  const [focusLocation, setFocusLocation] = useState<Location | null>(null);
  const [selected, setSelected] = useState<{ id: string; item: number } | null>(null);
  const [configOpen, setConfigOpen] = useState(false); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [progress, setProgress] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [capability, setCapability] = useState<Capability | null>(null); const [offlineReady, setOfflineReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const activateUpdate = useRef<((reload?: boolean) => Promise<void>) | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ phase: 'idle', progress: 0, text: '尚未加载' });
  const [explanations, setExplanations] = useState<Record<string, ModelEvidence>>({});
  const runtime = useRef(new BrowserModel()); const fileInput = useRef<HTMLInputElement>(null); const latest = useRef(data); latest.current = data;
  const [toolsOpen, setToolsOpen] = useState(false);
  const pendingChoice = useRef(0);
  const toolsRoot = useRef<HTMLDivElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const layout = useRef<HTMLElement>(null);
  const selectionKey = [data?.report.id, panel, selected?.id, selected?.item].join('/');
  const leader = useMarginLeader(layout, selectionKey);
  const generating = modelState.phase === 'generating'; const locked = busy || generating;

  useEffect(() => runtime.current.subscribe(setModelState), []);
  useEffect(() => {
    let dead = false;
    void loadRules().then(p => { if (!dead) setPack(p); }).catch(e => { if (!dead) setError(e.message); });
    void probeWebGPU().then(async c => {
      if (dead) return; setCapability(c);
      if (c.webgpu) {
        const cached = await runtime.current.checkCache(settings.modelId).catch(() => false);
        if (dead) return;
        if (cached && settings.autoLoadCached) void runtime.current.load(settings).catch(() => {});
      }
    });
    if (import.meta.env.PROD) activateUpdate.current = registerSW({ onNeedRefresh: () => setUpdateAvailable(true), onOfflineReady: () => setOfflineReady(true), onRegisterError: () => setOfflineReady(false) });
    return () => { dead = true; runtime.current.dispose(); };
    // Initial automatic load is limited to a detected cache and the saved setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { let dead = false; void loadSkill(stage).then(s => { if (!dead) setSkill(s); }).catch(e => { if (!dead) setError(e.message); }); return () => { dead = true; }; }, [stage]);
  useEffect(() => {
    if (!toolsOpen) return;
    const closeOutside = (e: PointerEvent) => {
      if (e.target instanceof Node && !toolsRoot.current?.contains(e.target)) setToolsOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setToolsOpen(false); toolsButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [toolsOpen]);
  function select(id: string, item: number) {
    setPanel('notes');
    setFocusLocation(null);
    setSelected({ id, item });
  }
  function showPanel(value: Panel) {
    setToolsOpen(false);
    setFocusLocation(null);
    setPanel(value);
    if (value === 'notes') toolsButton.current?.focus();
    else requestAnimationFrame(() => drawerClose.current?.focus());
  }
  function clearReview() {
    pendingChoice.current++;
    setData(null);
    setExplanations({});
    setSelected(null);
    setFocusLocation(null);
    setPanel('notes');
  }
  async function inspect(chosen: File) {
    if (busyRef.current || generating) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); clearReview(); setToolsOpen(false); setFile(chosen);
    try {
      const result = await runWorkflow(chosen, stage, kind, settings, setProgress);
      const snapshot = await captureVersion(result, settings);
      const retained = retainVersions(versions, snapshot, baselineId);
      setVersions(retained.history);
      if (retained.dropped) setNotice(`为控制内存，已释放${retained.dropped}份较早的会话记录；已选择的对照版本保留。`);
      setData(result); setPack(result.pack); setSkill(result.skill);
      setSelected(marginInitialSelection(result.report));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { busyRef.current = false; setBusy(false); setProgress(''); }
  }
  async function sample(index: number) {
    const choice = ++pendingChoice.current;
    setToolsOpen(false);
    try {
      const sample = SAMPLES[index];
      const response = await fetch(publicAsset(sample.url));
      if (!response.ok) throw new Error('示例稿读取失败。');
      const bytes = await response.arrayBuffer();
      if (choice === pendingChoice.current) await inspect(new File([bytes], sample.name));
    } catch (e) {
      if (choice === pendingChoice.current) setError((e as Error).message);
    }
  }
  function changeStage(value: Stage) { setStage(value); setKind(value === 'predefense' ? 'thesis' : 'report'); clearReview(); }
  function applySettings(next: Settings) {
    if (next.modelId !== settings.modelId || next.contextWindow !== settings.contextWindow) { runtime.current.cancel(); }
    if (JSON.stringify(next.disabledRules) !== JSON.stringify(settings.disabledRules)) { clearReview(); }
    setSettings(next);
    try { localStorage.setItem('thesis-settings-v1', JSON.stringify(next)); setNotice('配置已保存；规则开关变化后请重新检查当前材料。'); }
    catch { setNotice('当前配置已应用，但浏览器未允许持久保存；关闭页面后需重新配置。'); }
  }
  async function loadModel() {
    setNotice('');
    try { await runtime.current.load(settings); }
    catch { setNotice('本地模型未能加载，已有规则结果仍可查看。请在引擎配置中查看原因。'); }
  }
  async function explain(check: AuditCheck) {
    if (!data || !skill) return;
    const captured = data.report.id; setError('');
    try {
      const result = await runtime.current.explain(data.report, check, data.skill, settings);
      if (latest.current?.report.id === captured) setExplanations(v => ({ ...v, [check.rule.id]: result }));
    } catch (e) { setNotice((e as Error).message); }
  }
  const currentVersion = versions.find(v => v.result.report.id === data?.report.id) || null;
  const baseline = versions.find(v => v.result.report.id === baselineId) || null;
  function viewVersion(snapshot: VersionSnapshot) {
    if (locked) return;
    pendingChoice.current++;
    const result = snapshot.result;
    setData(result); setPack(result.pack); setSkill(result.skill); setStage(result.report.stage); setKind(result.report.kind);
    setPanel('notes'); setFile(new File([result.buffer], result.report.document.name)); setExplanations({}); setSelected(marginInitialSelection(result.report)); setFocusLocation(null); setError('');
    setNotice('正在查看该版保存的检查结果；重新检查会使用当前引擎配置。');
  }

  function exportReport() { if (data) downloadJson({ ...data.report, skills: data.skill, modelExplanations: explanations, ruleConfiguration: { disabledRules: currentVersion?.settings.disabledRules || settings.disabledRules }, comparison: baseline && currentVersion && baseline !== currentVersion ? { before: versionProvenance(baseline), after: versionProvenance(currentVersion), ...compareVersions(baseline, currentVersion) } : null, note: '本地试验，不等于教师复核通过；AI解释不改变规则判定。' }, `审核记录_${file?.name || '材料'}.json`); }


  return <div className="app-shell reader-app margin-app">
    <header className="review-masthead">
      <div className="masthead-brand"><h1>论文审阅</h1></div>
      {file && <span className="manuscript-name" title={file.name}>{file.name}</span>}
      <label className="stage-picker"><span className="sr-only">审核阶段</span>
        <select aria-label="审核阶段" value={stage} disabled={locked} onChange={e => changeStage(e.target.value as Stage)}>
          {Object.entries(STAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      {stage !== 'predefense' && <label className="stage-picker"><span className="sr-only">材料类型</span>
        <select aria-label="材料类型" disabled={locked} value={kind} onChange={e => { setKind(e.target.value as MaterialKind); clearReview(); }}>
          <option value="report">阶段报告</option><option value="thesis">论文稿</option>
        </select>
      </label>}
      <div className="masthead-actions">
        <input ref={fileInput} type="file" accept=".pdf,.docx" hidden disabled={locked} onChange={e => {
          const f = e.target.files?.[0]; if (f) void inspect(f); e.target.value = '';
        }}/>
        {file && <button className="upload-action" disabled={locked} onClick={() => fileInput.current?.click()}>重新上传</button>}
        <div className="tools-wrap" ref={toolsRoot} onBlur={e => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setToolsOpen(false);
        }}>
          <button className="tools-trigger" ref={toolsButton} aria-label="更多工具" title="更多工具" aria-expanded={toolsOpen} aria-controls="review-tools" onClick={() => setToolsOpen(v => !v)}><MoreHorizontal size={20}/></button>
          {toolsOpen && <nav id="review-tools" className="tools-popover" aria-label="更多工具">
            {Object.entries(UTILITY_TITLES).map(([id, name]) => <button key={id} disabled={id === 'versions' ? !versions.length : !data} onClick={() => showPanel(id as Panel)}>{name}</button>)}
            <button disabled={!data} onClick={() => { exportReport(); setToolsOpen(false); toolsButton.current?.focus(); }}>导出审阅记录</button>
            <hr/>
            <label>示例稿<select aria-label="选择示例稿" disabled={locked} value="" onChange={e => { if (e.target.value) void sample(Number(e.target.value)); }}>
              <option value="">选择样稿</option>{SAMPLES.map((s, i) => <option key={s.url} value={i}>{s.label}</option>)}
            </select></label>
            {file && <button disabled={locked} onClick={() => void inspect(file)}>重新检查当前文件</button>}
            <a href={publicAsset('rules/guide.pdf')} target="_blank" rel="noreferrer" onClick={() => setToolsOpen(false)}>学院撰写指南</a>
            <button disabled={locked} onClick={() => { toolsButton.current?.focus(); setToolsOpen(false); setConfigOpen(true); }}>引擎配置</button>
          </nav>}
        </div>
      </div>
    </header>
    <main className="reader-main">
      {error && <div role="alert" className="feedback error"><AlertCircle size={17}/><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={16}/></button></div>}
      {notice && <div role="status" className="feedback"><Info size={17}/><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {updateAvailable && <div className="feedback"><Info size={17}/><span>有新版工作台。更新前可导出本次会话记录。</span><button className="secondary" disabled={locked || modelState.phase === 'loading'} onClick={() => void activateUpdate.current?.(true)}>更新工作台</button></div>}
      <section className="review-layout reader-layout margin-layout" ref={layout} aria-label="原文与页边批注">
        <section className="document-panel" aria-label="论文原文">
          {data ? <DocumentViewer key={data.report.id} buffer={data.buffer} report={data.report} selected={selected} focusLocation={focusLocation} onSelect={select} onAnchorChange={leader.onAnchorChange}/> :
            <div className="paper-scroll empty-desk" onDragOver={e => e.preventDefault()} onDrop={e => {
              e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !locked) void inspect(f);
            }}><div className="empty-sheet"><div className="upload-state" aria-busy={busy}>
              <h2>{busy ? '正在检查原稿' : file ? (error ? '文件读取未完成' : '重新核对这份原稿') : '打开论文原稿'}</h2>
              <p role={busy ? 'status' : undefined}>{busy ? progress : file ? file.name : '将 DOCX 或 PDF 拖到这里'}</p>
              <button className="primary" disabled={locked} onClick={() => file ? void inspect(file) : fileInput.current?.click()}>
                {busy ? <LoaderCircle className="spin" size={16}/> : <Upload size={16}/>}
                {busy ? '检查中' : file ? '重新检查' : '选择文件'}
              </button>
              {!busy && <button className="sample-link" onClick={() => void sample(1)}>打开示例稿</button>}
            </div></div></div>}
        </section>
        <aside className="findings-panel margin-panel" aria-label={panel === 'notes' ? '页边批注' : UTILITY_TITLES[panel]}>
          {panel === 'notes' ? <MarginNotes report={data?.report ?? null} selected={selected} onSelect={select}/> :
            <section className="utility-drawer" onKeyDown={e => { if (e.key === 'Escape') showPanel('notes'); }}>
              <header className="utility-heading"><h2>{UTILITY_TITLES[panel]}</h2>
                <button ref={drawerClose} aria-label="返回页边批注" title="返回页边批注" onClick={() => showPanel('notes')}><X size={18}/></button>
              </header><div className="side-scroll">
                {panel === 'versions' && <VersionsPanel versions={versions} current={currentVersion} baseline={baseline} onBaseline={setBaselineId} onView={viewVersion} locked={locked} onSelect={select}/>}
                {panel === 'coverage' && data && <CoveragePanel report={data.report} onLocate={setFocusLocation}/>}
                {panel === 'records' && data && <FullReport report={data.report} explanations={explanations} canExplain={modelState.phase === 'ready' && !locked} onExplain={explain} onSelect={select}/>}
              </div>
            </section>}
        </aside>
        <svg className="margin-leader" aria-hidden="true" focusable="false"><path ref={leader.path} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke"/></svg>
      </section>
    </main>
    {configOpen && <Configuration settings={settings} onApply={applySettings} onClose={() => setConfigOpen(false)} pack={pack} skill={skill} stage={stage} capability={capability} modelState={modelState} offlineReady={offlineReady} onLoadModel={loadModel} onCancelModel={() => runtime.current.cancel()}/>}
  </div>;
}
