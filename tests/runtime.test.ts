import { afterEach, expect, it, vi } from 'vitest';
import { BrowserModel } from '../src/model/runtime';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import type { Check, Report, Skill } from '../src/domain/types';

const check = { rule: { id: 'FMT-FONT', title: '字体', source: { pdf_page: 6, quote: '宋体' } }, summary: '已记录', status: 'fail', items: [] } as unknown as Check;
const report = { stage: 'predefense', document: { sha256: 'test' }, kind: 'thesis', id: 'version-a' } as Report;
const skill = { stage: 'predefense', instructions: ['只解释证据'], version: '0.1' } as Skill;
afterEach(() => vi.useRealTimers());
function activeRuntime() {
  const runtime = new BrowserModel();
  const worker = { terminate: vi.fn() };
  const internals = runtime as any;
  internals.worker = worker;
  internals.engine = { tokenize: vi.fn().mockResolvedValue([]), chat: { completions: { create: vi.fn(() => new Promise(() => {})) } } };
  runtime.state = { phase: 'ready', progress: 1, text: 'ready', modelId: DEFAULT_SETTINGS.modelId };
  return { runtime, worker };
}
it('cancel immediately rejects a running explanation and never returns to ready', async () => {
  const { runtime, worker } = activeRuntime();
  const job = runtime.explain(report, check, skill, DEFAULT_SETTINGS);
  const result = expect(job).rejects.toThrow('取消');
  await Promise.resolve();
  expect(runtime.state.phase).toBe('generating');
  runtime.cancel(); await result;
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(runtime.state.phase).toBe('idle');
});
it('timeout terminates the worker before another generation can use it', async () => {
  vi.useFakeTimers();
  const { runtime, worker } = activeRuntime();
  const job = runtime.explain(report, check, skill, DEFAULT_SETTINGS);
  const result = expect(job).rejects.toThrow('180秒');
  await vi.advanceTimersByTimeAsync(180001); await result;
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(runtime.state.phase).toBe('idle');
});
