#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const ALL_ZERO_SHA = /^0+$/;
const LINTABLE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
]);

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function runGit(args, fallback = '') {
  try {
    const out = execFileSync('git', args, {
      cwd: CWD,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function resolveRange() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = args.base || process.env.LINT_GUARD_BASE || 'origin/main';
  let fromRef = args.from || process.env.GITHUB_EVENT_BEFORE || '';
  let toRef = args.to || process.env.GITHUB_SHA || 'HEAD';

  if (!fromRef) {
    const baseFromMergeBase = runGit(['merge-base', 'HEAD', baseRef], '');
    fromRef = baseFromMergeBase || 'HEAD~1';
  }

  if (ALL_ZERO_SHA.test(fromRef)) {
    const mergeBase = runGit(['merge-base', toRef, baseRef], '');
    fromRef = mergeBase || runGit(['rev-parse', `${toRef}~1`], '');
  }

  if (!fromRef) {
    console.error('lint-guard: unable to resolve "from" reference.');
    process.exit(2);
  }

  return { fromRef, toRef, baseRef };
}

function isMergeCommit(ref) {
  const raw = runGit(['rev-list', '--parents', '-n', '1', ref], '');
  if (!raw) return false;
  const parts = raw.split(/\s+/).filter(Boolean);
  // Format: <commit> <parent1> <parent2>...
  return parts.length > 2;
}

function changedFiles(fromRef, toRef) {
  const raw = runGit(
    ['diff', '--name-only', '--diff-filter=ACMR', fromRef, toRef],
    '',
  );
  if (!raw) return [];
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizePath)
    .filter((filePath) => LINTABLE_EXTENSIONS.has(path.extname(filePath)));
}

function parseChangedLineRanges(fromRef, toRef, filePath) {
  const raw = runGit(
    ['diff', '--unified=0', '--no-color', fromRef, toRef, '--', filePath],
    '',
  );
  const ranges = [];
  if (!raw) return ranges;

  const lines = raw.split('\n');
  const hunkRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const line of lines) {
    const match = hunkRegex.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] ? Number(match[2]) : 1;
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;
    ranges.push({ start, end: start + count - 1 });
  }
  return ranges;
}

function overlapsChangedLines(message, ranges) {
  if (!ranges || ranges.length === 0) return false;
  const line = Number(message.line || 0);
  const endLine = Number(message.endLine || line || 0);

  // File-level parser/config errors should block if they occur in changed files.
  if (line <= 0 || endLine <= 0) return true;

  return ranges.some((range) => line <= range.end && endLine >= range.start);
}

function runEslint(files) {
  const cmd = 'npx';
  const args = ['eslint', '-f', 'json', '--no-error-on-unmatched-pattern', ...files];
  const result = spawnSync(cmd, args, {
    cwd: CWD,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (!stdout) {
    if (result.status === 0) return [];
    if (stderr) console.error(stderr);
    console.error('lint-guard: eslint returned non-zero with no JSON output.');
    process.exit(result.status || 2);
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    console.error('lint-guard: failed to parse eslint JSON output.');
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
    process.exit(2);
  }
}

function formatSeverity(severity) {
  return severity === 2 ? 'error' : 'warning';
}

function main() {
  const { fromRef, toRef } = resolveRange();
  const skipMergeCommits =
    (process.env.LINT_GUARD_SKIP_MERGE_COMMITS || 'true') !== 'false';

  if (skipMergeCommits && isMergeCommit(toRef)) {
    console.log('lint-guard: merge commit detected; skipping incremental lint guard.');
    process.exit(0);
  }

  const files = changedFiles(fromRef, toRef).filter((filePath) =>
    fs.existsSync(path.join(CWD, filePath)),
  );

  if (files.length === 0) {
    console.log('lint-guard: no changed lintable files in range.');
    process.exit(0);
  }

  const includeWarnings = (process.env.LINT_GUARD_INCLUDE_WARNINGS || 'true') !== 'false';
  const minSeverity = includeWarnings ? 1 : 2;

  const rangesByFile = new Map();
  for (const filePath of files) {
    rangesByFile.set(filePath, parseChangedLineRanges(fromRef, toRef, filePath));
  }

  const eslintResults = runEslint(files);
  const violations = [];

  for (const fileResult of eslintResults) {
    const rel = normalizePath(path.relative(CWD, fileResult.filePath || ''));
    const ranges = rangesByFile.get(rel);
    if (!ranges) continue;

    for (const message of fileResult.messages || []) {
      if ((message.severity || 0) < minSeverity) continue;
      if (!overlapsChangedLines(message, ranges)) continue;
      violations.push({
        filePath: rel,
        line: message.line || 0,
        column: message.column || 0,
        severity: message.severity || 0,
        ruleId: message.ruleId || '(no-rule)',
        message: message.message || 'Unknown lint violation',
      });
    }
  }

  if (violations.length === 0) {
    console.log('lint-guard: passed (no lint violations on changed lines).');
    process.exit(0);
  }

  console.error('\nlint-guard: found lint violations on changed lines:\n');
  for (const v of violations) {
    console.error(
      `${v.filePath}:${v.line}:${v.column}  ${formatSeverity(v.severity)}  ${v.ruleId}  ${v.message}`,
    );
  }

  console.error(
    `\nlint-guard: ${violations.length} violation(s) detected on changed lines.`,
  );
  process.exit(1);
}

main();
