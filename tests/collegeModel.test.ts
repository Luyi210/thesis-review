import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { OccurrenceExplanation, type ExplanationControls } from '../src/components/OccurrenceExplanation';
import type { Check } from '../src/domain/types';
import { BASE_MODEL_ID, COLLEGE_MODEL_ID, browserModelConfig, collegePackageUrl } from '../src/model/college';

const packageUrl = 'https://models.example.test/college/resolve/7a5b2c3/';
const stockUrl = 'https://models.example.test/stock';
const stockLibrary = 'https://models.example.test/runtime/qwen3-1.7b.wasm';
const stock: AppConfig = {
  model_list: [{ model_id: BASE_MODEL_ID, model: stockUrl, model_lib: stockLibrary,
    overrides: { context_window_size: 4096 } }],
};
const mlc = vi.hoisted(() => ({
  cache: vi.fn<typeof import('@mlc-ai/web-llm').hasModelInCache>(),
  create: vi.fn<typeof import('@mlc-ai/web-llm').CreateWebWorkerMLCEngine>(),
}));
vi.mock('@mlc-ai/web-llm', () => ({
  prebuiltAppConfig: stock, hasModelInCache: mlc.cache, CreateWebWorkerMLCEngine: mlc.create,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('college model registration', () => {
  it('accepts an HTTPS versioned package and admits HTTP only on loopback in development', () => {
    expect(collegePackageUrl(packageUrl.slice(0, -1), false)).toBe(packageUrl);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const url = `http://${host}:5178/college/resolve/v3/`;
      expect(collegePackageUrl(url, true)).toBe(url);
      expect(collegePackageUrl(url, false)).toBeUndefined();
    }
    expect(collegePackageUrl('http://localhost.example.test/college/resolve/v3/', true)).toBeUndefined();
    expect(collegePackageUrl('http://models.example.test/college/resolve/v3/', true)).toBeUndefined();
  });

  it('rejects unversioned and mutable aliases, credentials, queries, and fragments', () => {
    for (const path of ['college/', 'college/resolve/main/', 'college/resolve/master/', 'college/resolve/latest/']) {
      expect(collegePackageUrl(`https://models.example.test/${path}`, false)).toBeUndefined();
    }
    expect(collegePackageUrl(packageUrl.replace('https://', 'https://user:pass@'), false)).toBeUndefined();
    expect(collegePackageUrl(`${packageUrl}?token=anything`, false)).toBeUndefined();
    expect(collegePackageUrl(`${packageUrl}#fragment`, false)).toBeUndefined();
  });

  it('keeps stock model identity and URL while registering custom weights with the compatible library', () => {
    const config = browserModelConfig(stock, packageUrl);

    expect(config.cacheBackend).toBe('cache');
    expect(stock.model_list).toHaveLength(1);
    expect(config.model_list).toHaveLength(2);
    expect(config.model_list[0]).toEqual(stock.model_list[0]);
    expect(config.model_list[1]).toMatchObject({
      model_id: COLLEGE_MODEL_ID, model: packageUrl, model_lib: stockLibrary, overrides: { context_window_size: 4096 },
    });
    expect(COLLEGE_MODEL_ID).not.toBe(BASE_MODEL_ID);
    expect(config.model_list[1].model).not.toBe(stockUrl);
  });

  it('falls back to the stock model without dropping saved rule settings when the package is absent', async () => {
    vi.stubEnv('VITE_COLLEGE_MODEL_URL', undefined);
    vi.resetModules();
    const { DEFAULT_SETTINGS, MODELS, readSettings } = await import('../src/domain/config');
    const saved = { ...DEFAULT_SETTINGS, modelId: COLLEGE_MODEL_ID, contextWindow: 2048, disabledRules: ['FMT-A4'] };
    const getItem = vi.fn(() => JSON.stringify(saved));
    vi.stubGlobal('localStorage', { getItem });

    expect(MODELS.some(model => model.id === COLLEGE_MODEL_ID)).toBe(false);
    expect(readSettings()).toEqual({ ...saved, modelId: BASE_MODEL_ID });
    expect(getItem).toHaveBeenCalledWith('thesis-settings-v1');
  });
});

const finding: Check = {
  status: 'warning', executed: true, summary: '', items: [],
  rule: { id: 'FMT-SIZE', mode: 'body_size', title: '正文字号', stages: ['proposal'], strength: 'required', note: '',
    source: { section: '正文', pdf_page: 6, quote: '正文使用小四号字。' }, params: { expected_pt: 12 } },
};

function contribution(controls: Partial<ExplanationControls>, check = finding) {
  return renderToStaticMarkup(createElement(OccurrenceExplanation, {
    target: 'sample/issue/-1', check, itemIndex: -1,
    controls: { modelId: BASE_MODEL_ID, phase: 'idle', pendingKey: null, errors: {}, results: {},
      onExplain: vi.fn(), onConfigure: vi.fn(), onCancel: vi.fn(), ...controls },
  }));
}

describe('college model download options in an annotation', () => {
  const collegeChoice = { onLoad: vi.fn(), download: '约 1 GB' };

  it('shows a direct college download alongside the stock option only when the host supplies it', () => {
    const stockControls = { onLoadModel: vi.fn(), modelDownload: '约 984 MB' };
    const markup = contribution({ ...stockControls, collegeChoice });

    expect(markup).toContain('下载学院微调版（约 1 GB）');
    expect(markup).toContain('下载或加载本机模型');
    expect(contribution(stockControls)).not.toContain('下载学院微调版');
  });

  it.each(['body_line', 'footnote_brackets'])('shows rule advice and no college action for %s when the college model is selected', mode => {
    const check = { ...finding, rule: { ...finding.rule, mode } };

    expect(contribution({ collegeChoice, onLoadModel: vi.fn() }, check)).not.toContain('下载学院微调版');
    const markup = contribution({ collegeChoice, modelId: COLLEGE_MODEL_ID, phase: 'ready' }, check);
    expect(markup).toContain('这处批注使用规则的核对意见');
    expect(markup).not.toContain('用学院微调版解释');
  });

  it('replaces the college download with cancellable progress while loading and a model-specific button once ready', () => {
    const controls = { collegeChoice, modelId: COLLEGE_MODEL_ID };
    const loading = contribution({ ...controls, phase: 'loading', modelProgress: 0.25 });

    expect(loading).toContain('正在准备学院微调版');
    expect(loading).toContain('value="0.25"');
    expect(loading).toContain('取消准备本机模型');
    expect(loading).not.toContain('下载学院微调版');
    expect(contribution({ modelId: COLLEGE_MODEL_ID, phase: 'ready' })).toContain('用学院微调版解释');
    expect(contribution({ collegeChoice, phase: 'ready', pendingKey: 'other-rule' })).not.toContain('下载学院微调版');
  });
});

async function configuredRuntime() {
  vi.stubEnv('VITE_COLLEGE_MODEL_URL', packageUrl);
  vi.resetModules();
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; });
  vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn(async () => ({ limits: { maxBufferSize: 256 * 1024 ** 2 } })) } });
  const { BrowserModel } = await import('../src/model/runtime');
  const { DEFAULT_SETTINGS } = await import('../src/domain/config');
  return { runtime: new BrowserModel(), terminate, settings: { ...DEFAULT_SETTINGS, modelId: COLLEGE_MODEL_ID } };
}

