# 工作状态图鉴 · 0.13.0

入口：`/web/current-state-gallery.html`；源素材画册：`/web/design.html`。短工具真实渲染验收：`/web/tool-presentation-review.html`，可直接比较普通切换与短工具切换。

脸部主要正面朝镜头；身体和道具可朝左表达任务，不要求脸必须朝左。

三种皮肤各对应 21 个状态、21 张独立动作 PNG，共 63 张状态卡。图鉴与客户端读取同一份 `src/skin.mjs` 映射；手动预览不发送任务或更改客户端设置。

| 状态 | 动作 | 素材版本 |
| --- | --- | --- |
| `thinking` | 站立托下巴思考，不拿书 | v3 |
| `working` | 俯身操作低位工具箱与机械部件 | v3 |
| `retrying` | 操作手摇轮，重新启动 | v3 |
| `queued` | 坐在小凳上捧着大沙漏等待 | v3 |
| `error` | 身体后仰、双手抬起，一手扶额 | v3 |
| `disconnected` | 双手拉开两只大插头 | v3 |
| `stopped` | 胸前交叉前臂，摆出大 X | v3 |
| `complete` | 轻提裙摆、浅浅鞠躬 | v3 |
| `reading` | 翻阅打开的书，手指沿页查阅 | v2 |
| `writing` | 桌边执笔在本子上写字 | v2 |
| `searching` | 用放大镜检查展开的蓝图 | v2 |
| `delegating` | 伸手递出任务卡 | v2 |
| `compacting` | 把书放回左侧书架 | v2 |
| `executing` | 在电脑前操作终端 | 原 working-v1 |
| `idle` | 空会话安静等待 | 原 intro-away-v1 |
| `answering` | 抬手回应，温柔解释 | v1 |
| `parallel` | 双臂展开，照看并行工作 | v1 |
| `waiting` | 向前递出确认板 | v1 |
| `connecting` | 斜向伸手寻找连接 | v1 |
| `paused` | 放松靠坐，清醒等待恢复 | v1 |
| `blocked` | 一掌前伸，请求介入 | v1 |

`working` 与 `executing`、`complete` 与 `answering` 各自使用独立源图。真实完成状态保持六秒；随后进入 `idle` 时，仅对已确认正常完成的对话保留回应收尾，空会话仍使用待机图。

十二帧、3.9 秒的新会话肩上开场保持原有配置。工具动作的 900ms 停留从实际淡入完成后计算；加载等待最多三秒，旧开场期间的短工具不补播。详见 [任务神态与接入边界](activity-states.md)。

此文档记录映射与展示设计，不代替源图检查、完整测试或原生客户端验收。
