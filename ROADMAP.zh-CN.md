# 路线图

这不是一份愿望清单。下面每一条都是这个项目开发过程中真实发现、又刻意推迟处理的条目——
不是事后为了凑数编出来的。每一条都会说清楚：发现了什么、怎么核实的、为什么 v1 没修。

v1.1 已经把这一节原本跟踪的四条候选全部发布：占位符规则、渲染期 gap 抑制、共享的
`MAX_SCORE` 常量，以及 `install.sh` 的路径替换。其中有一条实际交付的范围比原条目要窄，
剩下的部分记在下面，而不是跟着条目一起删掉。再往后那些更大的方向来自项目最初的设计文档。

## v1.1 遗留、仍然未解决的部分

- **没填写的模板在绝大多数地方依然算作"内容"。** 占位符规则
  （`scripts/lib/placeholder.mjs`）只接进了一处检查：`scripts/lib/scorers/state.mjs` 里第 4 级
  的交接产物。`instructions`、`tools`、`loop`，以及 `state` 的另外三级，依然会把一份自己都写着
  "这是占位符"的文件算作内容。直接实测过：往一个空目录 `scaffold --apply`，再对它跑 `assess`，
  得到 **12/24，其中 Tools 4/4、Loop 4/4**——这两项完全是靠没人读过的文件拿到的。
  `templates/en/Makefile` 开头几行自己就写着"下面每一个 target 在 FILL 那些行被替换之前都只是
  占位符"；三份 `loop/*.md` 模板和 `evaluator-rubric.md` 都带着 `FILL:` 标记；`PROGRESS.md` 和
  `feature_list.json` 也是同样的方式把 State 顶到 3/4。这不是回归——v1.1 本来就只覆盖交接那一
  级，这是它之前就有的状态——但要把它关掉，是要跨好几个 scorer 重新定义"存在"是什么意思，
  而不是再多调一次 `isFilledArtifact`：所有 fixture 的分数和这个仓库自己的自评分都得重新推导。
  `instructions.unfilled-template` 是顺理成章的第一步，而且它本身就是一个独立任务：新的 gap
  id、双语文案、`references/rubric.md` 两个语言版本各加一行，外加一个新 fixture。

## v1.1 之后：更大的方向

这几条来自项目最初的设计文档。按本项目的约定，开源仓库的规划文档放在仓库外的同级目录里，
所以它本来就不会出现在一次检出中。下面是方向，不是排期，一条都还没开始动。

- **Graph engineering。** 多 agent 编排：把 agent 的执行步骤定义成一张 DAG，并且为**整张图**
  定义验收标准，而不是一次只管一个 agent。这个工具里的 Loop 子系统，是这件事的单 agent 特例。
- **更多技术栈探测器。** Rust、Java、Swift，以及嵌入式的 PlatformIO。
  `scripts/lib/stack.mjs` 里的探测表是按"加一条签名就能扩展"设计的，不用改任何评分逻辑——
  加一个新栈不应该需要动到任何一个 scorer。
- **`harness diff`。** 同一个仓库两次体检之间的分数变化，让团队看到的是"我们的 harness 在
  变好吗"，而不只是"今天考了多少分"。
- **GitHub Action。** 发一个市场版本，在 PR 上自动评论 harness 分数的变化，
  把体检变成 review 阶段的一个信号，而不是一件"谁记得就跑一下"的事。
- **Web dashboard。** 把多个仓库的体检结果放在一个视图里看。

## 开发过程中记录下来的其他小问题（不是 v1.1 候选，仅作说明）

下面这些是更早的任务里记下来的非阻塞小问题，写这份文档时又重新对照当前代码逐条核实过一遍。列在
这里是为了透明，不代表已经排进了发布计划。

- **`PRUNE_DIRS` 和 `DEFAULT_IGNORE` 依然是两份手工同步的列表。** `scripts/lib/scan.mjs:7` 和
  `:10` 分别定义了 `DEFAULT_IGNORE`（glob 模式）和 `PRUNE_DIRS`（一个装目录名的 `Set`）；改一份
  不改另一份，可能会悄悄让目录遍历的过滤重新出现漏洞。直接读文件确认依然存在。从 Task 4 起就记
  过这个风险，跟 v1.1 里已经修好的 `MAX_SCORE` 重复问题本质上是同一类"手工同步列表"风险，
  但没有并进那次修复，依然是个未解决的问题。
- **示例 fixtures 里有一处外观上的不一致。** `fixtures/good-repo/go.sum` 和 `fixtures/mid-repo/
  go.sum` 都锁定了 `github.com/lib/pq`，但对应的 `go.mod` 里没有匹配的 `require` 行，
  `main.go` 里也没有导入它。直接读两份文件确认依然存在。这两个 fixture 本来就是为评分逻辑准备
  的，不需要能真的编译，所以无害——但跟 Task 13 时记录的一样，值得作为一次批量清理的候选项。

## 已知的、刻意接受的边界（不算路线图条目）

安全模块（`scripts/lib/safety.mjs`）有一条有文档记录的结构性天花板——这不是一个待修 bug 队列。
完整表述见 [README 的安全一节](README.zh-CN.md#安全)和 `skills/harness-verify/SKILL.md` 的
Limitations 一节。这些写在那两处而不是这里，是因为经过七轮对抗式评审之后，这个项目自己的结论是
：下一步该做的是如实披露，而不是再打一轮补丁。

"模板没填写"这项检查里的逐字节比较也有同一类天花板：CRLF 换行的检出、结尾换行不一致、任意一个
字符的改动、模板正文跨版本变过，都会让它失效；而在只带 `scripts/`、没有 `templates/` 的安装形
态里，它会静默变成空操作。完整表述写在
[`references/rubric.zh-CN.md`](references/rubric.zh-CN.md#模板没填写这项检查抓不到什么)，
紧挨着它所限定的那条规则，不在这里重复。
