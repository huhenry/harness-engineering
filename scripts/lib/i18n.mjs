import { CliError } from './cli.mjs';

export const SUPPORTED_LANGS = ['en', 'zh'];

export const MESSAGES = {
  en: {
    'subsystem.instructions': 'Instructions',
    'subsystem.tools': 'Tools',
    'subsystem.environment': 'Environment',
    'subsystem.state': 'State',
    'subsystem.feedback': 'Feedback',
    'subsystem.loop': 'Loop',
    'report.score': 'Score: {total} / {max}',
    'report.level': 'Level: L{id} {name}',
    'report.title': 'Harness Assessment Report',
    'report.needsEvidence': 'capped — run `verify --run` for evidence',
    'report.noGaps': 'No gaps found.',
    'report.gapsHeading': 'Gaps by ROI',
  },
  zh: {
    'subsystem.instructions': '指令',
    'subsystem.tools': '工具',
    'subsystem.environment': '环境',
    'subsystem.state': '状态',
    'subsystem.feedback': '反馈',
    'subsystem.loop': '循环',
    'report.score': '得分：{total} / {max}',
    'report.level': '等级：L{id} {name}',
    'report.title': 'Harness 体检报告',
    'report.needsEvidence': '已封顶 —— 跑 `verify --run` 补证据',
    'report.noGaps': '未发现差距。',
    'report.gapsHeading': '差距清单（按 ROI 排序）',
  },
};

/** Look up a localized message and interpolate {var} placeholders. */
export function t(key, lang, vars = {}) {
  const table = MESSAGES[lang];
  if (!table) throw new Error(`Unsupported language: ${lang}`);
  const raw = table[key];
  if (raw === undefined) throw new Error(`Missing i18n key: ${key}`);
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

export function assertLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) {
    throw new CliError(`Unsupported language: ${lang}. Use one of: ${SUPPORTED_LANGS.join(', ')}`);
  }
  return lang;
}
