# dsh-llm-minimax

把 **MiniMax 官方开放平台**（api.minimaxi.com / api.minimax.io）的模型放进 DeepSeek Harness 的模型选择列表，Key 直接在设置页里填，并显示套餐额度。

## 安装

需要 DeepSeek Harness 0.2.x。

**在 Web 界面里装**：侧边栏 → **插件** → **添加插件** → **安装第三方插件**，粘贴仓库地址：

```
https://github.com/elfgzp/dsh-llm-minimax
```

确认后在「已安装插件」里打开 **MiniMax 模型**。

**让 agent 装**：在开启了插件管理工具的会话里说

> 从 https://github.com/elfgzp/dsh-llm-minimax 安装这个插件并启用

**命令行**：

```sh
dsh plugin --profile <profile> add "github:elfgzp/dsh-llm-minimax#main"
```

## 用法

1. 打开 **设置 → MiniMax**。
2. 在「API Key」里粘贴 Key，点 **校验并保存**。区域默认自动识别（先试国内，再试国际）。
3. 回到对话，在输入框的模型选择器里选 **MiniMax 国内 → MiniMax-M3.1-Flash**（或 MiniMax-M3）。

不用改配置文件，也不用重启。

保存时插件依次做这些事，任一步失败就什么都不写：

- 用 `GET /v1/models` 校验 Key，确定它属于国内还是国际；
- 把 Key 存进本机凭据库 `$DSH_HOME/.credentials.yaml`，引用名是 `MINIMAX_CN_API_KEY` / `MINIMAX_API_KEY`（与「设置 → 模型」页用的是同一个）；
- 在 `llm-pi-ai` 里启用对应路由（`minimax-cn` / `minimax`），写入当前模型目录。

Key 只在宿主进程里流转，浏览器只拿回末 4 位。

## 输入框工具栏

选中官方 MiniMax 模型（`minimax-cn` / `minimax` 路由）时，模型选择器左边会出现两个控件：

| 控件 | 含义 |
|---|---|
| `▣ 1M` | 上下文预算。点开可选 200K / 512K / 1M。悬停看说明 |
| `● MiniMax 62%` | 套餐额度。悬停看 5 小时与每周窗口的剩余与重置时间 |

**只对官方 MiniMax 路由生效。** 换成别的模型（腾讯内网、DeepSeek、GLM…）这两个控件会完全消失，不影响任何其它模型 —— 因为上下文预算是「模型条目」的属性，而不是会话属性：DSH 的 `selectModel` 只接受 `{provider, model, reasoningEffort}`，没有按会话设置上下文这一说。

注意模型选择器里可能出现两个 MiniMax：一个带 `x0.08` 倍率（腾讯内网网关转发的），一个在 `minimax-cn` 分组下（官方 API）。**控件只在后者出现**，因为上下文预算改的是官方路由的模型目录。

## 为什么需要这个插件

DSH 自带的 `@deepseek-ai/dsh-llm-pi-ai` 已经有 `minimax-cn` 和 `minimax` 两条路由（Anthropic Messages 协议），所以本插件**不实现模型适配器**，只补它缺的部分：

| 问题 | DSH 自带 | 本插件 |
|---|---|---|
| 模型目录 | MiniMax-M3、M2.7、M2.7-highspeed | **MiniMax-M3.1-Flash**、MiniMax-M3；不写已退役的 M2.x |
| 思考档位 | 目录外模型走预算式思考，选择器档位不生效 | 打开 `forceAdaptiveThinking`，档位以 `output_config.effort` 发出 |
| M3.1-Flash 的「关闭思考」 | — | 不提供：该模型关闭思考会返回 400 |
| 填 Key | 要先在「设置 → 模型」添加提供商 | 设置页一个输入框，自动识别区域 |
| 额度 | 无 | M Plan / Token Plan 的 5 小时与每周窗口 |

你在「设置 → 模型」里给这条路由加的其它模型会保留；路由上的 `baseURL`、`retryPolicy`、`headers` 等字段插件不会改。之后该路由的配置每次变化，插件都会检查目录，有缺项就补回去。

## 额度

| Key 类型 | 显示内容 |
|---|---|
| M Plan / Token Plan 订阅 Key（`sk-cp-`，或有订阅的账号 Key） | 各用量桶的区间窗口（文本 5 小时、视频 24 小时，按接口返回的起止时间计算）和每周窗口：剩余百分比与重置倒计时 |
| 按量付费 Key（`sk-api-`） | 说明 MiniMax 不提供余额查询接口，附控制台链接；不显示任何数字 |

额度来自 `GET /v1/token_plan/remains`，每分钟刷新一次。这个接口出错时也返回 HTTP 200，插件按 `base_resp.status_code` 判断结果：`2062` 表示没有生效中的订阅，`1004` / `2049` 表示 Key 被拒或区域不对。

输入框工具栏的小标记只在有套餐窗口时出现，显示文本 5 小时窗口的剩余百分比；鼠标悬停显示所有窗口。

## 模型

| 模型 | 上下文 | 默认最大输出 | 思考 |
|---|---|---|---|
| MiniMax-M3.1-Flash | 1,000,000 | 131,072（上限 524,288） | 始终思考；深度可选 low … max |
| MiniMax-M3 | 1,000,000 | 131,072（上限 524,288） | 自适应；可选关闭或 low … max |

M2.5 / M2.7 系列于 2026-11-18 退役。M Plan 下旧名字会自动路由到 M3.1 Flash，按量付费请求退役后会失败。

## 测试

```sh
node --test test/                                          # 离线
MINIMAX_TEST_KEY="<你的 Key>" node --test test/            # 加上对真实 MiniMax 接口的端到端测试
```

## 已知限制

- 按量付费账户的余额和消费只能在 MiniMax 控制台查看，这是 MiniMax 的限制。
- 模型目录是插件内置的。MiniMax 发布新模型后，在「设置 → 模型 → MiniMax 国内 → 模型选项」里手动加一行即可，插件会保留它。
