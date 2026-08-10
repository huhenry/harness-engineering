import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, findSection, bashCommands } from '../scripts/lib/markdown.mjs';

const DOC = [
  '# Project',
  '',
  'See [rubric](docs/rubric.md) and [site](https://example.com).',
  '',
  '## Verification',
  '',
  '```bash',
  '# run the tests',
  '$ go test ./...',
  'golangci-lint run',
  '```',
  '',
  '## Constraints',
  '',
  'Never push to prod.',
  '',
].join('\n');

test('counts lines and headings without treating fenced # as heading', () => {
  const p = parseMarkdown(DOC);
  assert.equal(p.lineCount, 16);
  assert.deepEqual(p.headings.map((h) => h.text), ['Project', 'Verification', 'Constraints']);
  assert.deepEqual(p.headings.map((h) => h.level), [1, 2, 2]);
});

test('collects only local links', () => {
  const p = parseMarkdown(DOC);
  assert.deepEqual(p.localLinks.map((l) => l.target), ['docs/rubric.md']);
});

test('sections split at same-or-higher level headings', () => {
  const p = parseMarkdown(DOC);
  const verify = findSection(p, /verif/i);
  assert.ok(verify);
  assert.equal(verify.heading, 'Verification');
  assert.equal(verify.codeBlocks.length, 1);
  assert.equal(verify.codeBlocks[0].lang, 'bash');
  assert.doesNotMatch(verify.body, /Never push to prod/);
});

test('bashCommands strips comments, prompts and blanks', () => {
  const p = parseMarkdown(DOC);
  assert.deepEqual(bashCommands(findSection(p, /verif/i)), ['go test ./...', 'golangci-lint run']);
});

test('findSection returns null when nothing matches', () => {
  assert.equal(findSection(parseMarkdown(DOC), /nonexistent/i), null);
});

test('empty document parses to empty structures', () => {
  const p = parseMarkdown('');
  assert.equal(p.lineCount, 0);
  assert.deepEqual(p.headings, []);
  assert.deepEqual(p.sections, []);
});

// --- Self-review edge cases ---

test('fence opened with ~~~ hides a fenced # from heading parsing', () => {
  const doc = ['# T', '', '~~~js', '# not a heading', 'code();', '~~~', ''].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.headings.map((h) => h.text), ['T']);
  assert.equal(p.codeBlocks[0].code, '# not a heading\ncode();');
});

test('an unclosed fence at EOF still captures its content as a code block and hides headings within it', () => {
  const doc = ['# A', '', '```bash', 'echo hi', '', '## B', 'content'].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.headings.map((h) => h.text), ['A']);
  assert.equal(p.codeBlocks.length, 1);
  assert.equal(p.codeBlocks[0].code, 'echo hi\n\n## B\ncontent');
});

test('a heading-like line inside a fence is never treated as a heading', () => {
  const doc = ['# A', '```', '### fake heading', '```', '## B'].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.headings.map((h) => h.text), ['A', 'B']);
});

test('an indented fence inside a list item is still tracked', () => {
  const doc = ['# A', '', '- item one', '  ```bash', '  echo hi', '  ```', '- item two', '', '## B', 'text'].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.headings.map((h) => h.text), ['A', 'B']);
  assert.equal(p.codeBlocks.length, 1);
  assert.equal(p.codeBlocks[0].lang, 'bash');
});

test('a section includes content under sub-headings deeper than itself', () => {
  const doc = ['# A', 'a-content', '## A.1', 'a1-content', '### A.1.1', 'a11-content', '# B', 'b-content'].join('\n');
  const p = parseMarkdown(doc);
  const secA = findSection(p, /^A$/);
  assert.match(secA.body, /a1-content/);
  assert.match(secA.body, /a11-content/);
});

test('a link with a title captures only the target path', () => {
  const doc = ['# A', '', 'See [x](docs/a.md "title here") ok.'].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.localLinks.map((l) => l.target), ['docs/a.md']);
});

