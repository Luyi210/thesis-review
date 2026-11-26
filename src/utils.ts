import type { CheckItem, Rule } from './domain/types';

// Vite supplies "/" locally and the repository path for a project Pages site.
export function publicAsset(relativePath: string) {
  return import.meta.env.BASE_URL + relativePath;
}

export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function prettyPosition(location: { page?: number; paragraph?: number; section?: number }) {
  if (location.page) return `PDF 第 ${location.page} 页${location.paragraph ? ` · 文字行 ${location.paragraph}` : ''}`;
  if (location.paragraph) return `源段落 ${location.paragraph}`;
  if (location.section) return `第 ${location.section} 节页面设置`;
  return '全文 / 范围待确认';
}

export function prettyItemPosition(rule: Rule, item: CheckItem) {
  if (rule.mode === 'footnote_brackets' && item.location.page && item.expected) {
    const number = item.expected.match(/[0-9０-９]+/u)?.[0];
    if (number) return `PDF 第 ${item.location.page} 页 · 脚注 ${number}`;
  }
  return prettyPosition(item.location);
}
