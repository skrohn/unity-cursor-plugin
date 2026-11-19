#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INDEX_SKILL = 'using-unity';
const MIN_README_WORDS = 40;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const realRepoRoot = realpathSync(repoRoot);

function loadJsYaml() {
  const require = createRequire(import.meta.url);
  const searchDirs = [];

  if (process.env.NODE_PATH) {
    for (const dir of process.env.NODE_PATH.split(delimiter)) {
      if (dir) searchDirs.push(resolve(dir));
    }
  }
  searchDirs.push(join(repoRoot, 'node_modules'));

  for (const dir of searchDirs) {
    const candidate = join(dir, 'js-yaml');
    if (existsSync(candidate)) {
      return require(candidate);
    }
  }

  try {
    return require('js-yaml');
  } catch {
    console.error(
      'Missing dependency: js-yaml. Install it in a temporary directory and set NODE_PATH, e.g.:',
    );
    console.error(
      '  npm install --prefix /tmp/validator --no-save --no-audit --no-fund js-yaml@4 && NODE_PATH=/tmp/validator/node_modules node scripts/validate.mjs',
    );
    process.exit(1);
  }
}

const yaml = loadJsYaml();
const failures = [];
let checkedSkills = 0;

function isInsideRepo(absPath) {
  return absPath === realRepoRoot || absPath.startsWith(`${realRepoRoot}/`);
}

function hasPathTraversal(relPath) {
  const normalized = relPath.replaceAll('\\', '/');
  return (
    isAbsolute(relPath) ||
    normalized.split('/').includes('..')
  );
}

