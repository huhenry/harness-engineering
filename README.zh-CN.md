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

## 评估一套 harness 分发包

默认的 `repository` profile 问的是：目标仓库有没有为自己的六子系统 harness 提供证据。如果一个
仓库的产品本身是一组可复用的 harness 组件，可以显式切换到第二个诊断视角：

```
$ node scripts/assess.mjs fixtures/albert-shaped --profile harness-distribution
```

`harness-distribution` 还会读取根目录或嵌套目录里的 `**/skills/**/SKILL.md`、
`**/agents/*.md` 和 `**/workflows/*`；`.github/workflows` 仍然是 Feedback 管辖的 CI 证据，不是
可复用 harness 的工作流。只要这些文件确实写明了循环、可读取的工作流入口、停止和预算条件、彼此
分离的 maker/checker 角色，以及回滚机制，相应的 Loop 诊断就可以被消除。

这个 profile 刻意保持为**只改诊断**：它不能改变任何子系统分数、证据封顶、总分或等级。嵌套 skill
不能证明外层仓库拥有根级 instructions、产品入口、测试、已声明检查或 CI。读不出来的文件不产生事实，
也不产生证据。因此 clean-room 的 `albert-shaped` fixture 在两个 profile 下都是 0/24、L0：分发视角
会消除六条 Loop finding，但根级 finding 原样保留。

每份 JSON 评估报告都会记录 `profile`。GitHub Action 在 v1.3 里继续使用默认的 `repository`，不新增
profile input。

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
合理、实际上没有意义的数字。profile 不一致时也同样拒绝：旧报告如果缺少 `profile`，按
`repository` 解释；但 `repository` 和 `harness-distribution` 报告不能互相 diff。

## 让它在每个 PR 上自动跑：GitHub Action

仓库根目录的 `action.yml` 就是一个 GitHub Action。它会体检 PR 的 head，再体检它的 base commit，
然后把两者的差异发成一条评论——内容就是上面 `diff.mjs` 打印的那份 markdown，所以评审者在 PR 上
读到的，和你在本地跑出来的一模一样。

