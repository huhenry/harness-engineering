# 失败模式对照：课程 → gap id

[《Learn Harness Engineering》](https://walkinglabs.github.io/learn-harness-engineering/en/) 是这个
工具落地的上游课程（见根目录 [README](../README.zh-CN.md#致谢)）。课程用叙述的方式讲清楚了 harness
要防住的是哪些失败模式。这份文档是两者之间的桥：每一讲对应的具体失败模式，映射到这个工具 38 个
gap id（`scripts/lib/rubric.mjs`）里检查它的那一个或几个。

这里覆盖了课程 14 讲里的 13 讲。第 14 讲《From Single Loops to Graph Engineering》没有纳入这份文档
——它讲的是多 agent 编排图，这个层次超出了单个仓库静态评分能检查的范围，下面也没有假装能覆盖它。
其余内容都是 2026-08-17 从课程官网实测读取的，不是凭记忆编的——引用全部逐字保留原文（英文）。

## 第 1 讲——Why Capable Agents Still Fail

五个结构性失败模式，课程把锅全甩给 harness，不甩给模型（口号是"先查 harness，别急着换模型"）：

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 需求写得太模糊——"加个搜索功能"没说清楚分页、查询方式、高亮怎么做 | `state.no-feature-list`、`state.feature-list-invalid` |
| 隐性约定从没写下来（"agent 根本没法遵守"） | `instructions.missing`、`instructions.no-constraints` |
| 环境搭建不完整——context 耗在"pip install 报错和 Node 版本冲突"上 | `environment.no-lockfile`、`environment.no-runtime-pin`、`environment.no-bootstrap` |
| 没有验证手段——"agent 自己觉得做完了就算做完了" | `feedback.no-tests`、`feedback.no-declared-commands` |
| 跨会话状态丢失——"超过 30 分钟的任务失败率明显飙升" | `state.no-progress`、`state.progress-stale` |

## 第 2 讲——What a Harness Actually Is

直接给每个子系统各点了一个失败模式：

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| Tools：出于"安全考虑"把 shell 权限关掉——"agent 连 `pip install` 都跑不了，还怎么干活" | `tools.no-entrypoint`、`tools.no-permissions` |
| Feedback：没有声明验证命令，结果就是"跑不了测试"，课程称其为"ROI 最高的子系统" | `feedback.no-declared-commands`、`feedback.no-tests` |
| Instructions：只有一份简陋 README，agent 选错了包管理器（npm 还是 yarn），也没按命名规范来 | `instructions.missing`、`instructions.no-constraints` |
| State：没有结构化的进度记录，"context 无限堆积"，agent 原地打转而不是往前推进 | `state.no-progress`、`state.progress-incomplete` |
| Environment：依赖没锁、运行时版本没锁，agent "没法复现基线环境" | `environment.no-lockfile`、`environment.no-runtime-pin` |

## 第 3 讲——Why the Repository Must Become the System of Record

核心论断："仓库里没有的信息，对 agent 来说就是不存在的信息。"

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 隐性约束——某团队"70% 的任务需要人工介入"，就是因为架构上的约定没写下来 | `instructions.no-constraints`、`instructions.missing` |
| "发现成本"——context 耗在到处找信息，而不是解决问题本身 | `instructions.no-layering`（分层文档要能按需取用，不能全埋在一个文件里） |
| 没有持久化的地图，每次都要重新猜一遍 | `state.no-progress`、`state.no-handoff` |
| 过期文档"会理直气壮地把 agent 带偏"——课程称之为"头号敌人" | `instructions.stale-links` |

## 第 4 讲——Why One Giant Instruction File Fails

四个失败模式，跟 `instructions.*` 的评分标准几乎一一对应：

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| context 预算被吃光——臃肿的说明文件占掉 10-20K token | `instructions.too-long` |
| "中间遗忘效应"——埋在 600 行文件第 300 行的约束会被无视 | `instructions.too-long`、`instructions.no-layering` |
| 优先级混乱——agent "分不清哪些是不可谈判的硬约束，哪些只是建议性的软指引" | `instructions.no-constraints` |
| 维护性衰退——文件只增不减，信噪比一路走低 | `instructions.stale-links`、`instructions.too-long` |

课程给出的修法（入口文件不超过 200 行、主题文档放进 `docs/`、把说明直接嵌进代码注释）跟
`instructions.no-layering`、`instructions.too-long` 这两个 gap 要检查的东西完全对得上。

## 第 5 讲——Why Long-Running Tasks Lose Continuity

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 决策上下文丢失——新会话只看得到"做了什么"（代码），看不到"为什么这么做" | `state.no-handoff` |
| 没有进度记录，导致工作重复或相互冲突 | `state.no-progress`、`state.progress-incomplete` |
| 实现逐渐跑偏——"每个新会话对项目目标的理解都会有细微偏差，一次次偏差会累加" | `state.no-feature-list`、`state.feature-list-invalid` |
| 验证结果没有留痕，每个会话都要从头再诊断一遍 | `feedback.commands-unverified` |
| 接近 context 上限时的"焦虑感"会导致仓促收尾、跳过验证 | `state.progress-incomplete`、`feedback.no-declared-commands` |

课程推荐的机制（PROGRESS.md、决策日志、把 git commit 当检查点、上下班式的会话协议）直接对应
`state.no-progress`、`state.progress-stale`、`state.lifecycle-undocumented`。

## 第 6 讲——Why Initialization Needs Its Own Phase

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 基础设施搭得潦草——"测试框架配好了但没验证过，lint 规则定了但太松，没建进度文件" | `environment.no-bootstrap`、`feedback.commands-unverified`、`state.no-progress` |
| 没验证过就往上堆功能代码，地基本身就有问题 | `environment.bootstrap-fails` |
| context 耗在初始化上，初始化本身却还是没搭好——"两头都没落着好" | `environment.no-bootstrap` |
| 隐性假设埋雷——"第一个会话选了 Vitest，第二个会话的 agent 不知道，又引入了 Jest" | `instructions.no-stack-versions`、`environment.no-lockfile` |

## 第 7 讲——Why Agents Overreach and Under-Finish

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 战线拉得太大——一个任务最后变成"改了 12 个文件、新增 800 行代码，没有一个功能能端到端跑通" | `state.no-feature-list`（缺一个外部化的、WIP=1 的范围管理面） |
| 半途而废——"战线拉大和半途而废互相放大" | `feedback.no-e2e` |
| 建议：要有明确的完成证据，不能只是"代码写完了" | `feedback.commands-unverified`、`feedback.no-declared-commands` |
| 建议：范围要外部化成机器可读的文件 | `state.no-feature-list`、`state.feature-list-invalid` |

## 第 8 讲——Why Feature Lists Are Harness Primitives

课程里跟 `state.no-feature-list` / `state.feature-list-invalid` 对得最严丝合缝的一讲：

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 完成标准没定义——"你从没告诉过它'完成'是什么意思，它只能自己定标准：'我写了不少代码，看着挺完整的'" | `state.no-feature-list` |
| 状态靠猜——"大部分做完了，还差支付那块"这种进度记录，每个会话要多花约 20 分钟去诊断 | `state.no-feature-list` |
| 非结构化记录导致重复实现 | `state.feature-list-invalid` |
| 没有机器可读的产物，范围就会跑偏 | `state.no-feature-list` |

## 第 9 讲——Why Agents Declare Victory Too Early

直接点出了 `feedback.commands-unverified` / `feedback.commands-failing` 这两个 gap 存在的理由：

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 单元测试带来的假信心——mock 跑通了，但真实的跨系统问题被盖住了 | `feedback.single-check-kind`、`feedback.no-e2e` |
| 系统性的自我评估偏差——agent"系统性地给自己打出偏高的分数" | `loop.no-maker-checker` |
| 功能实现不完整——单元测试过了，但迁移脚本、端到端流程从没查过 | `feedback.no-e2e` |
| 验证过程中顺手重构，"把'已验证'和'未验证'的边界搞模糊了" | `feedback.commands-unverified` |
| 建议："完成与否的判断不该由 agent 自己来做" | `loop.no-maker-checker` |

## 第 10 讲——Why End-to-End Testing Changes Results

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 接口不匹配，单元测试看不出来（相对路径 vs 绝对路径的例子） | `feedback.no-e2e` |
| 状态传播出错——schema 迁移之后 ORM 缓存还是旧结构 | `feedback.no-e2e` |
| 资源生命周期问题"只在真实负载下才会暴露" | `feedback.no-e2e` |
| 环境依赖——mock 环境下能过，生产环境就挂 | `feedback.no-e2e`、`feedback.no-observability` |
| "只有端到端测试才能证明系统级缺陷不存在" | `feedback.no-e2e` |

## 第 11 讲——Why Observability Belongs Inside the Harness

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 没有运行时轨迹，就分不清"看着对"和"真的能跑" | `feedback.no-observability` |
| 没有评分标准和验收条件，"评估就变成了玄学" | `loop.no-maker-checker` |
| 盲目重试——agent"可能会朝着错误的方向使劲改，改的是不相关的代码路径" | `feedback.no-observability` |
| 交接效率低下——重复诊断能吃掉"总会话时间的 30%-50%" | `state.no-handoff`、`feedback.no-observability` |

## 第 12 讲——Why Every Session Must Leave a Clean State

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| "构建是坏的，测试是红的，调试用的临时文件到处都是，feature list 没更新，进度完全说不清楚" | `state.no-handoff`、`state.lifecycle-undocumented` |
| 熵不断累积——不一致的写法互相叠加，"一周之后桌子就被堆满的杯子埋了" | `state.lifecycle-undocumented` |
| 实测的 12 周对照：没有清理纪律的情况下，构建通过率 100%→68%，测试通过率 100%→61%，启动耗时 5 分钟→60+ 分钟 | `state.no-handoff`、`loop.no-rollback` |
| 接手的会话要花时间"猜哪些是故意这么写的，哪些是临时凑的" | `state.no-handoff` |

## 第 13 讲——From Manual Prompting to Autonomous Loops

对应的正是整个 `loop.*` 子系统：

| 失败模式（原文引用） | 对应 gap id |
| --- | --- |
| 没有循环结构，执行到一半就跑偏，没法自我纠正 | `loop.none` |
| 没有独立验证，过早宣布"完成" | `loop.no-maker-checker` |
| "模型每次运行之间什么都不记得；记忆必须落在磁盘上，不能靠 context 窗口" | `state.no-progress` |
| 没有可验证的停止条件 | `loop.no-stop-condition` |
| 自我打分——"一个模型是自己产出的最佳辩护律师" | `loop.no-maker-checker` |
| Token 爆炸——"prompt 大小基本上随对话轮数呈平方级增长" | `loop.no-budget-cap` |
| "跑得快的循环会诱使你跳过验证"，代价"越攒越多" | `loop.no-rollback` |

## 覆盖范围说明

这份映射刻意做成多对多、有些地方是近似对应：课程用叙事性的案例研究讲失败模式，这个工具的 gap id
则是离散的、可静态检查的条件。某一讲的失败模式映射到某个 gap id，前提是这个 gap 的检查逻辑确实是
那个失败模式的一个合理静态代理——不是说把这里列出的 gap 全部修完，就等于完整实现了那一讲的论点。
每个 gap 具体检查什么，见 [rubric.zh-CN.md](rubric.zh-CN.md)。
