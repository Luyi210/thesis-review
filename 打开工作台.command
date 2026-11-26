#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
THESIS_WEB_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$THESIS_WEB_NODE" ]]; then
  THESIS_WEB_NODE="$(command -v node || true)"
fi
if [[ -z "$THESIS_WEB_NODE" || ! -x "$THESIS_WEB_NODE" ]]; then
  echo '本机开发预览需要 Node.js 22 或更新版本。直接访问在线工作台时无需安装 Node.js。'
  read 'THESIS_WEB_FINISH?按回车结束。'
  exit 1
fi
"$THESIS_WEB_NODE" scripts/start.mjs
