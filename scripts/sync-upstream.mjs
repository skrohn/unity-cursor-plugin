#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'https://github.com/Unity-Technologies/unity-agent-plugin';
const DEFAULT_REF = 'main';
const CURSOR_REPO = 'https://github.com/skrohn/unity-cursor-plugin';
const EXCLUDED_NAMES = new Set(['evals', 'tests', '.DS_Store', 'Thumbs.db', '.git']);
const ASSET_FILES = ['assets/unity.svg', 'assets/unity-small.svg', 'assets/unity-tile.svg'];

function parseArgs(argv) {
  const options = {
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    upstreamDir: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--repo') {
      options.repo = requireValue(argv, ++i, arg);
    } else if (arg === '--ref') {
      options.ref = requireValue(argv, ++i, arg);
    } else if (arg === '--upstream-dir') {
      options.upstreamDir = resolve(requireValue(argv, ++i, arg));
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/sync-upstream.mjs [options]',
      '',
      'Options:',
      `  --repo <url>           Upstream git URL (default: ${DEFAULT_REPO})`,
      `  --ref <ref>            Upstream branch, tag, or commit (default: ${DEFAULT_REF})`,
      '  --upstream-dir <path>  Use an existing local upstream checkout instead of cloning',
      '  --dry-run              Report pending changes without modifying repository files',
      '  -h, --help             Show this help message',
    ].join('\n'),
  );
}

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function cloneUpstream(repo, ref, targetDir) {
  try {
    runGit(['clone', '--depth', '1', '--branch', ref, '--single-branch', repo, targetDir]);
    return;
  } catch {
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });
  }

  runGit(['clone', '--no-checkout', repo, targetDir]);
  runGit(['checkout', ref], targetDir);
}

function readUpstreamCommit(upstreamDir) {
  if (!existsSync(join(upstreamDir, '.git'))) {
    return '';
  }
  return runGit(['rev-parse', 'HEAD'], upstreamDir);
}

function readUpstreamMetadata(upstreamDir) {
  const candidates = [
    join(upstreamDir, 'scripts', 'plugin-metadata.json'),
    join(upstreamDir, '.claude-plugin', 'plugin.json'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (typeof data.version !== 'string' || data.version.trim() === '') {
      throw new Error(`Missing version in ${filePath}`);
    }
    return data;
  }

  throw new Error('Could not find scripts/plugin-metadata.json or .claude-plugin/plugin.json in upstream checkout');
}

function collectFiles(rootDir, baseDir = rootDir, out = new Map(), applyExclusions = true) {
  if (!existsSync(rootDir)) return out;
  const entries = readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (applyExclusions && EXCLUDED_NAMES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, baseDir, out, applyExclusions);
    } else if (entry.isFile()) {
      const rel = relative(baseDir, fullPath).replaceAll('\\', '/');
      out.set(rel, readFileSync(fullPath));
    }
  }

  return out;
}