```yaml
name: harness-diff
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0            # 必须——原因见下
      - uses: huhenry/harness-engineering@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

这里写 `@main`，是因为本仓库还没有发布任何 tag。把第三方 Action 钉在一个会移动的分支上是一种
供应链风险，不该养成习惯——一旦有了 tag 或 commit sha，就钉到那上面去。

零依赖同样贯彻到 Action 里：不引 `@actions/core`、不引 `@actions/github`、不打包、没有构建步骤，
也不需要 `setup-node`。`action.yml` 选择 GitHub 的 `node24` JavaScript Action runtime，runner 直接
执行仓库里那份 `scripts/action.mjs`，所以你在这个仓库里能读到的代码，就是在你的 PR 上真正跑的
代码。自托管 runner 必须足够新，能够支持 Node 24 Action。

| Input | 默认值 | 作用 |
| --- | --- | --- |
| `repo-path` | `.` | 要体检的目录。base 侧导出的是同一个子目录，所以两边描述的始终是同一个东西。 |
| `base-ref` | `${{ github.event.pull_request.base.sha }}` | 作为比较基准的 commit。 |
| `fail-on-regression` | `false` | 出现回归时是否让这一步失败。理由见下。 |
| `comment` | `true` | 是否发（或更新）PR 评论。 |
| `lang` | `en` | 评论语言：`en` 或 `zh`。 |

Outputs：`score-before`、`score-after`、`score-delta`、`level-before`、`level-after`、
`regression`。退出码沿用上面几个 CLI 的约定——`1` 永远只表示"你主动开了门禁，而且真的发生了
回归"，绝不会因为评论没发出去而返回。

### `fetch-depth: 0` 是硬性要求

base 侧的数据来自 `git archive <base-sha>`，解压到仓库之外的一个临时目录里。这是一次纯读操作：
和再跑一次 `actions/checkout` 或者 `git worktree add` 不同，它不往你的工作区写任何东西，也不往
`.git/` 里写任何东西——这正是本项目能够持续承诺"`assess` 只读、Action 不写目标仓库"的原因。

代价是 base commit 必须真的存在于 `.git` 里，而 `actions/checkout` 默认 `fetch-depth: 1`，
根本不会把它拉下来。真遇到这种情况时，Action 会停下来并在错误信息里**明确写出 `fetch-depth: 0`**，
而不是原样丢给你一句 `fatal: not a valid object name` 让你自己猜。

### 来自 fork 的 PR 拿不到评论

对于 fork 发起的 PR，GitHub 给这次 workflow 的 `GITHUB_TOKEN` 是只读的，无论 `permissions:`
里怎么写都一样。发评论会返回 403，Action 只打一条 warning，这一步仍然算成功。diff 会写进 job
summary 和 job 日志，所以结果照样看得到，只是不以评论的形式出现。

常见的绕过办法是 `pull_request_target`——它用一个可写的 token、在 base 仓库的上下文里运行，同时
checkout 的却是 fork 的代码。**不要这么做。** 那是把仓库写权限交到任何一个能提 PR 的人手里的
经典路径，一条评论不值这个代价。本项目宁可如实说明这个限制，也不去粉饰它。

### `fail-on-regression` 默认 `false`

这是刻意的。任何人拿到一个新检查项，第一件事都是先看看它对自己的仓库说了什么——而如果它正卡着
合并队列，人根本没法安心去看。装上当天就变红的检查，结局是被卸掉，而不是被排查。等你看清楚分数
在自己的历史上是怎么波动的，再主动打开它；或者干脆不开，自己拿 `regression` 这个 output 去做
门禁。本仓库对自己的 PR 把它设成了 `true`（见 `.github/workflows/harness-diff.yml`）——这是它
有资格对自己做的决定，不是替你做的决定。

### 只有一条评论，就地更新

每条评论的第一行都是一个隐藏 marker `<!-- harness-engineering-diff -->`。发评论前，Action 会去
找**第一行**正好是这个 marker 的评论，找到就 `PATCH` 更新它，而不是再发一条。只认第一行，所以
别人引用你这条评论回复时，不会让下一次运行跑去改他的留言。每次 push 都新发一条，是一个有用的
机器人变成一个被静音的机器人的标准路径。

### 有一件事这个比对是看不见的

`git archive` 只导出被 git 跟踪的文件，所以 base 侧永远不可能包含
`.harness/verify-report.json`——本工具自己的验证证据是刻意不提交进 git 的。如果同一个 job 里更
早的某一步跑过 `verify --run`，那么 head 侧有证据、base 侧结构上不可能有，Feedback 和
Environment 就会显示出一个根本没人做过的"提升"。Action 会检测出这种不对称并发出 warning。把它
放在任何 `verify --run` 步骤**之前**跑，两边就都没有证据，这才是一次公平的比较。

## 退出码

这是一份稳定的对外接口——本项目自己的 CI 就是靠它做门禁的。上面第一条命令**故意**返回 `1`，
因为 `fixtures/bad-repo` 本来就是一个存在高危缺口的仓库。这里的非零退出码意思是
"这个仓库有问题"，不是"工具坏了"。

| 退出码 | `assess` | `verify` | `scaffold` | `diff` | Action |
| --- | --- | --- | --- | --- | --- |
| `0` | 达到 `--min-level`；没指定等级时表示没有高危缺口 | 所有命令都通过（dry-run 下：所有命令都已列入计划） | dry-run，或者 `--apply` 把计划的文件都写成功了 | 比对成功，没有回归 | 跑完了；评论没发出去只是 warning，不算失败 |
| `1` | 没达到 `--min-level`，或存在高危缺口 | 有命令失败、超时，或被安全清单拦下 | 有文件没写成功，或模板缺失 | 比对成功，但发现了回归（分数、等级，或某个子系统退步了） | 开了 `fail-on-regression`，并且确实发生了回归 |
| `2` | 用法错误（参数或取值写错了） | 用法错误 | 用法错误 | 用法错误（参数写错、文件读不到、JSON 解析失败、位置参数数量不对，或 `schemaVersion` 不一致） | 用法错误（input 取值不是 YAML 布尔量、`lang` 不支持、`base-ref` 为空，或 `base-ref` 不在 `.git` 里） |
| `3` | 未预期的内部错误 | 未预期的内部错误 | 未预期的内部错误 | 未预期的内部错误 | 未预期的内部错误 |

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
