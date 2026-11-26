import type { AppConfig } from '@mlc-ai/web-llm';

export const BASE_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';
export const COLLEGE_MODEL_ID = 'College-Qwen3-1.7B-v3-q4f16_1-MLC';

export function collegePackageUrl(value: string | undefined, development: boolean): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    const loopback = development && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopback) return;
    if (url.username || url.password || url.search || url.hash) return;
    const revision = url.pathname.match(/\/resolve\/([A-Za-z0-9._-]+)\/?$/)?.[1];
    if (!revision || ['main', 'master', 'latest'].includes(revision)) return;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch { /* An unconfigured build offers the original models. */ }
}

const packageUrl = collegePackageUrl(import.meta.env.VITE_COLLEGE_MODEL_URL, import.meta.env.DEV);

export const collegeModel = packageUrl ? {
  id: COLLEGE_MODEL_ID,
  url: packageUrl,
  name: '学院微调版 · Qwen3 1.7B',
  download: '约 1 GB',
  estimatedMemory: '约 2.0 GB',
  role: '开题批注试用',
} : undefined;

export function browserModelConfig(prebuilt: AppConfig, modelUrl = packageUrl): AppConfig {
  const base = prebuilt.model_list.find(model => model.model_id === BASE_MODEL_ID);
  const config = { ...prebuilt, cacheBackend: 'cache' as const };
  if (!modelUrl || !base) return config;
  const variant = {
    ...base, model_id: COLLEGE_MODEL_ID, model: modelUrl,
    model_manifest: undefined, integrity: undefined,
  };
  return { ...config, model_list: [...prebuilt.model_list, variant] };
}
