#!/bin/zsh
# Double-click in Finder, then open the local URL printed in this terminal.
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 20 或更高版本。'
  read -r '?按回车退出…'
  exit 1
fi
exec node server.mjs
