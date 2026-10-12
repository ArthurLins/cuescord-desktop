import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pureModules = new Set([
  'electron/security/policy.cjs',
  'electron/voice/protocol.cjs',
  'electron/capture/quality.cjs',
  'electron/capture/selection.cjs',
  'electron/audio/capabilities.cjs',
  'electron/audio/grant.cjs',
  'electron/update/policy.cjs',
  'electron/update/selection.cjs',
  'electron/window/presence-policy.cjs',
  'renderer/push-to-talk-binding.cjs',
]);
const publicContextModules = new Set([
  'electron/security/policy.cjs',
  'electron/audio/capabilities.cjs',
]);
const applicationModules = new Set(['electron/update/updater.cjs']);

function imports(source) {
  return Array.from(
    source.matchAll(
      /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g,
    ),
    (match) => match[1],
  );
}

function resolveLocal(file, dependency, sources) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), dependency));
  return [target, `${target}.ts`, `${target}.js`, `${target}.cjs`, `${target}.mjs`].find((name) =>
    sources.has(name),
  );
}

// Inspect literal imports and CommonJS requires used by this repository. Runtime
// non-literal requires are rejected so an indirect loader cannot evade a boundary.
export function architectureViolations(sources) {
  const issues = [];
  const graph = new Map();
  for (const [file, source] of sources) {
    const dependencies = imports(source);
    const browser = file.startsWith('renderer/') || file.startsWith('customizations/');
    const context = file.startsWith('electron/') ? file.split('/')[1] : undefined;
    const localDependencies = [];
    for (const dependency of dependencies) {
      const target = dependency.startsWith('.')
        ? resolveLocal(file, dependency, sources)
        : undefined;
      if (dependency.startsWith('.') && !target)
        issues.push(`${file}: unresolved source dependency ${dependency}`);
      if (target) localDependencies.push(target);
      if (
        browser &&
        (!target || (!target.startsWith('renderer/') && !target.startsWith('customizations/')))
      )
        issues.push(`${file}: browser code cannot import ${dependency}`);
      if (
        pureModules.has(file) &&
        (target ? !pureModules.has(target) : dependency !== 'node:crypto')
      )
        issues.push(`${file}: pure policy cannot import ${dependency}`);
      if (
        applicationModules.has(file) &&
        (target ? !pureModules.has(target) : dependency !== 'node:events')
      )
        issues.push(
          `${file}: application service must receive adapter ${dependency} through a port`,
        );
      if (context && file !== 'electron/main.cjs' && target?.startsWith('electron/')) {
        const targetContext = target.split('/')[1];
        if (context !== targetContext && !publicContextModules.has(target))
          issues.push(`${file}: ${targetContext} context internals are private (${dependency})`);
      }
      if (file.startsWith('electron/') && target && /^(scripts|tests)\//.test(target))
        issues.push(`${file}: production code cannot import build/test code ${dependency}`);
    }
    if (
      pureModules.has(file) &&
      /\b(?:process\s*\.|(?:fetch|setInterval|setTimeout)\s*\()/.test(source)
    )
      issues.push(`${file}: pure policy cannot inspect the host or schedule work`);
    if (
      file.startsWith('electron/') &&
      Array.from(source.matchAll(/\brequire\s*\(([^)]*)/g)).some(
        (match) => !/^\s*['"]/.test(match[1]),
      )
    )
      issues.push(`${file}: runtime require must have an explicit literal dependency`);
    graph.set(file, localDependencies);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(file) {
    if (visiting.has(file)) {
      issues.push(`${file}: cyclic source dependency`);
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of graph.get(file) || []) visit(dependency);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return issues;
}

export async function checkArchitecture(root) {
  const sources = new Map();
  for (const directory of ['electron', 'renderer', 'customizations']) {
    for (const file of await readdir(path.join(root, directory), { recursive: true })) {
      if (!/\.(?:cjs|js|ts|json)$/.test(file)) continue;
      const relative = `${directory}/${file.replaceAll('\\', '/')}`;
      sources.set(relative, await readFile(path.join(root, relative), 'utf8'));
    }
  }
  const issues = architectureViolations(sources);
  for (const file of ['native/updater/src/plan.rs', 'native/voice/src/protocol.rs']) {
    const source = await readFile(path.join(root, file), 'utf8');
    if (/\b(?:fs::|std::fs|std::process|std::env|extern\s+"|\.exists\s*\()/.test(source))
      issues.push(`${file}: native policy must not perform filesystem/process/FFI operations`);
  }
  if (issues.length) throw new Error(`Desktop architecture violations:\n${issues.join('\n')}`);
  return sources.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(`Fronteiras do desktop verificadas em ${await checkArchitecture(root)} arquivos.`);
}
