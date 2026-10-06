#!/bin/bash
# macOS Bash 3.2 compatible. All work starts at the final main call, so an
# incomplete curl download cannot execute a partially defined installer.
set -euo pipefail

dss_version='0.13.0'
dss_package='deepseekdeskskin-harness-0.13.0.tgz'
dss_sha256='319f671f2cbaee04eb798e6e3bde33b2d68a40f03d8cbeacf8cfb493c9ff7d41'
dss_url="https://github.com/xingxingluolei/deepseekdeskskin/releases/download/v${dss_version}/${dss_package}"
dss_app=''
dss_cli=''
dss_node=''
dss_local_package=''
dss_action='install'
dss_temp=''

dss_fail() { printf '\n安装未完成：%s\n' "$*" >&2; exit 1; }
dss_cleanup() { if [ -n "$dss_temp" ]; then rm -f -- "$dss_temp"; fi; }
dss_usage() {
  cat <<'HELP'
deepseekdeskskin · macOS 快速安装

  bash install-macos.sh                     下载、校验并安装/更新皮肤
  bash install-macos.sh --check             只检查系统与客户端位置
  bash install-macos.sh --app "/路径/DeepSeek Harness.app"
  bash install-macos.sh --package "/路径/deepseekdeskskin-harness-0.13.0.tgz"
  bash install-macos.sh --uninstall         通过官方 CLI 卸载皮肤

请先打开过客户端一次，然后结束任务并按 ⌘Q 完全退出再安装。
不需要 sudo、Node.js 或 Homebrew。不会自动关闭客户端。
兼容基线：DeepSeek Harness 0.2.0-rc.2。仅支持 macOS。
HELP
}

dss_find_app() {
  if [ -n "$dss_app" ]; then
    dss_app="${dss_app%/}"
    dss_cli="$dss_app/Contents/Resources/runtime/cli/bin/dsh"
    [ -x "$dss_cli" ] || dss_fail "指定目录不是可用的 DeepSeek Harness 客户端：$dss_app"
    return
  fi
  for dss_candidate in '/Applications/DeepSeek Harness.app' "$HOME/Applications/DeepSeek Harness.app"; do
    if [ -x "$dss_candidate/Contents/Resources/runtime/cli/bin/dsh" ]; then
      dss_app="$dss_candidate"
      dss_cli="$dss_app/Contents/Resources/runtime/cli/bin/dsh"
      return
    fi
  done
  dss_fail '找不到 DeepSeek Harness。请先安装并打开一次客户端，将其放入「应用程序」；自定义位置可用 --app 指定。'
}

dss_digest_matches() {
  [ -f "$1" ] || return 1
  local dss_digest
  dss_digest=$(shasum -a 256 "$1") || return 1
  [ "${dss_digest%% *}" = "$dss_sha256" ]
}

dss_check_profile() {
  dss_node="$dss_app/Contents/MacOS/DeepSeek Harness"
  [ -x "$dss_node" ] || dss_fail '客户端内置运行环境不完整，请重新安装 DeepSeek Harness。'
  ELECTRON_RUN_AS_NODE=1 "$dss_node" --expose-internals -e '
    const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
    const env=process.env.DSH_HOME;
    let home=env&&env.trim()?env:path.join(os.homedir(),".dsh");
    if(home==="~")home=os.homedir();
    else if(home.startsWith("~/"))home=path.join(os.homedir(),home.slice(2));
    const file=path.resolve(home,"profiles/desktop/package.json");
    if(!fs.existsSync(file))process.exit(1);
    JSON.parse(fs.readFileSync(file,"utf8"));
  ' || dss_fail '未找到可用的 desktop profile。请先打开 DeepSeek Harness 一次，然后 ⌘Q 完全退出后重试。'
}

