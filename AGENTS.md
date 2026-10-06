# deepseekdeskskin

- 本项目独立于 LLMPET 和 deepseekdesk：禁止引用它们的源码、运行目录或配置文件。
- 核心预览、设置、导入导出必须在没有安装 DeepSeek 的机器上运行。
- DeepSeek Harness 集成只放在 adapters/，采用可安装/卸载的插件，不修改客户端应用包。
- 用户配置只写入 DEEPSEEKDESKSKIN_HOME 或 ~/.deepseekdeskskin。
- 素材独立存放于 assets/，保留来源署名；不把参考实现 .research/ 打包发布。
- 验证 npm test，并用真实浏览器检查静态、动态切换和设置保存。
