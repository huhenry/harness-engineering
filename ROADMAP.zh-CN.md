# 路线图

这不是一份愿望清单。下面每一条都是这个项目开发过程中真实发现、又刻意推迟处理的条目
（`.superpowers/sdd/**` 里的规划记录在发现的那一刻就写下来了）——不是事后为了凑数编出来的。
每一条都会说清楚：发现了什么、怎么核实的、为什么 v1 没修。

先说一句关于来源的话：这个任务的实施计划原文说，这份路线图的内容应该来自项目"spec"文档第 15 节。
但那份 spec 不在这次检出的仓库里（这个仓库的规划目录 `.superpowers/sdd/` 整体被 `.gitignore`
排除——这是刻意的决定，因为里面装的是内部任务简报和评审 diff，本来就不打算随仓库发布）。这份
文档改为从那份规划历史里已经记录下来的"推迟处理"条目（`progress.md` 和各任务报告）取材，逐条
重新对照当前代码核实过，再加上本任务的 brief 要求逐字纳入的三条。如果"spec 第 15 节"确实还有
这里没覆盖到的条目，这份文档不敢说自己覆盖全了。

## v1.1 候选

### 1. 在渲染阶段抑制那些"预设了某个文件存在"的 gap

**问题在哪：** 一个仓库完全没有进度文件的时候，当前的评估报告会同时显示"缺少进度记录文件"
（`state.no-progress`）和"进度文件已过期"（`state.progress-stale`）——后一条 gap 的前提是这个
文件存在，但前一条 gap 刚刚说了它不存在。直接拿 `fixtures/bad-repo` 实测确认：

```
$ node scripts/assess.mjs fixtures/bad-repo
...
### State · No progress file (ROI 10)
...
### State · Progress file is stale (ROI 10)
...
```

**根因：** `scripts/lib/scorers/ladder.mjs` 从下往上走每一档时，会把每一档里所有没通过的检查项
都收进 gap 列表，并不会因为更低一档的条件（文件是否存在）已经没通过就停止收集。
`scripts/lib/scorers/state.mjs` 的第 2 档无条件检查 `fresh` 和 `hasAllThreeSections`，哪怕第 1 档
的 `hasProgressFile` 已经是 false——所以没有进度文件的仓库确实按预期打了 0 分，但报告里还是把
第 2 档的 gap id 一起带出来了。

**为什么 v1 没修：** Task 14 评审时就有人指出过，当时的协调者明确判定不在 v1 范围内——这属于
范围变更（要动渲染/分组逻辑，不是纯粹的 bug），而这个项目的常设规则是范围变更必须先确认。当时
就记录为"要写进 Task 23 的 ROADMAP v1.1"。

**候选修法方向**（还没定案，需要单独走一遍设计）：要么 (a) 在渲染阶段，如果某个子系统"文件不
存在"这个第 1 档 gap 已经出现了，就抑制掉它第 2 档及以上的 gap；要么 (b) 直接改 gap 文案本身，
让 `state.progress-stale` 的措辞不再暗示文件一定存在（比如改成"过期或缺失"而不是"已过期"）。
(a) 更接近 Task 14 评审讨论时给出的建议方向。

### 2. 抽一个共享的 `MAX_SCORE` 常量

**问题在哪：** 每个子系统的满分档位（`4`）不是单一来源，而是到处重复写的字面量。直接读代码
确认：

- `scripts/lib/report.mjs:48` 和 `:64` 各自独立写了一遍 `max: 4` / `SUBSYSTEMS.length * 4`。
- 六个评分器（`scripts/lib/scorers/{instructions,tools,environment,state,feedback,loop}.mjs`）
  每一个都在自己的 `ladder([...])` 调用里把满分档写成 `{ score: 4, checks: [...] }`——又是六份
  各自独立、背后没有共享常量的"4"。

**为什么 v1 没修：** 这个项目已经被"手工同步的平行列表"咬过四次了（比如下面第 4 条的
`PRUNE_DIRS`/`DEFAULT_IGNORE`，还有 `environment.mjs` 自己注释里记录的
`docker.runtimePins`/`manifest` 和 `CONTAINER_FILES` 那次修复）。抽一个共享的 `MAX_SCORE`
常量是同一类修复，但要同时改 `report.mjs` 加六个评分器文件，改动面确实不小——当时发现这个问题
的 Task 14 只负责 `report.mjs` 一个文件，判定不在那次任务范围内是对的。