dss_verify_installation() {
  local dss_inventory dss_state
  dss_inventory=$("$dss_cli" plugin --profile desktop list deepseekdeskskin-harness --depth 0 --json) \
    || dss_fail '安装命令已结束，但官方 CLI 的安装结果检查失败。请查看上面的错误信息。'
  dss_state=$(printf '%s' "$dss_inventory" | ELECTRON_RUN_AS_NODE=1 "$dss_node" --expose-internals -e '
    const fs=require("node:fs"),path=require("node:path");
    let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",part=>input+=part);
    process.stdin.on("end",()=>{
      const name="deepseekdeskskin-harness", version=process.argv[1];
      const rows=JSON.parse(input);
      const row=Array.isArray(rows)&&rows.find(row=>row.dependencies?.[name]);
      const entry=row?.dependencies?.[name];
      if(!entry?.path||!row.path)throw Error("安装结果中缺少皮肤包");
      const pkg=JSON.parse(fs.readFileSync(path.join(entry.path,"package.json"),"utf8"));
      if(pkg.name!==name||pkg.version!==version)throw Error("已安装皮肤版本不匹配");
      const profile=JSON.parse(fs.readFileSync(path.join(row.path,"package.json"),"utf8"));
      process.stdout.write(profile.dsh?.profile?.bundles?.includes(name)?"enabled":"disabled");
    });
  ' "$dss_version") || dss_fail '安装结果未通过版本核对，暂不报告安装成功。'
  if [ "$dss_state" = 'disabled' ]; then
    printf '保留了你之前停用插件的设置；请在客户端 Plugins 中重新启用本皮肤。\n'
  fi
}

dss_cache_local_package() {
  local dss_cache dss_source
  dss_source="$dss_local_package"
  dss_digest_matches "$dss_source" || dss_fail '本地文件不是本安装器对应的 v0.13.0 发行包（SHA-256 不匹配）。'
  dss_cache="${DEEPSEEKDESKSKIN_HOME:-$HOME/.deepseekdeskskin}/downloads/v${dss_version}"
  mkdir -p -- "$dss_cache"
  dss_local_package="$dss_cache/$dss_package"
  if ! dss_digest_matches "$dss_local_package"; then
    dss_temp=$(mktemp "$dss_cache/.download.XXXXXX")
    cp -- "$dss_source" "$dss_temp"
    dss_digest_matches "$dss_temp" || dss_fail '复制后的文件校验失败，未执行安装。'
    mv -f -- "$dss_temp" "$dss_local_package"
    dss_temp=''
  fi
}

dss_download() {
  local dss_cache
  dss_cache="${DEEPSEEKDESKSKIN_HOME:-$HOME/.deepseekdeskskin}/downloads/v${dss_version}"
  mkdir -p -- "$dss_cache"
  dss_local_package="$dss_cache/$dss_package"
  if dss_digest_matches "$dss_local_package"; then
    printf '使用已校验的安装包缓存。\n'
    return
  fi
  command -v curl >/dev/null 2>&1 || dss_fail '找不到 macOS 自带的 curl 命令。'
  dss_temp=$(mktemp "$dss_cache/.download.XXXXXX")
  printf '下载皮肤 v%s（约 236 MiB），请等待进度条完成…\n' "$dss_version"
  curl --fail --location --show-error --progress-bar --retry 3 --connect-timeout 20 \
    --proto '=https' --proto-redir '=https' "$dss_url" --output "$dss_temp" \
    || dss_fail '下载失败，未执行安装。检查 GitHub 连接后重试，或下载发行包并使用 --package 指定本地文件。'
  dss_digest_matches "$dss_temp" || dss_fail '安装包 SHA-256 不匹配，未执行安装。请重新下载。'
  mv -f -- "$dss_temp" "$dss_local_package"
  dss_temp=''
}

dss_main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --app|--package)
        [ "$#" -ge 2 ] && [ -n "$2" ] || dss_fail "$1 后需要填写路径。"
        if [ "$1" = '--app' ]; then dss_app="$2"; else dss_local_package="$2"; fi
        shift 2 ;;
      --check|--uninstall)
        [ "$dss_action" = 'install' ] || dss_fail '--check 和 --uninstall 不能一起使用。'
        dss_action="${1#--}"; shift ;;
      --help|-h) dss_usage; return ;;
      *) dss_fail "未知选项：$1。用 --help 查看说明。" ;;
    esac
  done
  [ "$(uname -s)" = 'Darwin' ] || dss_fail '当前快速安装器仅支持 macOS；Windows/Linux 安装尚未提供。'
  [ "$(id -u)" != '0' ] || dss_fail '请以当前登录用户运行，不要加 sudo。'
  dss_find_app
  dss_check_profile
  printf '客户端：%s\n' "$dss_app"
  printf '适配基线：DeepSeek Harness 0.2.0-rc.2\n'
  if [ "$dss_action" = 'check' ]; then
    printf '基础环境检查通过（客户端与 profile 可用）。安装前仍须 ⌘Q 完全退出客户端。\n'
    printf '安装使用客户端自带运行环境，不需要另外安装 Node.js。\n'
    return
  fi
  if [ "$dss_action" = 'uninstall' ]; then
    "$dss_cli" plugin --profile desktop remove deepseekdeskskin-harness \
      || dss_fail '官方 CLI 卸载失败，请查看上面的错误信息。'
    printf '\n皮肤已卸载。退出并重新打开 DeepSeek Harness 后生效。\n'
    return
  fi
  command -v shasum >/dev/null 2>&1 || dss_fail '找不到 macOS 自带的 shasum 命令。'
  trap dss_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [ -z "$dss_local_package" ]; then
    dss_download
  else
    dss_cache_local_package
  fi
  dss_local_package="$(cd -- "$(dirname -- "$dss_local_package")" && pwd -P)/$(basename -- "$dss_local_package")"
  printf 'SHA-256 校验通过。通过官方 CLI 安装到 desktop profile…\n'
  "$dss_cli" plugin --profile desktop add "$dss_local_package" --ignore-scripts \
    || dss_fail '官方 CLI 安装失败，请查看上面的错误信息；安装包已保留，可以重新运行本命令。'
  dss_verify_installation
  printf '\n皮肤 v%s 已安装。\n' "$dss_version"
  printf '请退出并重新打开 DeepSeek Harness，无需退出账号。\n'
  printf '进入客户端左侧「切换皮肤」选择澄蓝、经典女仆或 Q 版。\n'
}

dss_main "$@"
