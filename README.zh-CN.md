![Harness Level](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/huhenry/harness-engineering/main/harness-badge.json)

# harness-engineering

评估、脚手架化、并用证据核验 AI 编程 agent 的 harness——一个零依赖的 Node CLI，按六个子系统的评分
标准给仓库打分，把缺的东西补上，然后真的去**跑一遍**找到的验证命令，而不是相信它们存在就完事了。

[English](README.md)

## 为什么

这个项目的灵感上游是 [`harness-creator`](#致谢) 这一类工具：指向一个仓库，它会告诉你一个搭得好的
AI-agent harness 在这里应该长什么样——instructions、tools、environment、state、feedback、loop。
这很有价值，这个项目也沿用了同样的六子系统结构。但那一类工具只能**声明**一个仓库该有哪些验证命令，
没法告诉你这些命令到底能不能跑通。

这个项目唯一的硬差别：`verify --run` 会真的去执行仓库声明的命令（写在 `harness.config.json` 里，
或者从 `AGENTS.md`/`CLAUDE.md` 里解析出来的），把真实的退出码记进
`.harness/verify-report.json`。`assess` 再去读这份文件——关键就在这里——**光靠声明命令，Feedback
永远到不了 3 分，仓库也永远到不了 L4"有证据"这个等级。** 必须有东西真的跑过，退出码真的被捕获过，
而且是 24 小时以内的新鲜结果，不然报告会直接说清楚"没证据"，而不是悄悄把一句没人兑现过的承诺算成
加分项。

这就是整个论点，也是这份 README 对自己的要求：下面每一句描述工具行为的话，写之前都真的跑过一遍，
不是凭感觉觉得"应该是这样"。有意义的地方，直接把真实输出贴在下面。

## 安装

有两条安装路径，而且**它们不等价**——按你的需求选，别当成两个效果一样的选项。

**Claude Code 插件（推荐，装完即用，checkout 挪了位置也不受影响）。** 把这个仓库加成一个
marketplace 源，安装 `harness-engineering` 插件（见 `.claude-plugin/marketplace.json`）。Claude
Code 会把每个 skill 自己 markdown 里的 `${CLAUDE_PLUGIN_ROOT}` 替换成插件的真实安装路径，所以每
个 `harness-*` skill 文档里写的命令立刻就能解析——不需要额外配置。

**`install.sh`（只装 skill 文本，绑死在这一个 checkout 上）。** 在 checkout 里跑
`./install.sh`，会把 `skills/` 下的 skill markdown 复制进当前项目里找到的 agent 生态目录
（`.claude/skills`、`.cursor/skills`、`.codex/skills`、`.gemini/skills`、`.agent/skills`；一个都
不存在时默认用 `.claude/skills`），并且会把这个 checkout 自己的绝对路径替换进每一份装好的
`SKILL.md` 里的 `${CLAUDE_PLUGIN_ROOT}`，所以装好的命令也是立刻就能用的。它自己的输出把能做和不
能做的事说得很明白：

```
$ sh install.sh
-> .claude/skills
installed harness-engineering skills
Commands in the installed skills point at this checkout:
  <checkout>
Move or delete that directory and the installed skills stop working.
(scripts/ itself is never copied -- only skill text, with this
checkout's path substituted in.)
For a relocatable install, use the Claude Code plugin instead:
  https://github.com/huhenry/harness-engineering
```

这是拿一个限制换了另一个限制。装好的命令现在立刻能用，不用再反过来问你 checkout 在哪——但它们
绑死在**这一个具体 checkout 的位置**上：把这个目录挪走或者删掉，装好的 skill 里文档写的命令就全
部失效。它依然**不会把 `scripts/` 复制**到装好的 skill 文本旁边——只是把指向这个 checkout 自己那
份 `scripts/` 的绝对路径替换了进去，所以 `scripts/` 本身必须原地不动地继续存在。如果你以后打算挪
动、改名或者删掉这个 checkout，改用插件安装路径。如果你只是想直接试试这个 CLI，两条安装路径都
可以跳过，直接 clone 仓库——下面每条命令都是从 checkout 里用 `node scripts/<name>.mjs` 直接跑的。

## 快速开始

三条命令，跑在这个仓库自带的 fixtures 上，所以下面贴的都是真实输出：

```
$ node scripts/assess.mjs fixtures/bad-repo
# Harness Assessment Report

Score: 0 / 24

Level: L0 Ad-hoc

Evidence: No verify evidence found — run `verify --run` to generate `.harness/verify-report.json`.

## Subsystem Scores

| Subsystem | Score | Status |
| --- | --- | --- |
| Instructions | 0/4 |  |
| Tools | 0/4 |  |
...
### Feedback · No declared verification commands (ROI 10)

- Why: Without a declared, machine-readable command list, both the agent and any automated verifier have to guess which commands are the real checks.
- Fix: Add a harness.config.json declaring the canonical test, build and lint commands.
...
```

```
$ node scripts/scaffold.mjs <repo>
# Harness Scaffold

Mode: dry-run — nothing below was actually written. Re-run with --apply to write it.

## Planned files

| Action | Target | Gap |
| --- | --- | --- |
| create (no existing file) | `harness.config.json` | feedback.no-declared-commands |
| create (no existing file) | `AGENTS.md` | instructions.missing |
| create (no existing file) | `PROGRESS.md` | state.no-progress |
...
```

默认就是 dry-run——不加 `--apply` 什么都不会真的写。

```
$ node scripts/verify.mjs <repo> --run
# Verify Report

Mode: run — the commands below were actually executed.

Result: PASSED

## Commands

| Role | Command | Status |
| --- | --- | --- |
| test | `echo all good` | passed |

Evidence written to <repo>/.harness/verify-report.json
```

跑完 `verify --run` 之后再跑一遍 `assess`，看 Feedback（以及一旦声明了启动命令之后的
Environment）从"因缺证据被封顶——跑一遍 `verify --run` 拿证据"变成一个背后有真实退出码撑着的分数。

## 比较两次体检结果：`harness diff`

`assess --json` 的输出是一份稳定的、带版本号的文档（`schemaVersion`）。存两份——改动前一份、
改动后一份，或者两个分支各一份——`diff.mjs` 就能把两者的差异变成一个 CI 可以直接拿来做门禁的
通过/失败信号，不用再靠人肉对比两份 markdown 报告：

```
$ node scripts/assess.mjs fixtures/bad-repo  --json --out /tmp/h-before.json
$ node scripts/assess.mjs fixtures/good-repo --json --out /tmp/h-after.json
$ node scripts/diff.mjs /tmp/h-before.json /tmp/h-after.json
# Harness Diff Report

Score: 0 → 16 (+16)

Level: L0 → L3 (+3)

## Subsystem Scores

| Subsystem | Before → After | Delta |
| --- | --- | --- |
| Instructions | 0 → 4 | +4 |
| Tools | 0 → 3 | +3 |
| Environment | 0 → 3 | +3 |
| State | 0 → 4 | +4 |
| Feedback | 0 → 2 | +2 |
| Loop | 0 → 0 | 0 |

## Fixed

- No declared verification commands (high)
- No AGENTS.md or CLAUDE.md (high)
- No progress file (high)
...
```

（默认输出是英文，跟 `assess` 一样——加 `--lang zh` 会换成中文标题和栏位，gap 名字本身也会
换成中文。）

把这两份报告反过来比，就是一次真实的回归，退出码是 `1`：

```
$ node scripts/diff.mjs /tmp/h-after.json /tmp/h-before.json; echo "exit=$?"
...
exit=1
```

`--json` 输出同一份机器可读的 `DiffResult`：`schemaVersion`、总分和等级的
`before`/`after`/`delta`、`regression` 和 `regressionReasons`（取值是 `total`、`level`，或者
`subsystem:<id>`，刻意不看 gap **数量**——不然工具升级新增一个 gap id，看起来就会跟仓库真的
变差了一模一样）、按 rubric 固定顺序排列的各子系统 delta，以及按 id 列出的
`gaps.fixed`/`gaps.introduced`。`--out FILE` 会把报告写到文件里而不是标准输出，并且标准输出
一个字节都不会打印。两份输入文件的 `schemaVersion` 对不上时会直接拒绝比对，退出码 `2`——不同
schema 版本的报告，同一个字段可能代表完全不同的含义，本项目宁可拒绝，也不愿意给出一个看起来
合理、实际上没有意义的数字。

## 退出码

这是一份稳定的对外接口——本项目自己的 CI 就是靠它做门禁的。上面第一条命令**故意**返回 `1`，
因为 `fixtures/bad-repo` 本来就是一个存在高危缺口的仓库。这里的非零退出码意思是
"这个仓库有问题"，不是"工具坏了"。

| 退出码 | `assess` | `verify` | `scaffold` | `diff` |
| --- | --- | --- | --- | --- |
| `0` | 达到 `--min-level`；没指定等级时表示没有高危缺口 | 所有命令都通过（dry-run 下：所有命令都已列入计划） | dry-run，或者 `--apply` 把计划的文件都写成功了 | 比对成功，没有回归 |
| `1` | 没达到 `--min-level`，或存在高危缺口 | 有命令失败、超时，或被安全清单拦下 | 有文件没写成功，或模板缺失 | 比对成功，但发现了回归（分数、等级，或某个子系统退步了） |
| `2` | 用法错误（参数或取值写错了） | 用法错误 | 用法错误 | 用法错误（参数写错、文件读不到、JSON 解析失败、位置参数数量不对，或 `schemaVersion` 不一致） |
| `3` | 未预期的内部错误 | 未预期的内部错误 | 未预期的内部错误 | 未预期的内部错误 |

`2` 和 `3` 是刻意分开的：参数敲错和工具自己崩了，对调用方脚本来说不能长得一模一样；
这两者也都不该和 `1` 混淆——`1` 表示这次运行是成功的，只是它如实报告了你的仓库的真实状况。

## 六个子系统

| 子系统 | 检查什么 |
| --- | --- |
| `instructions` | 冷启动的 agent 能不能学到技术栈、安装步骤、约束条件，以及怎么验证自己的工作？ |
| `tools` | 有没有统一的构建/测试/运行入口，带一条写清楚的允许/禁止界线？ |
| `environment` | 环境能不能确定性地复现——锁定的依赖、锁定的运行时、一个真的能跑通的启动脚本？ |
| `state` | 一个新开或续接的会话，能不能不用重新推导就知道已经做到哪一步？ |
| `feedback` | 有人说某样东西能跑的时候，背后有没有一个真实的、机器可核验、**真的跑过**的信号？ |
| `loop` | 如果这个仓库要无人值守地跑，循环有没有停止条件、预算上限，和一个检查者？ |

每项 `0`–`4` 分（总分 `24`）。完整的逐档判据和全部 39 个 gap id 见
[`references/rubric.zh-CN.md`](references/rubric.zh-CN.md)。

## 等级

等级是**门禁式**的，不是从总分推出来的——总分再高，只要有一个子系统偏弱，等级也上不去。

| 等级 | 名称 | 门禁 |
| --- | --- | --- |
| L0 | 无序 | （默认） |
| L1 | 有指令 | `instructions >= 2` |
| L2 | 可复现 | + `environment >= 2` 且 `tools >= 2` |
| L3 | 可续跑 | + `state >= 3` |
| L4 | 有证据 | + `feedback >= 3` **且**存在一份新鲜、有效的 `verify --run` 证据文件 |
| L5 | 可自主循环 | + `loop >= 3` 且每个子系统都 `>= 3` |

## 安全

`verify --run` **会执行**你仓库里声明的命令——来自 `harness.config.json`，或者从
`AGENTS.md`/`CLAUDE.md` 里解析出来的。只在你信任的仓库上跑它——这是一张防意外的安全网，不是能挡住
蓄意攻击者的沙箱（完整表述见[Limitations 一节](skills/harness-verify/SKILL.md#limitations)）。

在真正执行任何命令之前，每条命令都会先过一遍 `scripts/lib/safety.mjs` 里的阻断清单。最容易被读者
理解错的一条是 `deploy-words`：它是**按词边界**匹配，不是子串匹配，匹配的词是 `deploy`、`prod`、
`production`、`release`（不区分大小写）。`prod-check` 会被拦（词边界成立）；`releases/list` 和
`deployment.yaml` **不会**被拦（`releases` 不是单词 `release`，`deployment` 也不是单词
`deploy`）。

`--allow '<regex>'` 可以有意放行一条被*软规则*拦下的命令。它**永远没法覆盖四条硬规则**——`sudo`、
`destructive-rm`、`find-delete`、`disk-write`——不管传的正则是什么，因为这四条一旦触发就没有挽回
余地（提权到 root、删除后无法撤销、磁盘被写坏），不该让任何预先写好的一个 flag 就无人盯防地放行：

```
$ node scripts/verify.mjs <repo> --run --allow '.*'
...
| bootstrap | `rm -rf /` | blocked (refused before execution) |
...
- `bootstrap` (`rm -rf /`): ... This is a hard rule: `--allow` cannot override it.
```

把这个模块给出的"没拦"结果理解成"没找到已知的、意外或不那么高明的攻击性写法"——而不是"这条命令
可以放心无人值守地跑"。完整的、经过对抗式评审的 Limitations 表述，包括刻意留下的两个口子，见
[`skills/harness-verify/SKILL.md`](skills/harness-verify/SKILL.md#limitations)。

## 致谢

这个项目的六子系统结构和等级阶梯，是对
[《Learn Harness Engineering》](https://walkinglabs.github.io/learn-harness-engineering/en/)
课程里教的内容的一次落地实现——完整的论述去那里看。
[`references/failure-modes.zh-CN.md`](references/failure-modes.zh-CN.md) 把课程自己讲的失败模式，
逐讲对应到这个工具里具体检查它的那个 gap id。

## 许可

MIT——见 [`LICENSE`](LICENSE)。