function countSkills(desiredSkillPaths) {
  const refSkills = new Set();
  const topSkills = new Set();

  for (const rel of desiredSkillPaths) {
    const refMatch = rel.match(/^skills\/using-unity\/references\/([^/]+)\//);
    if (refMatch) {
      refSkills.add(refMatch[1]);
    }
    const topMatch = rel.match(/^skills\/([^/]+)\//);
    if (topMatch) {
      topSkills.add(topMatch[1]);
    }
  }

  return refSkills.size > 0 ? refSkills.size : topSkills.size;
}

function updatePluginJson(repoRoot, meta) {
  const filePath = join(repoRoot, '.cursor-plugin', 'plugin.json');
  const current = JSON.parse(readFileSync(filePath, 'utf8'));
  const updated = {
    ...current,
    version: meta.version,
    author: structuredClone(meta.author ?? current.author),
    homepage: meta.homepage ?? current.homepage,
    repository: CURSOR_REPO,
    license: meta.license ?? current.license,
    keywords: structuredClone(meta.keywords ?? current.keywords),
    category: 'developer-tools',
    skills: './skills/',
  };

  if (current.displayName !== undefined) updated.displayName = current.displayName;
  if (current.description !== undefined) updated.description = current.description;
  if (current.logo !== undefined) updated.logo = current.logo;
  if (current.tags !== undefined) updated.tags = current.tags;

  return Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

function updateMarketplaceJson(repoRoot, meta, pluginName) {
  const filePath = join(repoRoot, '.cursor-plugin', 'marketplace.json');
  const current = JSON.parse(readFileSync(filePath, 'utf8'));
  const updated = structuredClone(current);

  updated.metadata = {
    ...(updated.metadata ?? {}),
    version: meta.version,
  };

  const entry =
    updated.plugins?.find((plugin) => plugin.name === pluginName) ??
    updated.plugins?.[0];

  if (!entry) {
    throw new Error('No plugin entry found in .cursor-plugin/marketplace.json');
  }

  if (entry.version !== undefined) {
    entry.version = meta.version;
  }
  entry.author = structuredClone(meta.author ?? entry.author);
  entry.homepage = meta.homepage ?? entry.homepage;
  entry.repository = CURSOR_REPO;
  entry.license = meta.license ?? entry.license;
  entry.keywords = structuredClone(meta.keywords ?? entry.keywords);
  entry.category = 'developer-tools';

  return Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

function updateReadme(repoRoot, version, skillCount) {
  const filePath = join(repoRoot, 'README.md');
  let content = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  content = content.replace(
    /(Unity plugin for Cursor \(`v)([^`]+)(`\))/,
    `$1${version}$3`,
  );
  content = content.replace(
    /(\[`Unity-Technologies\/unity-agent-plugin`\]\(https:\/\/github\.com\/Unity-Technologies\/unity-agent-plugin\) \(`v)([^`]+)(`\))/,
    `$1${version}$3`,
  );
  content = content.replace(
    /(verify \*\*Unity\*\* \(`)([^`]+)(`\))/,
    `$1${version}$3`,
  );
  content = content.replace(
    /(routes requests to )\d+( specialized Unity skills)/,
    `$1${skillCount}$2`,
  );

  return Buffer.from(content, 'utf8');
}

function pruneEmptyDirs(dirPath, rootDir) {
  if (!existsSync(dirPath)) return;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      pruneEmptyDirs(join(dirPath, entry.name), rootDir);
    }
  }
  if (dirPath !== rootDir && readdirSync(dirPath).length === 0) {
    rmSync(dirPath, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '..');

  let tempDir = null;
  let upstreamDir = options.upstreamDir;

  try {
    if (upstreamDir) {
      if (!existsSync(upstreamDir) || !statSync(upstreamDir).isDirectory()) {
        throw new Error(`Upstream directory does not exist: ${upstreamDir}`);
      }
    } else {
      tempDir = mkdtempSync(join(tmpdir(), 'unity-cursor-plugin-upstream-'));
      upstreamDir = tempDir;
      cloneUpstream(options.repo, options.ref, upstreamDir);
    }

    const commit = readUpstreamCommit(upstreamDir);
    const meta = readUpstreamMetadata(upstreamDir);

    const upstreamSkillsDir = join(upstreamDir, 'skills');
    if (!existsSync(upstreamSkillsDir) || !statSync(upstreamSkillsDir).isDirectory()) {
      throw new Error(`Missing skills directory in upstream: ${upstreamSkillsDir}`);
    }

    const desiredFiles = new Map();
    const skillFiles = collectFiles(upstreamSkillsDir, upstreamDir, new Map(), true);
    for (const [rel, buf] of skillFiles) {
      desiredFiles.set(rel, buf);
    }

    for (const assetRel of ASSET_FILES) {
      const assetPath = join(upstreamDir, assetRel);
      if (!existsSync(assetPath)) {
        throw new Error(`Missing upstream asset: ${assetRel}`);
      }
      desiredFiles.set(assetRel, readFileSync(assetPath));
    }

    const licensePath = join(upstreamDir, 'LICENSE.md');
    if (!existsSync(licensePath)) {
      throw new Error('Missing upstream LICENSE.md');
    }
    desiredFiles.set('LICENSE.md', readFileSync(licensePath));

    const pluginJsonBuf = updatePluginJson(repoRoot, meta);
    const pluginName = JSON.parse(pluginJsonBuf.toString('utf8')).name;
    desiredFiles.set('.cursor-plugin/plugin.json', pluginJsonBuf);
    desiredFiles.set('.cursor-plugin/marketplace.json', updateMarketplaceJson(repoRoot, meta, pluginName));

    const skillCount = countSkills(skillFiles.keys());
    desiredFiles.set('README.md', updateReadme(repoRoot, meta.version, skillCount));

    const upstreamState = {
      repository: options.repo,
      ref: options.ref,
      commit,
      version: meta.version,
    };
    desiredFiles.set('scripts/upstream.json', Buffer.from(`${JSON.stringify(upstreamState, null, 2)}\n`, 'utf8'));

    const existingSkills = collectFiles(join(repoRoot, 'skills'), repoRoot, new Map(), false);
    const toDelete = [];
    for (const rel of existingSkills.keys()) {
      if (!desiredFiles.has(rel)) {
        toDelete.push(rel);
      }
    }

    const toWrite = [];
    for (const [rel, desiredBuf] of desiredFiles) {
      const targetPath = join(repoRoot, rel);
      if (!existsSync(targetPath)) {
        toWrite.push({ rel, buf: desiredBuf, kind: 'add' });
      } else {
        const currentBuf = readFileSync(targetPath);
        if (Buffer.compare(currentBuf, desiredBuf) !== 0) {
          toWrite.push({ rel, buf: desiredBuf, kind: 'update' });
        }
      }
    }

    const shortSha = commit ? commit.slice(0, 7) : 'local';
    if (toWrite.length === 0 && toDelete.length === 0) {
      console.log(`Already up to date with upstream (${meta.version}@${shortSha}).`);
      return;
    }

    const added = toWrite.filter((item) => item.kind === 'add').length;
    const updated = toWrite.filter((item) => item.kind === 'update').length;
    const deleted = toDelete.length;

    if (options.dryRun) {
      console.log(
        `[dry-run] Would sync upstream (${meta.version}@${shortSha}): ${added} added, ${updated} updated, ${deleted} removed.`,
      );
      for (const item of toWrite) {
        console.log(`  ${item.kind === 'add' ? 'A' : 'M'} ${item.rel}`);
      }
      for (const rel of toDelete) {
        console.log(`  D ${rel}`);
      }
      return;
    }

    for (const rel of toDelete) {
      rmSync(join(repoRoot, rel), { force: true });
    }
    pruneEmptyDirs(join(repoRoot, 'skills'), join(repoRoot, 'skills'));

    for (const { rel, buf } of toWrite) {
      const targetPath = join(repoRoot, rel);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, buf);
    }

    console.log(
      `Synced upstream (${meta.version}@${shortSha}): ${added} added, ${updated} updated, ${deleted} removed.`,
    );
  } finally {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