test('http(s) links and bare anchors are excluded from localLinks', () => {
  const doc = ['# A', '', '[ext](http://example.com) [anchor](#section) [rel](./b.md)'].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.localLinks.map((l) => l.target), ['./b.md']);
});

test('a closing fence shorter than the opening fence does not close it, and does not corrupt following sections', () => {
  const doc = ['# A', '````bash', '```', '# still inside fence', 'echo hi', '````', '## B', 'text'].join('\n');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.headings.map((h) => h.text), ['A', 'B']);
  const secA = findSection(p, /^A$/);
  assert.equal(secA.codeBlocks.length, 1);
  assert.equal(secA.codeBlocks[0].code, '```\n# still inside fence\necho hi');
});

test('a fence-like line using the other marker style stays as code content, not dropped', () => {
  const doc = ['# A', '```bash', 'echo before', '~~~~', 'echo after', '```'].join('\n');
  const p = parseMarkdown(doc);
  assert.equal(p.codeBlocks[0].code, 'echo before\n~~~~\necho after');
});

// --- CRLF line endings ---
// AGENTS.md files authored on Windows routinely ship with CRLF. A trailing \r
// left on every line breaks the anchored heading regex entirely (0 headings,
// 0 sections, 0 commands extracted) — a silent "nothing to verify" rather
// than an error.

const DOC_CRLF = DOC.replace(/\n/g, '\r\n');

test('a CRLF document parses headings identically to its LF equivalent', () => {
  const lf = parseMarkdown(DOC);
  const crlf = parseMarkdown(DOC_CRLF);
  assert.deepEqual(crlf.headings.map((h) => h.text), lf.headings.map((h) => h.text));
  assert.deepEqual(crlf.headings.map((h) => h.level), lf.headings.map((h) => h.level));
  assert.deepEqual(crlf.headings.map((h) => h.line), lf.headings.map((h) => h.line));
});

test('a CRLF document has the same lineCount as its LF equivalent', () => {
  const lf = parseMarkdown(DOC);
  const crlf = parseMarkdown(DOC_CRLF);
  assert.equal(crlf.lineCount, lf.lineCount);
});

test('a CRLF document does not gain or lose a line when it ends in \\r\\n vs \\n', () => {
  const endsLf = parseMarkdown('# A\r\nbody\n');
  const endsCrlf = parseMarkdown('# A\r\nbody\r\n');
  assert.equal(endsLf.lineCount, endsCrlf.lineCount);
});

test('a fenced # comment inside a CRLF document is still not parsed as a heading', () => {
  const p = parseMarkdown(DOC_CRLF);
  assert.deepEqual(p.headings.map((h) => h.text), ['Project', 'Verification', 'Constraints']);
  const verify = findSection(p, /verif/i);
  assert.equal(verify.codeBlocks.length, 1);
  assert.equal(verify.codeBlocks[0].lang, 'bash');
});

test('bashCommands from a CRLF document come back without stray \\r', () => {
  const p = parseMarkdown(DOC_CRLF);
  const cmds = bashCommands(findSection(p, /verif/i));
  assert.deepEqual(cmds, ['go test ./...', 'golangci-lint run']);
  for (const cmd of cmds) assert.ok(!cmd.includes('\r'), `command ${JSON.stringify(cmd)} contains \\r`);
});

test('local link targets from a CRLF document have no trailing \\r', () => {
  const p = parseMarkdown(DOC_CRLF);
  assert.deepEqual(p.localLinks.map((l) => l.target), ['docs/rubric.md']);
});

test('a lone-\\r (classic Mac) document also parses headings correctly', () => {
  const doc = DOC.replace(/\n/g, '\r');
  const p = parseMarkdown(doc);
  assert.deepEqual(p.headings.map((h) => h.text), ['Project', 'Verification', 'Constraints']);
  assert.equal(p.lineCount, 16);
});
