import { useEffect, useMemo, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { AlertCircle, BookOpen, CircleHelp, Download, FileText, Info, LoaderCircle, MoreHorizontal, RefreshCw, Settings as SettingsIcon, Upload, X } from 'lucide-react';
import { Configuration } from './components/Configuration';
import { GettingStarted } from './components/GettingStarted';
import { marginInitialSelection } from './domain/marginNotes';
import { FullReport } from './components/FullReport';
import { MarginNotes } from './components/MarginNotes';
import { explanationKey } from './model/contracts';
import { FeedbackPanel, TeacherFeedbackProvider } from './components/TeacherFeedback';
import type { ExplanationControls } from './components/OccurrenceExplanation';
import { useMarginLeader } from './components/useMarginLeader';
import { DocumentViewer } from './components/DocumentViewer';
import { CoveragePanel } from './components/CoveragePanel';
import { VersionsPanel } from './components/VersionsPanel';
import { captureVersion, compareVersions, retainVersions, versionProvenance, type VersionSnapshot } from './domain/versions';
import type { Location } from './domain/types';
import { loadSkill, MODELS, readSettings } from './domain/config';
import { loadRules } from './domain/rules';
import { STAGES, type Check as AuditCheck, type MaterialKind, type RulePack, type Settings, type Skill, type Stage } from './domain/types';
import { runWorkflow, type WorkflowResult } from './domain/workflow';
import { BrowserModel, probeWebGPU, type Capability, type ModelEvidence, type ModelState } from './model/runtime';
import { downloadJson, publicAsset } from './utils';

const UTILITY_TITLES = { records: '完整检查记录', coverage: '图表与公式', versions: '版本对比', feedback: '教师反馈' } as const;
type Panel = 'notes' | keyof typeof UTILITY_TITLES;
const GUIDE_SEEN_KEY = 'thesis-guide-seen-v1';

const SAMPLES = [
  { url: 'samples/mixed-run-format.docx', name: '合成样稿_同段不同字号.docx', label: '同段字号样稿.docx', short: 'Word 同段不同字号' },
  { url: 'samples/structure-mixed.docx', name: '合成样稿_图表公式结构核对.docx', label: '图表公式样稿.docx', short: 'Word 图表公式样稿' },
  { url: 'samples/known-errors.docx', name: '合成样稿_含已知格式错误.docx', label: '基础格式样稿.docx', short: 'Word 格式样稿' },
  { url: 'samples/corrected-format.docx', name: '合成样稿_基础格式修正对照.docx', label: '修正对照稿.docx', short: 'Word 修正对照稿' },
  { url: 'samples/native-pdf.pdf', name: '合成样稿_PDF字号候选.pdf', label: 'PDF 原页样稿.pdf', short: 'PDF 原页样稿' },
  { url: 'samples/mixed-pdf.pdf', name: '合成样稿_混合页面图片声明.pdf', label: 'PDF 混合页.pdf', short: 'PDF 混合页' },
];

function buildScopeGroups(pack: RulePack | null, stage: Stage, kind: MaterialKind, disabledRules: string[]) {
  if (!pack) return [];
  const groups: { title: string; items: string[]; total: number }[] = [
    { title: '版式与字体', items: [], total: 0 },
    { title: stage === 'proposal' ? '开题栏目' : '栏目与前置', items: [], total: 0 },
    { title: '图表、脚注与核对', items: [], total: 0 },
  ];
  for (const rule of pack.rules) {
    if (!rule.stages.includes(stage) || (rule.params.kinds && !rule.params.kinds.includes(kind))
      || disabledRules.includes(rule.id)) continue;
    const { mode } = rule;
    const idx = mode === 'page_size' || mode.startsWith('body_')
      ? 0
      : ['heading', 'presence', 'keywords', 'abstract_length', 'classification', 'toc'].includes(mode)
        ? 1
        : 2;
    groups[idx].total++;
    if (groups[idx].items.length < 3) groups[idx].items.push(rule.title);
  }
  return groups.filter(g => g.total > 0);
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [stage, setStage] = useState<Stage>('predefense');
  const [kind, setKind] = useState<MaterialKind>('thesis');
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<WorkflowResult | null>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('notes');
  const [pack, setPack] = useState<RulePack | null>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [focusLocation, setFocusLocation] = useState<Location | null>(null);
  const [selected, setSelected] = useState<{ id: string; item: number } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => {
    try { return localStorage.getItem(GUIDE_SEEN_KEY) !== '1'; }
    catch { return true; }
  });
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [capability, setCapability] = useState<Capability | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const activateUpdate = useRef<((reload?: boolean) => Promise<void>) | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ phase: 'idle', progress: 0, text: '尚未加载' });
  const [explanations, setExplanations] = useState<Record<string, ModelEvidence>>({});
  const [explanationErrors, setExplanationErrors] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const activeRequest = useRef<string | null>(null);
  const runtime = useRef(new BrowserModel());
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAction = useRef<HTMLButtonElement>(null);
  const guideFromMenu = useRef(false);
  const latest = useRef(data);
  latest.current = data;
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sideWidth, setSideWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('thesis-side-width'));
      return saved >= 290 && saved <= 620 ? saved : 388;
    } catch { return 388; }
  });
  const [resizing, setResizing] = useState(false);
  const pendingChoice = useRef(0);
  const toolsRoot = useRef<HTMLDivElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const layout = useRef<HTMLElement>(null);
  const selectionKey = [data?.report.id, panel, selected?.id, selected?.item].join('/');
  const leader = useMarginLeader(layout, selectionKey);
  const generating = modelState.phase === 'generating';
  const locked = busy || generating || pendingKey !== null;

  useEffect(() => runtime.current.subscribe(setModelState), []);
  useEffect(() => {
    let dead = false;
    void loadRules().then(p => { if (!dead) setPack(p); }).catch(e => { if (!dead) setError(e.message); });
    void probeWebGPU().then(async c => {
      if (dead) return;
      setCapability(c);
      if (c.webgpu) {
        const cached = await runtime.current.checkCache(settings.modelId).catch(() => false);
        if (dead) return;
        if (cached && settings.autoLoadCached && runtime.current.state.phase === 'idle') {
          void runtime.current.load(settings).catch(() => {});
        }
      }
    });
    if (import.meta.env.PROD) {
      activateUpdate.current = registerSW({
        onNeedRefresh: () => setUpdateAvailable(true),
        onOfflineReady: () => setOfflineReady(true),
        onRegisterError: () => setOfflineReady(false),
      });
    }
    return () => { dead = true; runtime.current.dispose(); };
    // Initial automatic load is limited to a detected cache and the saved setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let dead = false;
    void loadSkill(stage).then(s => { if (!dead) setSkill(s); }).catch(e => { if (!dead) setError(e.message); });
    return () => { dead = true; };
  }, [stage]);
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

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const container = layout.current;
    if (!container) return;
    e.preventDefault();
    setResizing(true);
    const rect = container.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const maxW = Math.min(620, Math.max(320, Math.floor(rect.width * 0.56)));
      const next = Math.round(Math.max(290, Math.min(maxW, rect.right - ev.clientX)));
      setSideWidth(next);
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  useEffect(() => {
    try { localStorage.setItem('thesis-side-width', String(sideWidth)); } catch { /* ignore */ }
  }, [sideWidth]);

  function select(id: string, item: number) {
    setPanel('notes');
    setFocusLocation(null);
    setSelected({ id, item });
  }
  function showPanel(value: Panel) {
    setToolsOpen(false);
    setFocusLocation(null);
    setPanel(value);
    if (value !== 'notes') requestAnimationFrame(() => drawerClose.current?.focus());
  }
  function dismissGuide() {
    setGuideOpen(false);
    try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch { /* The dialog can still be dismissed. */ }
    requestAnimationFrame(() => {
      const upload = uploadAction.current;
      const target = !guideFromMenu.current && upload && !upload.disabled ? upload : toolsButton.current;
      target?.focus({ preventScroll: true });
    });
  }
  function clearExplanations() {
    setExplanations({});
    setExplanationErrors({});
  }
  function clearReview() {
    pendingChoice.current++;
    setData(null);
    clearExplanations();
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
      const target = SAMPLES[index];
      const response = await fetch(publicAsset(target.url));
      if (!response.ok) throw new Error('示例稿读取失败。');
      const bytes = await response.arrayBuffer();
      if (choice === pendingChoice.current) await inspect(new File([bytes], target.name));
    } catch (e) {
      if (choice === pendingChoice.current) setError((e as Error).message);
    }
  }
  function changeStage(value: Stage) {
    if (value === stage) return;
    setStage(value);
    setKind(value === 'predefense' ? 'thesis' : 'report');
    clearReview();
  }
  function changeKind(value: MaterialKind) {
    if (value === kind) return;
    setKind(value);
    clearReview();
  }
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
  async function explain(check: AuditCheck, itemIndex: number) {
    if (!data || activeRequest.current !== null) return;
    const reportId = data.report.id;
    const target = explanationKey(reportId, check.rule.id, itemIndex);
    activeRequest.current = target;
    setPendingKey(target);
    setExplanationErrors(previous => ({ ...previous, [target]: '' }));
    try {
      const result = await runtime.current.explain(data.report, check, data.skill, settings, itemIndex);
      if (latest.current?.report.id === reportId && result.targetKey === target) {
        setExplanations(previous => ({ ...previous, [target]: result }));
      }
    } catch (err) {
      if (latest.current?.report.id === reportId) {
        const message = err instanceof Error ? err.message : String(err);
        setExplanationErrors(previous => ({ ...previous, [target]: message }));
      }
    } finally {
      activeRequest.current = null;
      setPendingKey(null);
    }
  }
  const explanationControls: ExplanationControls = {
    phase: modelState.phase, pendingKey, errors: explanationErrors, results: explanations,
    onExplain: explain, onLoadModel: capability?.webgpu ? loadModel : undefined,
    modelDownload: MODELS.find(model => model.id === settings.modelId)?.download,
    modelProgress: modelState.progress,
    onConfigure: () => setConfigOpen(true), onCancel: () => runtime.current.cancel(),
  };
  const currentVersion = versions.find(v => v.result.report.id === data?.report.id) || null;
  const baseline = versions.find(v => v.result.report.id === baselineId) || null;
  function viewVersion(snapshot: VersionSnapshot) {
    if (locked) return;
    pendingChoice.current++;
    const result = snapshot.result;
    setData(result); setPack(result.pack); setSkill(result.skill); setStage(result.report.stage); setKind(result.report.kind);
    setPanel('notes'); setFile(new File([result.buffer], result.report.document.name)); clearExplanations(); setSelected(marginInitialSelection(result.report)); setFocusLocation(null); setError('');
    setNotice('正在查看该版保存的检查结果；重新检查会使用当前引擎配置。');
  }
  function exportReport() {
    if (!data) return;
    downloadJson({
      ...data.report,
      skills: data.skill,
      modelExplanations: explanations,
      ruleConfiguration: { disabledRules: currentVersion?.settings.disabledRules || settings.disabledRules },
      comparison: baseline && currentVersion && baseline !== currentVersion
        ? { before: versionProvenance(baseline), after: versionProvenance(currentVersion), ...compareVersions(baseline, currentVersion) }
        : null,
      note: '本地试验，不等于教师复核通过；AI解释不改变规则判定。',
    }, `审核记录_${file?.name || '材料'}.json`);
  }

  const applicableCount = useMemo(
    () => data ? data.report.checks.filter(c => c.status !== 'not_applicable').length : 0,
    [data],
  );
  const objectCount = data?.report.document.objects.length ?? 0;
  const scopeGroups = buildScopeGroups(pack, stage, kind, settings.disabledRules);
  const scopeCount = scopeGroups.reduce((total, group) => total + group.total, 0);
  const showSideTabs = Boolean(data || versions.length);

  return <TeacherFeedbackProvider><div className="app-shell margin-app">
    <header className="review-masthead">
      <div className="masthead-left">
        <div className="masthead-brand"><h1>论文审阅</h1></div>
        {file && <span className="manuscript-name" title={file.name}>{file.name}</span>}
      </div>

      <div className="masthead-center">
        <div className="segmented-control" role="group" aria-label="审核阶段">
          {(Object.entries(STAGES) as [Stage, string][]).map(([id, name]) => (
            <button key={id} type="button" className={stage === id ? 'active' : ''} aria-pressed={stage === id} disabled={locked} onClick={() => changeStage(id)}>
              {name}
            </button>
          ))}
        </div>
        {stage !== 'predefense' && <div className="segmented-control compact" role="group" aria-label="材料类型">
          <button type="button" className={kind === 'report' ? 'active' : ''} aria-pressed={kind === 'report'} disabled={locked} onClick={() => changeKind('report')}>阶段报告</button>
          <button type="button" className={kind === 'thesis' ? 'active' : ''} aria-pressed={kind === 'thesis'} disabled={locked} onClick={() => changeKind('thesis')}>论文稿</button>
        </div>}
      </div>

      <div className="masthead-actions">
        <input ref={fileInput} type="file" accept=".pdf,.docx" hidden disabled={locked} onChange={e => {
          const f = e.target.files?.[0]; if (f) void inspect(f); e.target.value = '';
        }}/>
        {file && <button type="button" className="upload-action" disabled={locked} onClick={() => fileInput.current?.click()}>
          <Upload size={14}/><span>重新上传</span>
        </button>}
        <div className="tools-wrap" ref={toolsRoot} onBlur={e => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setToolsOpen(false);
        }}>
          <button type="button" className="tools-trigger" ref={toolsButton} aria-label="更多工具" title="更多工具" aria-expanded={toolsOpen} aria-controls="review-tools" onClick={() => setToolsOpen(v => !v)}>
            <MoreHorizontal size={18}/>
          </button>
          {toolsOpen && <nav id="review-tools" className="tools-popover" aria-label="更多工具">
            <div className="menu-section-label">审阅面板</div>
            {Object.entries(UTILITY_TITLES).map(([id, name]) => (
              <button key={id} type="button" disabled={id === 'versions' || id === 'feedback' ? !versions.length : !data} onClick={() => showPanel(id as Panel)}>{name}</button>
            ))}
            <button type="button" disabled={!data} onClick={() => { exportReport(); setToolsOpen(false); toolsButton.current?.focus(); }}>
              <Download size={14}/><span>导出审阅记录</span>
            </button>
            {file && <button type="button" disabled={locked} onClick={() => void inspect(file)}>
              <RefreshCw size={14}/><span>重新检查当前文件</span>
            </button>}
            <hr/>
            <div className="menu-section-label">打开合成示例稿</div>
            {SAMPLES.map((s, i) => (
              <button key={s.url} type="button" disabled={locked} onClick={() => void sample(i)}>
                <FileText size={13}/><span>{s.short}</span>
              </button>
            ))}
            <hr/>
            <a href={publicAsset('rules/guide.pdf')} target="_blank" rel="noreferrer" onClick={() => setToolsOpen(false)}>
              <BookOpen size={14}/><span>学院撰写指南 (PDF)</span>
            </a>
            <button type="button" onClick={() => {
              guideFromMenu.current = true;
              toolsButton.current?.focus();
              setToolsOpen(false);
              setGuideOpen(true);
            }}>
              <CircleHelp size={14}/><span>使用说明</span>
            </button>
            <button type="button" disabled={locked} onClick={() => { toolsButton.current?.focus(); setToolsOpen(false); setConfigOpen(true); }}>
              <SettingsIcon size={14}/><span>引擎与规则设置</span>
            </button>
          </nav>}
        </div>
      </div>
    </header>

    <main className="reader-main">
      {error && <div role="alert" className="feedback error"><AlertCircle size={15}/><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14}/></button></div>}
      {notice && <div role="status" className="feedback"><Info size={15}/><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14}/></button></div>}
      {updateAvailable && <div className="feedback"><Info size={15}/><span>有新版工作台。更新前可导出本次会话记录。</span><button type="button" className="secondary small" disabled={locked || modelState.phase === 'loading'} onClick={() => void activateUpdate.current?.(true)}>更新工作台</button></div>}

      <section
        className={`review-layout margin-layout${resizing ? ' is-resizing' : ''}`}
        ref={layout}
        style={{ '--side-width': `${sideWidth}px` } as React.CSSProperties}
        aria-label="原文与页边批注"
      >
        <section className="document-panel" aria-label="论文原文">
          {data ? (
            <DocumentViewer key={data.report.id} buffer={data.buffer} report={data.report} selected={selected} focusLocation={focusLocation} onSelect={select} onAnchorChange={leader.onAnchorChange}/>
          ) : (
            <div
              className={`paper-scroll empty-desk${dragActive ? ' drag-active' : ''}`}
              onDragOver={e => { e.preventDefault(); if (!dragActive) setDragActive(true); }}
              onDragLeave={e => { if (e.currentTarget === e.target) setDragActive(false); }}
              onDrop={e => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files[0];
                if (f && !locked) void inspect(f);
              }}
            >
              <div className="empty-sheet">
                <span className="crop-mark tl" aria-hidden="true"/><span className="crop-mark tr" aria-hidden="true"/>
                <span className="crop-mark bl" aria-hidden="true"/><span className="crop-mark br" aria-hidden="true"/>
                <div className="upload-state" aria-busy={busy}>
                  <h2>{busy ? '正在检查原稿' : file ? (error ? '文件读取未完成' : '重新核对这份原稿') : '打开论文原稿'}</h2>
                  <p role={busy ? 'status' : undefined}>
                    {busy ? progress : file ? file.name : '拖入 .docx 或 .pdf 原稿，全部规则在本机浏览器运行'}
                  </p>
                  <button type="button" className="primary" ref={uploadAction} disabled={locked} onClick={() => file ? void inspect(file) : fileInput.current?.click()}>
                    {busy ? <LoaderCircle className="spin" size={15}/> : <Upload size={15}/>}
                    <span>{busy ? '检查中' : file ? '重新检查' : '选择文件'}</span>
                  </button>
                  {!busy && <button type="button" className="sample-link" onClick={() => void sample(0)}>打开示例稿</button>}
                </div>

                {!busy && <div className="scope-preview">
                  <div className="scope-heading">已启用规则 · {STAGES[stage]}{kind === 'thesis' ? '论文稿' : '阶段报告'}{pack ? `（共 ${scopeCount} 项）` : ''}</div>
                  <div className="scope-grid">
                    {scopeGroups.map(col => (
                      <div key={col.title} className="scope-col">
                        <strong>{col.title}</strong>
                        <ul>
                          {col.items.map(it => <li key={it}>{it}</li>)}
                          {col.total > col.items.length && <li className="scope-more">等共 {col.total} 项</li>}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <div className="quick-samples" aria-label="快速体验示例稿">
                    {[0, 1, 4].map(idx => (
                      <button key={SAMPLES[idx].url} type="button" disabled={locked} onClick={() => void sample(idx)}>
                        <FileText size={13}/><span>{SAMPLES[idx].label}</span>
                      </button>
                    ))}
                  </div>
                </div>}
              </div>
            </div>
          )}
        </section>

        <div
          className="split-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整左右分栏宽度，双击重置"
          aria-valuemin={290}
          aria-valuemax={620}
          aria-valuenow={sideWidth}
          tabIndex={0}
          title="拖拽调整分栏宽度（双击重置）"
          onPointerDown={startResize}
          onDoubleClick={() => setSideWidth(388)}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); setSideWidth(w => Math.min(620, w + 24)); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); setSideWidth(w => Math.max(290, w - 24)); }
            else if (e.key === 'Home') { e.preventDefault(); setSideWidth(388); }
          }}
        />

        <aside className="findings-panel margin-panel" aria-label={panel === 'notes' ? '页边批注' : UTILITY_TITLES[panel]}>
          {showSideTabs && <nav className="side-tabs" aria-label="审阅视图切换">
            <button type="button" className={panel === 'notes' ? 'active' : ''} onClick={() => showPanel('notes')}>批注</button>
            <button type="button" className={panel === 'records' ? 'active' : ''} disabled={!data} onClick={() => showPanel('records')}>
              记录{applicableCount > 0 && <span className="tab-count">{applicableCount}</span>}
            </button>
            <button type="button" className={panel === 'coverage' ? 'active' : ''} disabled={!data} onClick={() => showPanel('coverage')}>
              图表{objectCount > 0 && <span className="tab-count">{objectCount}</span>}
            </button>
            <button type="button" className={panel === 'versions' ? 'active' : ''} disabled={!versions.length} onClick={() => showPanel('versions')}>
              对比{versions.length > 1 && <span className="tab-count">{versions.length}</span>}
            </button>
            <button type="button" className={panel === 'feedback' ? 'active' : ''} disabled={!versions.length} onClick={() => showPanel('feedback')}>反馈</button>
          </nav>}

          {panel === 'notes' ? (
            <MarginNotes report={data?.report ?? null} selected={selected} onSelect={select} controls={explanationControls}/>
          ) : (
            <section className="utility-drawer" onKeyDown={e => { if (e.key === 'Escape') showPanel('notes'); }}>
              <header className="utility-heading">
                <h2>{UTILITY_TITLES[panel]}</h2>
                <button type="button" ref={drawerClose} aria-label="返回页边批注" title="返回页边批注" onClick={() => showPanel('notes')}><X size={16}/></button>
              </header>
              <div className="side-scroll">
                {panel === 'versions' && <VersionsPanel versions={versions} current={currentVersion} baseline={baseline} onBaseline={setBaselineId} onView={viewVersion} locked={locked} onSelect={select}/>}
                {panel === 'coverage' && data && <CoveragePanel report={data.report} onLocate={setFocusLocation}/>}
                {panel === 'feedback' && <FeedbackPanel key={data?.report.id || 'history'} report={data?.report ?? null} onSelect={select}/>}
                {panel === 'records' && data && <FullReport report={data.report} onSelect={select}/>}
              </div>
            </section>
          )}
        </aside>

        <svg className="margin-leader" aria-hidden="true" focusable="false">
          <path ref={leader.path} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke"/>
        </svg>
      </section>
    </main>

    {configOpen && <Configuration settings={settings} onApply={applySettings} onClose={() => setConfigOpen(false)} pack={pack} skill={skill} stage={stage} kind={kind} capability={capability} modelState={modelState} offlineReady={offlineReady} onLoadModel={loadModel} onCancelModel={() => runtime.current.cancel()}/>}
    {guideOpen && <GettingStarted onClose={dismissGuide} onSample={() => void sample(0)} sampleDisabled={locked}/>}
  </div></TeacherFeedbackProvider>;
}
