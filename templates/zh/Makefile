# 由 harness-engineering scaffold 生成。下面每个 target 都是占位——在把
# FILL 那两行换成真命令之前，`test` 和 `lint` 会故意以非零退出，这样接进
# CI 的 `check` 会明确报错，而不是对一件根本没做过的事悄悄显示绿色。

.PHONY: bootstrap test lint check

bootstrap:
	./init.sh

test:
	@echo "test：还没有配置真正的测试命令。" >&2
	@echo "把这个 target 填好，再把 harness.config.json 的 verify.test 设成同一条命令。" >&2
	@exit 1

lint:
	@echo "lint：还没有配置真正的 lint 命令。" >&2
	@echo "把这个 target 填好，再把 harness.config.json 的 verify.lint 设成同一条命令。" >&2
	@exit 1

check: test lint
