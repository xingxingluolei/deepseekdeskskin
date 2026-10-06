# macOS 安装说明

只想把皮肤装进客户端，可以直接使用快速安装器；不需要下载源码、安装 Node.js、Homebrew、Git 或运行皮肤工作室。

## 快速安装

1. 先安装 DeepSeek Harness，至少打开过一次，让客户端初始化。等待任务结束，按 `⌘Q` 完全退出；只关窗口不够。
2. 打开 macOS「终端」，执行：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/xingxingluolei/deepseekdeskskin/main/scripts/install-macos.sh | /bin/bash
   ```

3. 等待成功提示，再打开 Harness。左侧「切换皮肤」可选澄蓝、经典女仆、经典女仆 Q版；「皮肤详情」可查看状态动作。无需退出账号或重新登录。

安装器使用客户端自带的运行环境和官方插件命令。首次下载约 236 MiB，SHA-256 校验通过才会安装；安装后还会检查实际包名、版本与启用状态。不会修改客户端应用包，不会自动关闭或终止进程。

目前安装器仅支持 macOS，适配基线为 DeepSeek Harness 0.2.0-rc.2。Windows/Linux 客户端安装尚未验证。

## 希望先检查脚本

[查看安装器源码](../scripts/install-macos.sh)，或先下载再阅读：

```sh
curl -fsSL https://raw.githubusercontent.com/xingxingluolei/deepseekdeskskin/main/scripts/install-macos.sh -o install-macos.sh
less install-macos.sh
/bin/bash install-macos.sh --check
/bin/bash install-macos.sh
```

`--check` 只检查系统、客户端内置运行环境和已初始化的 desktop profile，不安装、不下载，也不保证客户端已完全退出。请以当前用户运行，不要加 `sudo`。

## 客户端不在默认位置

自动识别 `/Applications/DeepSeek Harness.app` 和 `~/Applications/DeepSeek Harness.app`。其他位置用下载好的脚本指定：

```sh
/bin/bash install-macos.sh --app "/你的目录/DeepSeek Harness.app"
```

`--app` 可以与 `--check`、`--package` 或 `--uninstall` 组合。

## GitHub 下载慢，或已经下载过安装包

从 [v0.13.0 发行页](https://github.com/xingxingluolei/deepseekdeskskin/releases/tag/v0.13.0) 下载 `install-macos.sh` 和 `deepseekdeskskin-harness-0.13.0.tgz`，执行：

```sh
/bin/bash "$HOME/Downloads/install-macos.sh" \
  --package "$HOME/Downloads/deepseekdeskskin-harness-0.13.0.tgz"
```

同样会验证 SHA-256，并将包保存到持久缓存再交给官方 CLI，因此完成后可以删除下载目录中的副本。`--package` 仅接受本安装器固定版本的官方仓库发行文件。工作室导出的定制包使用 [README 中的手动安装命令](../README.md#macos-快速安装)。

缓存位于 `~/.deepseekdeskskin/downloads/v0.13.0/`，设置 `DEEPSEEKDESKSKIN_HOME` 后则写入指定目录。重复运行会重新校验缓存并复用，避免重复下载。官方 profile 会引用此缓存文件，安装期间及未来更新时请保留它。

## 更新与卸载

更新：任务结束后按 `⌘Q` 完全退出，再运行同一条快速安装命令。官方 CLI 直接更新，**无需先卸载**。用户原有的插件停用状态会保留；安装器如果提示此前已停用，请在客户端 Plugins 中重新启用。

卸载：同样先完全退出客户端，再执行：

```sh
/bin/bash install-macos.sh --uninstall
```

随后重新打开 Harness。卸载通过官方 CLI 移除皮肤，不操作聊天记录或登录信息；本地安装包缓存会保留。

## 常见问题

| 提示或现象 | 处理方式 |
| --- | --- |
| 找不到 DeepSeek Harness | 先安装客户端；若位置不同，用 `--app` 指定 `.app` 路径。 |
| 找不到可用的 desktop profile | 打开客户端一次完成初始化，再按 `⌘Q` 完全退出。 |
| 提示客户端/profile 正在运行 | 等待任务结束后按 `⌘Q`，不要只关闭窗口，再次运行。 |
| 下载失败 | 检查 GitHub 连通性后重试，或使用发行页下载与 `--package`。 |
| SHA-256 不匹配 | 不会继续安装；重新下载本仓库对应版本，定制包走手动安装。 |
| 官方 CLI 安装失败 | 保留错误信息；安装包缓存还在，可修复原因后重试。 |
| 安装命令完成，但核对版本失败 | 暂不视为安装成功，检查官方 CLI 输出后重试。 |
| 安装成功后没有皮肤入口 | 重新打开客户端；如果之前停用了插件，到 Plugins 中重新启用。 |

安装器不自动添加兼容性豁免。若其他 Harness 版本拒绝插件，应先核对版本兼容性。
