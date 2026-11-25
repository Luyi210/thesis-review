import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'http://127.0.0.1:5178/';
const open = () => {
  if (process.platform === 'darwin' && !process.argv.includes('--no-open')) spawn('/usr/bin/open', [url], { stdio: 'ignore' }).unref();
  console.log(`\n论文审核工作台：${url}\n首次准备模型需联网；文件检查在浏览器内进行。\n关闭此终端或按 Ctrl+C 可停止本机预览。\n`);
};
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
  if ((await response.text()).includes('学院论文审核')) { open(); process.exit(0); }
  console.error('5178端口被其他服务使用，请关闭占用该端口的程序后重试。'); process.exit(1);
} catch { /* No existing preview: start the owned local process. */ }
if (!existsSync(path.join(root, 'dist/index.html'))) {
  console.error('尚未构建网页。请先在此文件夹执行 pnpm install 与 pnpm build。'); process.exit(1);
}
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: root, stdio: ['inherit', 'pipe', 'inherit'] });
let opened = false;
server.stdout.on('data', bytes => { process.stdout.write(bytes); if (!opened && bytes.toString().includes('127.0.0.1:5178')) { opened = true; open(); } });
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