### 3. `install.sh` 应该把 checkout 的绝对路径替换进已安装的 skill 文本里

**问题在哪：** `install.sh` 只把 skill 的 markdown 文本复制进它找到的那些 agent 生态目录，从来
不复制 `scripts/`。实测运行确认：

```
$ sh install.sh
-> .claude/skills
installed harness-engineering skills
NOTE: this installs skill text only. scripts/ was NOT copied, and none
of these target directories give the harness-* skills a working path
to it (no $CLAUDE_PLUGIN_ROOT-equivalent variable is set here).
```

五个目标生态（`.claude/skills`、`.cursor/skills`、`.codex/skills`、`.gemini/skills`、
`.agent/skills`）没有一个会拿到类似 `${CLAUDE_PLUGIN_ROOT}` 的变量，所以 skill 文档里写的
`node "${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs"` 命令在跑完一次普通的 `install.sh` 之后没法解析
——装好的 skill 只能在第一次真的要跑命令的时候，反过来问用户"仓库 checkout 在哪"。用户可见的
版本见 [README 的安装一节](README.zh-CN.md#安装)。

**为什么 v1 没修：** Task 22 时就指出过这是一个确实可以做的真修复——`install.sh` 本来就已经
算出了自己的源码 checkout 路径（`HARNESS_SRC`/`$(dirname "$0")`），完全可以把这个绝对路径替换
进已安装的 `SKILL.md` 文本里，顶替 `${CLAUDE_PLUGIN_ROOT}` 占位符——但这属于改变 `install.sh`
行为的范围变更，而本任务被明确要求不许动 `install.sh`，而且这也正是那种需要专门坐下来想清楚
"插件形态 vs 非插件形态该怎么分发"的问题，不该是文档任务的副产品。

## Spec 第 15 节（就现有可查证的材料而言）

本任务计划原文说路线图要覆盖"spec 第 15 节的全部条目"。如前所述，这份 spec 文档不在这次检出
的仓库里。上面三条，是这个项目自己的历史记录里确实以"ROADMAP v1.1 item"这个身份出现过、也确实
核实过的具体候选项。如果仓库之外真的存在更完整的 spec 第 15 节，这份文档没有条件去对照它，也
不敢说自己覆盖完整——只能说，凡是能找到、能核实的，都在这里了。

## 开发过程中记录下来的其他小问题（不是 v1.1 候选，仅作说明）

下面这些是更早的任务里记下来的非阻塞小问题，写这份文档时又重新对照当前代码逐条核实过一遍。列在
这里是为了透明，不代表已经排进了发布计划。

- **`PRUNE_DIRS` 和 `DEFAULT_IGNORE` 依然是两份手工同步的列表。** `scripts/lib/scan.mjs:7` 和
  `:10` 分别定义了 `DEFAULT_IGNORE`（glob 模式）和 `PRUNE_DIRS`（一个装目录名的 `Set`）；改一份
  不改另一份，可能会悄悄让目录遍历的过滤重新出现漏洞。直接读文件确认依然存在。从 Task 4 起就记
  过这个风险，一直不算紧急，没有并进上面第 2 条，但本质上是同一类问题。
- **示例 fixtures 里有一处外观上的不一致。** `fixtures/good-repo/go.sum` 和 `fixtures/mid-repo/
  go.sum` 都锁定了 `github.com/lib/pq`，但对应的 `go.mod` 里没有匹配的 `require` 行，
  `main.go` 里也没有导入它。直接读两份文件确认依然存在。这两个 fixture 本来就是为评分逻辑准备
  的，不需要能真的编译，所以无害——但跟 Task 13 时记录的一样，值得作为一次批量清理的候选项。

## 已知的、刻意接受的边界（不算路线图条目）

安全模块（`scripts/lib/safety.mjs`）有一条有文档记录的结构性天花板——这不是一个待修 bug 队列。
完整表述见 [README 的安全一节](README.zh-CN.md#安全)和 `skills/harness-verify/SKILL.md` 的
Limitations 一节。这些写在那两处而不是这里，是因为经过七轮对抗式评审之后，这个项目自己的结论是
：下一步该做的是如实披露，而不是再打一轮补丁。
