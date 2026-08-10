import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_IGNORE = ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'vendor/**'];

/** Translate a minimal glob (supports * and **) into an anchored RegExp. */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // '**/' matches zero or more path segments; bare '**' matches anything.
        if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function walk(root, dir, acc) {
  let entries;
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, rel, acc);
    else if (entry.isFile()) acc.push(rel);
  }
  return acc;
}

export function createScanContext(root, opts = {}) {
  const ignoreRes = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])].map(globToRegExp);
  const isIgnored = (rel) => ignoreRes.some((re) => re.test(rel));
  let cachedFiles = null;

  const allFiles = () => {
    if (cachedFiles === null) {
      cachedFiles = walk(root, '', []).filter((rel) => !isIgnored(rel)).sort();
    }
    return cachedFiles;
  };

  const abs = (rel) => join(root, rel.split('/').join(sep));

  return {
    root,
    exists: (rel) => existsSync(abs(rel)),
    read(rel) {
      try { return readFileSync(abs(rel), 'utf8'); } catch { return null; }
    },
    readJson(rel) {
      const raw = this.read(rel);
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    list(patterns) {
      const res = patterns.map(globToRegExp);
      return allFiles().filter((rel) => res.some((re) => re.test(rel)));
    },
    mtime(rel) {
      try { return statSync(abs(rel)).mtime; } catch { return null; }
    },
    gitLastCommit(rel) {
      try {
        const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel], {
          cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return out ? new Date(out) : null;
      } catch { return null; }
    },
  };
}

export { globToRegExp };
