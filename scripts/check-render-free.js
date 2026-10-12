'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['.'];
const SELF_PATH = 'scripts/check-render-free.js';
const TEXT_EXTENSIONS = /\.(?:c|cc|cpp|h|hpp|js|cjs|mjs|html|css|json|ya?ml|toml|py|md|txt|sh|xml|conf|env\.example)$/i;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const IGNORED_FILE_SUFFIXES = ['.bak', '.before-supabase-cleanup', '.before-supabase-normalize'];
const RULES = [
  { name: 'hard-coded Render service hostname', pattern: /https?:\/\/[^\s"'\x60<>]*\.onrender\.com\b/i },
  { name: 'Render-specific runtime environment variable', pattern: /\bRENDER_[A-Z0-9_]+\b/ }
];

const failures = [];
let scanned = 0;

function walk(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return;
  let entries;
  try {
    entries = fs.readdirSync(fullPath, { withFileTypes: true });
  } catch (error) {
    failures.push(`Cannot scan ${relativePath}: ${error.message}`);
    return;
  }

  for (const entry of entries) {
    const childRelative = path.posix.join(relativePath.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && entry.name !== '.vercel') walk(childRelative);
      continue;
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.test(entry.name)) continue;
    if (path.posix.normalize(childRelative) === SELF_PATH) continue;
    if (IGNORED_FILE_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue;
    if (/^(?:\.env(?:\.|$)|Environment$)/i.test(entry.name)) continue;
    if (/^render\.(?:yaml|yml)$/i.test(entry.name)) {
      failures.push(`Render deployment manifest remains: ${childRelative}`);
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(path.join(ROOT, childRelative), 'utf8');
    } catch (error) {
      failures.push(`Cannot read ${childRelative}: ${error.message}`);
      continue;
    }
    scanned += 1;

    for (const rule of RULES) {
      const match = rule.pattern.exec(content);
      if (match) {
        const before = content.slice(0, match.index);
        const line = before.split(/\r?\n/).length;
        failures.push(`${childRelative}:${line}: ${rule.name}`);
      }
    }
  }
}

for (const directory of SCAN_ROOTS) walk(directory);

if (failures.length) {
  console.error('Render dependency audit FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Render dependency source audit passed (${scanned} text files scanned).`);
}
