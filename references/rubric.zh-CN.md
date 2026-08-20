# 评分标准参考

这份文档是 `scripts/lib/rubric.mjs`（gap 定义）和 `scripts/lib/scorers/*.mjs`（真正的打分逻辑）
的人类可读镜像。`tests/docs.test.mjs` 会拿它跟代码交叉校验：下面列出的每一个 gap id 都必须存在于
`GAPS` 里，每一个子系统名字都必须在 `SUBSYSTEMS` 里，每一个等级都必须在 `LEVELS` 里。这份文档一旦
和代码对不上，测试就会变红——它没法像手写文档那样悄悄过期。

`node scripts/assess.mjs <repo>` 会拿这套标准去评一个真实仓库，按 ROI 顺序打印出实测的 gap。完整
的实测示例见根目录 [README.zh-CN.md](../README.zh-CN.md)。

## 六个子系统

每个仓库在六个互相独立的子系统上打分，每项 `0`–`4`，总分 `24`：

| 子系统 | 在问什么 |
| --- | --- |
| `instructions` | 一个冷启动的 agent 能不能直接学到技术栈、安装步骤、约束条件，以及怎么验证自己的工作——而不用重新猜一遍？ |
| `tools` | 有没有一个统一的构建/测试/运行入口，以及一条写清楚的"自动放行"和"禁止执行"的界线？ |
| `environment` | 环境能不能确定性地复现——锁定的依赖、锁定的运行时版本、一个真的能跑通的启动脚本？ |
| `state` | 一个新开或续接的会话，能不能不靠重新读一遍 diff 就知道已经做到哪一步？ |
| `feedback` | agent 说"这个能跑"的时候，背后有没有一个真实的、机器可核验的信号——而且这个信号是真的跑出来的，不是声明出来的？ |
| `loop` | 如果这个仓库要无人值守地跑，循环有没有停止条件、预算上限，以及检查自己产出的办法？ |

