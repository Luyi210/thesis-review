import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

const GROUPS = [
  {
    title: '文件与报告',
    items: [
      { keys: [MOD, 'O'], label: '打开或重新上传论文原稿' },
      { keys: [MOD, 'P'], label: '打印或导出审阅摘要 PDF' },
    ],
  },
  {
    title: '批注与导航',
    items: [
      { keys: ['J', ']'], label: '下一处批注' },
      { keys: ['K', '['], label: '上一处批注' },
      { keys: ['↑', '↓'], label: '焦点在批注区时切换批注' },
      { keys: ['1', '–', '5'], label: '切换右侧面板（批注 / 记录 / 图表 / 对比 / 反馈）' },
      { keys: ['Esc'], label: '关闭当前弹窗或返回页边批注' },
    ],
  },
  {
    title: '纸面缩放与查看',
    items: [
      { keys: [MOD, '+'], label: '放大论文原稿' },
      { keys: [MOD, '-'], label: '缩小论文原稿' },
      { keys: [MOD, '0'], label: '重置为 100% 原始比例' },
      { keys: ['?'], label: '打开或关闭本快捷键说明' },
    ],
  },
];

export function ShortcutsDialog({ onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    dialog.current?.showModal();
    closeRef.current?.focus();
  }, []);

  return (
    <dialog className="shortcuts-dialog" ref={dialog} aria-labelledby="shortcuts-title"
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
      onKeyDown={e => {
        if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          e.currentTarget.close();
        }
      }}>
      <header>
        <h2 id="shortcuts-title">键盘快捷键</h2>
        <button type="button" ref={closeRef} className="icon-button" aria-label="关闭快捷键说明" onClick={() => dialog.current?.close()}>
          <X size={16} aria-hidden="true"/>
        </button>
      </header>
      <div className="shortcuts-body">
        {GROUPS.map(group => (
          <div className="shortcut-group" key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.items.map(item => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <span className="kbd-group">
                    {item.keys.map((k, idx) => (
                      k === '–' ? <span key={idx} className="kbd-sep">–</span> : <kbd key={idx}>{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </dialog>
  );
}
