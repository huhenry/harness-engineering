// One semantic vocabulary for both the ordinary Loop scorer and the
// harness-distribution profile. Duplicating these expressions would let the
// same sentence mean different things depending on which scan path found it.
//
// The Latin loop alternatives are common word fragments ('loop' inside
// 'loophole', 'cron' inside 'micron'), so each is word-boundary anchored.
// CJK alternatives stay outside that group: JavaScript's \b is defined via
// Latin word characters and would stop matching ordinary Chinese prose.
const LOOP_KEYWORD_RE = /\b(autonomous|loop|cron|scheduled)\b|自主|循环/i;
const STOP_CONDITION_RE = /stop condition|exit criteria|停止条件|退出条件/i;
const BUDGET_CAP_RE = /max iterations|budget|token cap|最大迭代|预算/i;
const MAKER_CHECKER_RE = /maker-checker|reviewer agent|角色分离/i;
const ROLLBACK_RE = /rollback|revert|回滚/i;

/** Pure classification of documented loop properties. */
export function analyzeLoopText(text = '') {
  return {
    hasKeyword: LOOP_KEYWORD_RE.test(text),
    hasStopCondition: STOP_CONDITION_RE.test(text),
    hasBudgetCap: BUDGET_CAP_RE.test(text),
    hasMakerChecker: MAKER_CHECKER_RE.test(text),
    hasRollback: ROLLBACK_RE.test(text),
  };
}
