# Maker-Checker 循环

两个角色，绝不是同一个 agent 实例：maker 提出改动，独立的 checker 按
`evaluator-rubric.md` 来判断。把这两者分开，是为了防住无人盯防的循环里最
大的一类失败——agent 自己给自己的作业打分。

## Maker

- 读 `feature_list.json` 和 `PROGRESS.md`，挑出下一项，做出能满足它的最
  小改动。
- 交接之前自己先跑一遍声明的验证命令——把一个从没跑过的改动扔给
  checker，是在浪费 checker 的这一轮去发现 maker 本该自己发现的问题。
- 交接时写清楚改了什么、为什么，而不只是一份 diff。

## Checker

- 只按 `evaluator-rubric.md` 判断 maker 的产出——绝不凭自己临场的看法，
  否则循环会一轮一轮地漂移。
- 真的跑一遍 `verify --run`（或者读一份新鲜、合法的
  `.harness/verify-report.json`），而不是信 maker 自称通过了。
- 通过就停止或推进到下一项；不通过就带着具体原因退回给 maker——不是一句
  含糊的"再试一次"。

## 回滚

- 每一轮 maker 的改动都落在自己的 commit（或分支）上，这样检查不通过时
  有明确的东西可以回滚——用 `git revert`，而不是手改一个"往前修"的补丁。
- <!-- FILL: 如果这个项目的回滚机制不只是普通的 git，把它写在这里——比如
  数据库迁移的 down 脚本、一个 feature flag、一份快照。 -->
- 回滚本身也要用同样的方式验证：声明的命令在回滚后的状态上也必须能通过。
