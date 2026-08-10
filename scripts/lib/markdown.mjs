const FENCE = /^\s*(```+|~~~+)\s*(\S+)?/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LINK = /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
const EXTERNAL = /^(https?:|mailto:|#)/;

/** Parse a Markdown document into headings, sections, code blocks and local links. */
export function parseMarkdown(text) {
  // Normalize CRLF and lone-CR (classic Mac) line endings before splitting.
  // Left unnormalized, a trailing \r survives on every line: `.` in HEADING
  // excludes \r and the anchored `$` requires true end-of-string, so headings
  // never match at all on a CRLF document — silently producing zero
  // sections and zero extracted commands instead of an error.
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized === '' ? [] : normalized.split('\n');
  const headings = [];
  const codeBlocks = [];
  const localLinks = [];
  let fence = null;
  let buffer = null;

  lines.forEach((line, idx) => {
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1];
        buffer = { lang: fenceMatch[2] ?? null, code: [], line: idx + 1 };
        return;
      }
      // A closing fence must use the same marker character as the opener and
      // be at least as long (CommonMark). A shorter or differently-charactered
      // run is ordinary content — e.g. a ``` block containing a ~~~~ example,
      // or a ```` block containing a nested ``` snippet — and must not close
      // the fence early, or trailing content would be mis-parsed as headings.
      if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        codeBlocks.push({ ...buffer, code: buffer.code.join('\n') });
        fence = null;
        buffer = null;
        return;
      }
      buffer.code.push(line);
      return;
    }
    if (fence !== null) { buffer.code.push(line); return; }

    const h = line.match(HEADING);
    if (h) { headings.push({ level: h[1].length, text: h[2].trim(), line: idx + 1 }); return; }

    for (const m of line.matchAll(LINK)) {
      if (!EXTERNAL.test(m[2])) localLinks.push({ text: m[1], target: m[2], line: idx + 1 });
    }
  });

  // An opening fence with no matching close runs to end of document
  // (CommonMark), so its accumulated content is still a real code block —
  // it must not be silently discarded.
  if (buffer !== null) codeBlocks.push({ ...buffer, code: buffer.code.join('\n') });

  const sections = headings.map((heading, i) => {
    const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
    const endLine = next ? next.line - 1 : lines.length;
    return {
      heading: heading.text,
      level: heading.level,
      startLine: heading.line,
      endLine,
      body: lines.slice(heading.line, endLine).join('\n'),
      codeBlocks: codeBlocks.filter((b) => b.line > heading.line && b.line <= endLine),
    };
  });

  return { lineCount: lines.length, headings, sections, codeBlocks, localLinks };
}

export function findSection(parsed, re) {
  return parsed.sections.find((s) => re.test(s.heading)) ?? null;
}

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

/** Extract runnable shell commands from a section's fenced blocks. */
export function bashCommands(section) {
  if (!section) return [];
  return section.codeBlocks
    .filter((b) => b.lang && SHELL_LANGS.has(b.lang.toLowerCase()))
    .flatMap((b) => b.code.split('\n'))
    .map((line) => line.replace(/^\s*\$\s+/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}
