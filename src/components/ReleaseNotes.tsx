import './releaseNotes.css';

const releases = [
  {
    version: 'v0.8.3',
    date: '2026-11-27',
    title: '完整论文修订对比',
    changes: [
      '首页可一键对比同一篇合成论文的原稿与修订稿，自动打开版本对比。',
      '修订稿改正了字体、字号、行距和字距，并保留纸张尺寸、题注位置和编号问题，便于对照。',
    ],
  },
  {
    version: 'v0.8.2',
    date: '2026-11-27',
    title: '完整论文演示',
    changes: [
      '首页可打开带封面、摘要、目录、图表和参考文献的合成论文。',
      '演示稿按预答辩论文核对，可定位预设的字体、字号、固定行距、字距和题注问题。',
    ],
  },
  {
    version: 'v0.8.1',
    date: '2026-11-26',
    title: 'PDF 小标题识别试用',
    changes: [
      'PDF 正文字号检查遇到疑似编号小标题时，会将该处列为「需人工确认」，并保留实测字号和原页位置。',
      '从 IBM DocLayNet 选取 3,200 页用于训练、验证和测试。轻量标题分类器在浏览器中运行。',
      '补充了使用说明中的上传、批注定位和版本对比步骤，并加入本页更新记录。',
    ],
  },
  {
    version: 'v0.8.0',
    date: '2026-11-26',
    title: '学院微调版一键下载',
    changes: [
      '在支持的批注中展开「补充解释」，可下载第三轮 Qwen 学院微调版。首次约 1 GB，下载后在浏览器中运行。',
      '字号建议明确指出在 Word 或 WPS 的字号设置中操作，保留原稿文字、数字和公式。',
      '从「全部批注」可跳到原稿对应位置。修正 Word 浮动图片的预览位置，完善 Word 和 PDF 的图题识别及 PDF 跨行日期核对。',
    ],
  },
  {
    version: 'v0.7.0',
    date: '2026-11-25',
    title: 'Word 片段批注与教师反馈',
    changes: [
      '同一段有多处格式问题时，可分别查看对应文字、实测值和补充解释。',
      '教师可在具体批注下填写修改意见，并导出本次会话的反馈。',
    ],
  },
  {
    version: 'v0.6.0',
    date: '2026-11-25',
    title: '网页工作台首次发布',
    changes: [
      '上传 Word 或 PDF 后，可在原稿旁查看格式问题、学院指南依据和修改建议。',
    ],
  },
];

export function ReleaseNotes() {
  return (
    <ol className="release-timeline" role="list">
      {releases.map(({ version, date, title, changes }) => (
        <li className="release-entry" key={title}>
          <div className="release-meta">
            {version && <span className="release-version">{version}</span>}
            <time dateTime={date}>{date}</time>
          </div>
          <h3>{title}</h3>
          <ul className="release-changes">
            {changes.map(change => <li key={change}>{change}</li>)}
          </ul>
        </li>
      ))}
    </ol>
  );
}