describe('college model runtime', () => {
  it('uses the same registered model source and cache backend for cache probes and worker loading', async () => {
    const { runtime, settings } = await configuredRuntime();
    mlc.cache.mockResolvedValue(true);
    mlc.create.mockResolvedValue({} as WebWorkerMLCEngine);

    expect(await runtime.checkCache(settings.modelId)).toBe(true);
    await runtime.load(settings);

    const [, id, options, chat] = mlc.create.mock.calls[0];
    expect(id).toBe(COLLEGE_MODEL_ID);
    expect(options?.appConfig).toEqual(browserModelConfig(stock, packageUrl));
    expect(chat).toEqual({ context_window_size: settings.contextWindow });
    expect(mlc.cache.mock.calls).toEqual([[COLLEGE_MODEL_ID, options?.appConfig], [COLLEGE_MODEL_ID, options?.appConfig]]);
    expect(mlc.cache.mock.calls[1][1]).toBe(options?.appConfig);
    expect(runtime.state).toMatchObject({ phase: 'ready', modelId: COLLEGE_MODEL_ID, cached: true });
    runtime.dispose();
  });

  it('settles a cancelled load promptly and ignores late progress from the terminated worker', async () => {
    const { runtime, settings, terminate } = await configuredRuntime();
    vi.useFakeTimers();
    mlc.create.mockImplementation(() => new Promise(() => {}));

    const pending = runtime.load(settings);
    await vi.dynamicImportSettled();
    expect(mlc.create).toHaveBeenCalledOnce();
    const reportProgress = mlc.create.mock.calls[0][2]?.initProgressCallback;
    reportProgress?.({ progress: 0.4, timeElapsed: 0, text: '模拟下载' });
    expect(runtime.state).toMatchObject({ phase: 'loading', modelId: COLLEGE_MODEL_ID, progress: 0.4 });

    let settled = false;
    void pending.then(() => { settled = true; });
    runtime.cancel();
    await vi.advanceTimersByTimeAsync(0);
    reportProgress?.({ progress: 1, timeElapsed: 0, text: '模拟过期下载事件' });

    expect(settled).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
    expect(runtime.state).toMatchObject({ phase: 'idle', progress: 0 });
    expect(mlc.cache).not.toHaveBeenCalled();
  });
});