function checkRepoPath(relPath, label, expectedType) {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    failures.push(`${label}: missing or empty path`);
    return null;
  }
  if (hasPathTraversal(relPath)) {
    failures.push(`${label}: path "${relPath}" must stay within repository without ".." traversal`);
    return null;
  }

  const resolved = resolve(repoRoot, relPath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}/`)) {
    failures.push(`${label}: path "${relPath}" resolves outside repository`);
    return null;
  }

  if (!existsSync(resolved)) {
    failures.push(`${label}: referenced path "${relPath}" does not exist`);
    return null;
  }

  const lstat = lstatSync(resolved);
  if (lstat.isSymbolicLink()) {
    const real = realpathSync(resolved);
    if (!isInsideRepo(real)) {
      failures.push(`${label}: symlink "${relPath}" resolves outside repository (${real})`);
      return null;
    }
  }

  const real = realpathSync(resolved);
  if (!isInsideRepo(real)) {
    failures.push(`${label}: path "${relPath}" resolves outside repository (${real})`);
    return null;
  }

  const stat = statSync(resolved);
  if (expectedType === 'dir' && !stat.isDirectory()) {
    failures.push(`${label}: expected directory at "${relPath}"`);
    return null;
  }
  if (expectedType === 'file' && !stat.isFile()) {
    failures.push(`${label}: expected file at "${relPath}"`);
    return null;
  }

  return resolved;
}

function checkNoExternalSymlinks(dirPath) {
  if (!existsSync(dirPath)) return;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    const lstat = lstatSync(fullPath);
    if (lstat.isSymbolicLink()) {
      const real = realpathSync(fullPath);
      if (!isInsideRepo(real)) {
        failures.push(`${fullPath}: external symlink resolves outside repository (${real})`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      checkNoExternalSymlinks(fullPath);
    }
  }
}

function readJsonFile(relPath) {
  const fullPath = join(repoRoot, relPath);
  if (!existsSync(fullPath)) {
    failures.push(`${relPath}: missing`);
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      failures.push(`${relPath}: top-level JSON value must be an object`);
      return null;
    }
    return parsed;
  } catch (error) {
    failures.push(`${relPath}: invalid JSON (${error.message})`);
    return null;
  }
}

function validatePluginJson() {
  const relPath = '.cursor-plugin/plugin.json';
  const plugin = readJsonFile(relPath);
  if (!plugin) return null;

  if (typeof plugin.name !== 'string' || !PLUGIN_NAME_RE.test(plugin.name)) {
    failures.push(`${relPath}: name "${plugin.name}" must match ${PLUGIN_NAME_RE}`);
  }
  if (typeof plugin.version !== 'string' || plugin.version.trim() === '') {
    failures.push(`${relPath}: missing or empty version`);
  }

  checkRepoPath(plugin.skills, `${relPath} skills`, 'dir');
  checkRepoPath(plugin.logo, `${relPath} logo`, 'file');

  return plugin;
}

function validateMarketplaceJson(plugin) {
  const relPath = '.cursor-plugin/marketplace.json';
  const marketplace = readJsonFile(relPath);
  if (!marketplace) return;

  if (typeof marketplace.name !== 'string' || !KEBAB_CASE_RE.test(marketplace.name)) {
    failures.push(`${relPath}: name "${marketplace.name}" must be kebab-case (${KEBAB_CASE_RE})`);
  }

  if (
    typeof marketplace.owner !== 'object' ||
    marketplace.owner === null ||
    typeof marketplace.owner.name !== 'string' ||
    marketplace.owner.name.trim() === ''
  ) {
    failures.push(`${relPath}: owner.name must be a non-empty string`);
  }

  const metaVersion = marketplace.metadata?.version;
  if (typeof metaVersion !== 'string' || metaVersion.trim() === '') {
    failures.push(`${relPath}: metadata.version must be a non-empty string`);
  } else if (plugin && typeof plugin.version === 'string' && plugin.version !== metaVersion) {
    failures.push(
      `${relPath}: metadata.version "${metaVersion}" does not match .cursor-plugin/plugin.json version "${plugin.version}"`,
    );
  }

  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    failures.push(`${relPath}: plugins must be a non-empty array`);
    return;
  }

  const entry = plugin
    ? marketplace.plugins.find((item) => item && item.name === plugin.name)
    : marketplace.plugins[0];

  if (!entry) {
    failures.push(`${relPath}: no plugin entry with name "${plugin?.name}"`);
    return;
  }

  if (plugin && entry.name !== plugin.name) {
    failures.push(`${relPath}: plugin entry name "${entry.name}" does not match "${plugin.name}"`);
  }

  if (entry.version !== undefined && entry.version !== metaVersion) {
    failures.push(`${relPath}: plugin entry version "${entry.version}" does not match metadata.version "${metaVersion}"`);
  }

  if (entry.source !== undefined) {
    checkRepoPath(entry.source, `${relPath} plugins[].source`, 'dir');
  }
  if (entry.logo !== undefined) {
    checkRepoPath(entry.logo, `${relPath} plugins[].logo`, 'file');
  }
}

function validateReadme() {
  const relPath = 'README.md';
  const fullPath = join(repoRoot, relPath);
  if (!existsSync(fullPath)) {
    failures.push(`${relPath}: missing at repo root`);
    return;
  }
  const words = readFileSync(fullPath, 'utf8')
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word)).length;
  if (words < MIN_README_WORDS) {
    failures.push(`${relPath}: has ${words} words, expected at least ${MIN_README_WORDS}`);
  }
}

function listDirs(dirPath) {
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function checkSkillFile(fullPath, expectedName) {
  if (!existsSync(fullPath)) {
    failures.push(`${fullPath}: missing`);
    return '';
  }

  const text = readFileSync(fullPath, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    failures.push(`${fullPath}: missing YAML frontmatter block`);
    return text;
  }

  let data;
  try {
    data = yaml.load(match[1]);
  } catch (error) {
    failures.push(`${fullPath}: invalid YAML frontmatter (${error.message.split('\n')[0]})`);
    return text;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    failures.push(`${fullPath}: frontmatter must be a YAML mapping`);
    return text;
  }

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    failures.push(`${fullPath}: missing or empty frontmatter name`);
  } else if (data.name !== expectedName) {
    failures.push(`${fullPath}: frontmatter name "${data.name}" does not match folder "${expectedName}"`);
  }

  if (typeof data.description !== 'string' || data.description.trim() === '') {
    failures.push(`${fullPath}: missing or empty frontmatter description`);
  } else if (/[<>]/.test(data.description)) {
    failures.push(`${fullPath}: description contains "<" or ">"`);
  }

  checkedSkills += 1;
  return text;
}

function validateSkills(skillsRelPath) {
  const skillsDir = checkRepoPath(skillsRelPath ?? 'skills', 'skills directory', 'dir');
  if (!skillsDir) return;

  checkNoExternalSymlinks(skillsDir);
  checkNoExternalSymlinks(join(repoRoot, 'assets'));

  const topDirs = listDirs(skillsDir);
  if (!topDirs.includes(INDEX_SKILL)) {
    failures.push(`${skillsDir}: missing required index folder "${INDEX_SKILL}"`);
    return;
  }

  for (const dirName of topDirs) {
    if (dirName !== INDEX_SKILL) {
      failures.push(`${join(skillsDir, dirName)}: unexpected top-level folder in skills/ (only "${INDEX_SKILL}" is allowed)`);
    }
  }

  const indexPath = join(skillsDir, INDEX_SKILL, 'SKILL.md');
  const indexText = checkSkillFile(indexPath, INDEX_SKILL);

  const referencesDir = join(skillsDir, INDEX_SKILL, 'references');
  if (!existsSync(referencesDir) || !statSync(referencesDir).isDirectory()) {
    failures.push(`${referencesDir}: missing`);
    return;
  }

  const referenceSkills = listDirs(referencesDir);
  if (referenceSkills.length === 0) {
    failures.push(`${referencesDir}: no skills found`);
    return;
  }

  for (const name of referenceSkills) {
    checkSkillFile(join(referencesDir, name, `${name}.md`), name);
  }

  const listed = new Map();
  for (const line of indexText.split(/\r?\n/)) {
    const entry = line.match(/^- \*\*([^*]+)\*\*: .* File: `([^`]+)`$/);
    if (entry) {
      if (listed.has(entry[1])) {
        failures.push(`${indexPath}: duplicate index entry for "${entry[1]}"`);
      }
      listed.set(entry[1], entry[2]);
    }
  }

  for (const name of referenceSkills) {
    const expectedRef = `references/${name}/${name}.md`;
    if (!listed.has(name)) {
      failures.push(`${indexPath}: missing index entry for "${name}"`);
    } else if (listed.get(name) !== expectedRef) {
      failures.push(`${indexPath}: entry "${name}" points to "${listed.get(name)}", expected "${expectedRef}"`);
    }
  }

  for (const name of listed.keys()) {
    if (!referenceSkills.includes(name)) {
      failures.push(`${indexPath}: lists "${name}" which does not exist in ${referencesDir}`);
    }
  }
}

const plugin = validatePluginJson();
validateMarketplaceJson(plugin);
validateReadme();
validateSkills(plugin?.skills);

if (failures.length > 0) {
  console.error(`Validation failed with ${failures.length} error(s):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`Validation passed: plugin manifests OK, README.md OK, ${checkedSkills} skill(s) OK.`);