分数是**门禁式**的，不是简单相加——见下面的[等级](#等级)一节。一个仓库总分能到 20/24，但只要
`instructions` 是 0，等级照样卡在 L0，因为 L1 具体要求 `instructions >= 2`，不是看总分高不高。

## Instructions（`instructions.*`）

从 `AGENTS.md` 或 `CLAUDE.md` 里评分（按这个顺序找，谁先存在就用谁）。

| 分数 | 判据 |
| --- | --- |
| 0 | `AGENTS.md` 和 `CLAUDE.md` 都不存在。 |
| 1 | 文件存在。 |
| 2 | 有一行同时点名了检测到的技术栈（比如 `go`、`node`）和版本号，**并且**有一个标题匹配安装/快速开始类内容。 |
| 3 | 有标题匹配约束条件（"绝不""禁止"等），**并且**有标题匹配验证/测试，**并且**全文不超过 150 行。 |
| 4 | 至少有一条本地链接指向子目录下的 `.md` 文件（分层文档），**并且**每一条本地链接的目标都能在磁盘上真的找到。 |

Gap id：`instructions.missing`、`instructions.no-stack-versions`、`instructions.no-setup-commands`、
`instructions.no-constraints`、`instructions.no-verification`、`instructions.too-long`、
`instructions.no-layering`、`instructions.stale-links`。

## Tools（`tools.*`）

| 分数 | 判据 |
| --- | --- |
| 0 | 没有 `Makefile`、`justfile`、`Taskfile.yml`，`package.json` 里也没有非空的 `scripts`。 |
| 1 | 上面任意一种入口存在。 |
| 2 | 说明文件里真的提到了怎么调用它（`make <target>`、`npm run`、`just ...`、`task ...`）。 |
| 3 | 说明文件代码片段里出现的每一条 `make`/`just`/`task`/`npm run` 引用都能对上真实存在的目标，**并且**存在权限配置文件（`.claude/settings.json` 或 `.cursor/rules`）。 |
| 4 | 权限文件（或说明文件）同时写明了允许清单和禁止清单——要有真正的最小权限说明文字，光有权限文件本身不算数。 |

Gap id：`tools.no-entrypoint`、`tools.broken-entrypoint`、`tools.no-permissions`、
`tools.no-least-privilege-doc`。

## Environment（`environment.*`）

| 分数 | 判据 |
| --- | --- |
| 0 | 检测到的技术栈里，一个锁文件或运行时版本锁定文件都没有。 |
| 1 | 至少存在一个锁文件或运行时版本锁定文件。 |
| 2 | 每一个"有锁文件概念"的检测到的技术栈都存在对应锁文件，**并且**至少一个检测到的技术栈存在运行时版本锁定文件。 |
| 3 | 声明了启动命令（`harness.config.json` 的 `verify.bootstrap` 字段，或者存在 `init.sh`/`bootstrap.sh`/`scripts/setup.sh`）。 |
| 4 | 存在容器化文件（Dockerfile/Compose 清单，或 `.devcontainer/devcontainer.json`），**并且**`verify --run` 的证据显示启动命令真的被执行过而且成功了。第 4 档的启动命令这一条是证据门禁的：没有一份新鲜的 `.harness/verify-report.json`，这一档会显示"因缺证据被封顶——跑一遍 `verify --run` 拿证据"，而不是直接判定失败。 |

Gap id：`environment.no-lockfile`、`environment.no-runtime-pin`、`environment.no-bootstrap`、
`environment.bootstrap-fails`、`environment.no-container`。

## State（`state.*`）

进度文件候选路径：`PROGRESS.md`、`claude-progress.md`、`docs/PROGRESS.md`。

| 分数 | 判据 |
| --- | --- |
| 0 | 进度文件不存在。 |
| 1 | 进度文件存在。 |
| 2 | 它在最近 30 天内被改动过（优先看 git 历史，没有 git 历史再退回文件的修改时间），**并且**同时有"已完成""进行中""阻塞中"三类标题。 |
| 3 | `feature_list.json` 存在**并且**通过校验（每个 feature 的 `id` 非空且唯一，`title` 非空，`status` 属于 `todo`/`in-progress`/`done`/`blocked` 之一）。 |
| 4 | `session-handoff.md` 和 `clean-state-checklist.md`（不限层级）都以**已填写**的文件形式存在，**并且**`AGENTS.md` 写明了会话开始/结束的生命周期。产物缺失报 `state.no-handoff`；文件存在、但这个工具无法把它读成"已填写"的，改报 `state.handoff-unfilled`——把模板 vendor 或 scaffold 进来不等于写了这份文档。"没填写"涵盖三种状态：还带着未替换的 `FILL:` 标记；剥掉开头那行 `scaffold` 溯源注释之后与本项目出厂模板逐字节相同（所以刚 scaffold 出来的文件也算，尽管它从来不是字面意义上的逐字节相同）；以及文件根本读不出来。这两个 gap id 各自独立判断："文件不存在"和"文件在但没写"是两件不同的事，一个仓库可能两个产物各踩中一条、同时触发——每条 gap 的文案只会点名真正触发它的那个产物。 |

Gap id：`state.no-progress`、`state.progress-stale`、`state.progress-incomplete`、
`state.no-feature-list`、`state.feature-list-invalid`、`state.no-handoff`、
`state.handoff-unfilled`、`state.lifecycle-undocumented`。

## Feedback（`feedback.*`）

这是 ROI 权重最高的子系统，也是这个项目存在的理由本身——见根目录 README 的
[Why](../README.zh-CN.md#为什么) 一节。

| 分数 | 判据 |
| --- | --- |
| 0 | 全仓库找不到任何测试文件。 |
| 1 | 测试文件存在。 |
| 2 | `harness.config.json` 或从 `AGENTS.md`/`CLAUDE.md` 解析出的验证角色（`bootstrap`/`test`/`lint`/`typecheck`/`e2e`/`smoke`）里，至少声明了一个。 |
| 3 | `verify --run` 的证据显示 `test` 角色真的被执行过（不只是声明，也不是 `blocked`/`planned`），而且没有失败，**并且**声明了第二种检查类型（lint 或 typecheck）——如果有证据，则要求它真的跑过并通过。 |
| 4 | e2e 或 smoke 已声明/已通过，**并且**存在 CI 工作流文件，**并且**文档写明了可观测性入口（声明了 `smoke` 命令，或 `AGENTS.md` 里提到 `healthz`/日志位置）。 |

第 3 档跟 Environment 第 4 档一样是证据门禁的：没有新鲜的 `.harness/verify-report.json`，会显示
"因缺证据被封顶——跑一遍 `verify --run` 拿证据"，而不是直接判定失败。**这正是这个项目整个论点的
落脚点**：光靠声明命令，Feedback 永远到不了 3，仓库也永远到不了 L4——必须有真的跑过、退出码被
记录下来的证据。

Gap id：`feedback.no-tests`、`feedback.no-declared-commands`、`feedback.commands-unverified`、
`feedback.commands-failing`、`feedback.single-check-kind`、`feedback.no-ci`、`feedback.no-e2e`、
`feedback.no-observability`。

## Loop（`loop.*`）

评分来源：`AGENTS.md`、`CLAUDE.md`、`README.md`，以及任何 `loop/*.md` 文件，拼在一起看。

| 分数 | 判据 |
| --- | --- |
| 0 | 这些文档里完全没提到自主/定时循环。 |
| 1 | 文档提到了循环模式（`autonomous`、`loop`、`cron`、`scheduled`，或对应的中文说法"自主""循环"）。 |
| 2 | 存在一个具体的入口：一个定时触发的 CI 工作流、一个 `loop/*.md` 文件，或者 `harness.config.json` 声明了 `loop` 字段。 |
| 3 | 文档同时描述了停止条件和预算上限（迭代次数/时间/花费的上限）。 |
| 4 | 文档描述了 maker-checker 角色分离（或存在 `evaluator-rubric.md`），**并且**描述了回滚机制。 |

Gap id：`loop.none`、`loop.no-stop-condition`、`loop.no-budget-cap`、`loop.no-maker-checker`、
`loop.no-rollback`。

## 等级

等级是**门禁式**的，不是从总分推出来的：`computeLevel()` 从下往上走，遇到第一个不满足的条件就
停下。每一级都要求它下面那一级的所有条件全部满足，再加上这里列出的新增条件。

| 等级 | 名称 | 门禁（在下一级全部条件之上新增） |
| --- | --- | --- |
| L0 | 无序 | （无——默认等级） |
| L1 | 有指令 | `instructions >= 2` |
| L2 | 可复现 | `environment >= 2` 且 `tools >= 2` |
| L3 | 可续跑 | `state >= 3` |
| L4 | 有证据 | `feedback >= 3` **且**存在一份新鲜、有效的 `verify --run` 证据文件 |
| L5 | 可自主循环 | `loop >= 3` **且**六个子系统全部 `>= 3` |

L4 正是这个项目区别于上游的立身之处：要到 L4，必须真的有一份 `verify --run` 写出来的
`.harness/verify-report.json`，光靠声明命令堆出一个高 Feedback 分数是不够的。完整论点见根目录
README 的 [Why](../README.zh-CN.md#为什么) 一节。
