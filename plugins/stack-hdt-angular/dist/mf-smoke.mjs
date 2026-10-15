#!/usr/bin/env node

// harness/packs/hdt-angular/cli.ts
import { join as join10 } from "node:path";

// harness/src/config/config.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// harness/src/shared/filesystem.ts
import { createHash } from "node:crypto";
import { closeSync, existsSync as existsSync2, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync as statSync2, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";

// harness/src/shared/paths.ts
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
var CONFIG_FILE = join(".flow", "config.json");
var WORKTREES_DIRECTORY = ".worktrees";
function discoverRoot(starts = [process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
  for (const start of starts) {
    if (!start) continue;
    let current = resolve(start);
    for (; ; ) {
      if (existsSync(join(current, CONFIG_FILE))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}
var ROOT = resolve(process.cwd());
var ARTIFACTS_ROOT = join(ROOT, ".scratch");
var SCRATCH_ROOT = join(ARTIFACTS_ROOT, ".flow");
function useRoot(root, artifactsDir = ".scratch") {
  ROOT = resolve(root);
  ARTIFACTS_ROOT = resolve(ROOT, artifactsDir);
  SCRATCH_ROOT = join(ARTIFACTS_ROOT, ".flow");
}
var IGNORED_DIRECTORIES = /* @__PURE__ */ new Set([
  ".git",
  ".flow",
  ".nx",
  ".angular",
  ".scratch",
  WORKTREES_DIRECTORY,
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
  "temp"
]);
function normalizePath(path) {
  return path.replaceAll("\\", "/");
}
function logicalRelativePath(relativePath) {
  return normalizePath(relativePath).replace(/^\.worktrees\/[^/]+(?:\/|$)/, "");
}
function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || !path.startsWith("..") && !isAbsolute(path);
}

// harness/src/shared/filesystem.ts
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}
function writeFileAtomic(path, content) {
  const directory = dirname2(path);
  ensureDirectory(directory);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  try {
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch {
  }
}
function writeJsonAtomic(path, value) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}
`);
}
function removePath(path) {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
function fileHash(paths, seed = "") {
  const hash = createHash("sha256").update(seed);
  for (const path of [...new Set(paths)].sort()) {
    hash.update(normalizePath(path)).update("\0");
    if (!existsSync2(path) || statSync2(path).isDirectory()) {
      hash.update("<missing>\0");
      continue;
    }
    hash.update(readFileSync(path)).update("\0");
  }
  return hash.digest("hex");
}
function contentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

// harness/src/config/config.ts
var ADAPTERS = { nx: true, maven: true, gradle: true, npm: true };
var TOP_KEYS = /* @__PURE__ */ new Set(["$schema", "layout", "artifactsDir", "units", "verify", "codeFiles", "review", "policy", "context", "hooks"]);
var NotInitialisedError = class extends Error {
  constructor() {
    super("flow is not initialised here: no .flow/config.json in this directory or its parents. Run `flow init` first.");
  }
};
function strings(value, label) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${label} must be an array of strings`);
  return value;
}
function object(value, label) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function parseConfig(value) {
  const config = object(value, CONFIG_FILE);
  if (!config) throw new Error(`${CONFIG_FILE} must be an object`);
  const unknown = Object.keys(config).filter((key) => !TOP_KEYS.has(key));
  if (unknown.length) throw new Error(`${CONFIG_FILE} has unknown fields: ${unknown.join(", ")}`);
  if (config.layout !== "single" && config.layout !== "umbrella") throw new Error(`${CONFIG_FILE}: layout must be "single" or "umbrella"`);
  if (config.artifactsDir !== void 0 && (typeof config.artifactsDir !== "string" || !config.artifactsDir)) throw new Error(`${CONFIG_FILE}: artifactsDir must be a non-empty string`);
  const units = object(config.units, "units");
  const adapters = strings(units?.adapters, "units.adapters");
  if (!adapters?.length) throw new Error(`${CONFIG_FILE}: units.adapters must name at least one adapter`);
  for (const adapter of adapters) if (!(adapter in ADAPTERS)) throw new Error(`${CONFIG_FILE}: unknown adapter ${adapter}`);
  if (units?.packageManager !== void 0 && (typeof units.packageManager !== "string" || !units.packageManager)) throw new Error("units.packageManager must be a non-empty string");
  const verify = object(config.verify, "verify");
  strings(verify?.targets, "verify.targets");
  const custom = verify?.custom;
  const nonEmptyStrings = (value2) => Array.isArray(value2) && value2.length > 0 && value2.every((item) => typeof item === "string" && item);
  if (custom !== void 0 && !(Array.isArray(custom) && custom.every((step) => step && typeof step.name === "string" && step.name && nonEmptyStrings(step.files) && nonEmptyStrings(step.command)))) {
    throw new Error("verify.custom must be an array of { name, files: [glob, ...], command: [executable, ...args] }");
  }
  if (!(strings(config.codeFiles, "codeFiles") ?? []).every((extension) => /^\.[a-z0-9]+$/.test(extension))) throw new Error('codeFiles must list lower-case file extensions such as ".ts"');
  const review = object(config.review, "review");
  if (review?.broad !== void 0 && !(Array.isArray(review.broad) && review.broad.length === 2 && review.broad.every((item) => Number.isInteger(item) && item >= 0))) throw new Error("review.broad must be [lines, files]");
  if (review?.deep !== void 0 && !(Number.isInteger(review.deep) && Number(review.deep) >= 0)) throw new Error("review.deep must be a non-negative integer");
  const policy = object(config.policy, "policy");
  const blocked = policy?.blockedCommands;
  if (blocked !== void 0 && !(Array.isArray(blocked) && blocked.every((rule) => rule && typeof rule.pattern === "string" && typeof rule.message === "string"))) {
    throw new Error("policy.blockedCommands must be an array of { pattern, message }");
  }
  for (const rule of blocked ?? []) {
    try {
      new RegExp(rule.pattern);
    } catch {
      throw new Error(`policy.blockedCommands: invalid pattern ${rule.pattern}`);
    }
  }
  strings(policy?.unitRootOnly, "policy.unitRootOnly");
  for (const [cli, rule] of Object.entries(object(policy?.readOnlyCli, "policy.readOnlyCli") ?? {})) {
    const entry = object(rule, `policy.readOnlyCli.${cli}`);
    if (!strings(entry?.allow, `policy.readOnlyCli.${cli}.allow`)) throw new Error(`policy.readOnlyCli.${cli}.allow is required`);
    strings(entry?.valueOptions, `policy.readOnlyCli.${cli}.valueOptions`);
  }
  const context = object(config.context, "context");
  strings(context?.docs, "context.docs");
  strings(context?.conventions, "context.conventions");
  strings(object(config.hooks, "hooks")?.disabled, "hooks.disabled");
  return config;
}
function configPath(root = ROOT) {
  return join2(root, CONFIG_FILE);
}
function loadConfig(root = ROOT) {
  const path = configPath(root);
  if (!existsSync3(path)) throw new NotInitialisedError();
  let value;
  try {
    value = JSON.parse(readFileSync2(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseConfig(value);
}
function initRoot(starts) {
  const root = discoverRoot(starts);
  if (!root) return false;
  useRoot(root, loadConfig(root).artifactsDir);
  return true;
}

// harness/packs/hdt-angular/manifest-transaction.ts
import { closeSync as closeSync2, existsSync as existsSync4, openSync as openSync2, readFileSync as readFileSync3, readdirSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";
var transactionsRoot = () => join3(SCRATCH_ROOT, "transactions");
var locksRoot = () => join3(SCRATCH_ROOT, "locks");
var LOCK_TTL_MS = 8 * 60 * 60 * 1e3;
function processRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function lockPath(path) {
  return join3(locksRoot(), `${contentHash(resolve2(path)).slice(0, 20)}.lock`);
}
function acquireLock(path) {
  ensureDirectory(locksRoot());
  const target = lockPath(path);
  const owner = { pid: process.pid, acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), path: normalizePath(resolve2(path)) };
  const create = () => {
    const descriptor = openSync2(target, "wx");
    try {
      writeFileSync2(descriptor, `${JSON.stringify(owner)}
`, "utf8");
    } finally {
      closeSync2(descriptor);
    }
  };
  try {
    create();
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const current = readJson(target, {});
    const pid = Number(current.pid);
    const age = Date.now() - Date.parse(current.acquiredAt ?? "");
    const deadOwner = Number.isInteger(pid) && pid > 0 && !processRunning(pid);
    const staleUnknownOwner = (!Number.isInteger(pid) || pid <= 0) && Number.isFinite(age) && age > LOCK_TTL_MS;
    if (!deadOwner && !staleUnknownOwner) throw new Error(`Manifest transaction lock is held by PID ${current.pid ?? "unknown"} since ${current.acquiredAt ?? "unknown"}`);
    unlinkSync(target);
    create();
  }
  return () => {
    const current = readJson(target, {});
    if (Number(current.pid) === process.pid && existsSync4(target)) unlinkSync(target);
  };
}
function transactionPath(id) {
  return join3(transactionsRoot(), id);
}
function saveJournal(directory, journal) {
  journal.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  writeJsonAtomic(join3(directory, "transaction.json"), journal);
}
function restoreManifestContent(originalText, overrideText, currentText, key, overrideValue) {
  if (currentText === overrideText) return { status: "restored", content: originalText };
  try {
    const original = JSON.parse(originalText);
    const current = JSON.parse(currentText);
    if (current[key] !== overrideValue) return { status: "conflict", content: null };
    current[key] = original[key];
    return { status: "merged", content: `${JSON.stringify(current, null, 4)}
` };
  } catch {
    return { status: "conflict", content: null };
  }
}
function restoreTransactionLocked(directory, journal) {
  const originalText = readFileSync3(join3(directory, "before.manifest.json"), "utf8");
  const overrideText = readFileSync3(join3(directory, "after.manifest.json"), "utf8");
  const currentText = readFileSync3(journal.path, "utf8");
  const restoration = restoreManifestContent(originalText, overrideText, currentText, journal.key, journal.overrideValue);
  if (restoration.content === null) {
    journal.state = "conflict";
    journal.conflict = "The harness-owned manifest key changed after the transaction was applied.";
    saveJournal(directory, journal);
    return restoration;
  }
  writeFileAtomic(journal.path, restoration.content);
  journal.state = "restored";
  delete journal.conflict;
  saveJournal(directory, journal);
  return restoration;
}
function restoreTransaction(directory, journal) {
  const release = acquireLock(journal.path);
  try {
    return restoreTransactionLocked(directory, journal);
  } finally {
    release();
  }
}
function beginManifestTransaction(path, key, overrideValue) {
  const release = acquireLock(path);
  let lockHandedToTransaction = false;
  try {
    const beforeText = readFileSync3(path, "utf8");
    const manifest = JSON.parse(beforeText);
    if (!(key in manifest)) throw new Error(`Manifest key not found: ${key}`);
    const originalValue = manifest[key];
    manifest[key] = overrideValue;
    const afterText = `${JSON.stringify(manifest, null, 4)}
`;
    const id = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const directory = transactionPath(id);
    ensureDirectory(directory);
    writeFileAtomic(join3(directory, "before.manifest.json"), beforeText);
    writeFileAtomic(join3(directory, "after.manifest.json"), afterText);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const journal = {
      schemaVersion: 1,
      id,
      state: "prepared",
      path: normalizePath(resolve2(path)),
      key,
      originalValue,
      overrideValue,
      beforeHash: contentHash(beforeText),
      afterHash: contentHash(afterText),
      createdAt: now,
      updatedAt: now
    };
    saveJournal(directory, journal);
    const currentText = readFileSync3(path, "utf8");
    if (contentHash(currentText) !== journal.beforeHash) {
      journal.state = "conflict";
      journal.conflict = "Manifest changed between prepare and apply.";
      saveJournal(directory, journal);
      throw new Error(journal.conflict);
    }
    writeFileAtomic(path, afterText);
    if (contentHash(readFileSync3(path, "utf8")) !== journal.afterHash) {
      journal.state = "conflict";
      journal.conflict = "Applied manifest hash does not match the transaction journal.";
      saveJournal(directory, journal);
      throw new Error(journal.conflict);
    }
    journal.state = "applied";
    saveJournal(directory, journal);
    lockHandedToTransaction = true;
    let lockReleased = false;
    return {
      journal,
      restore: () => {
        if (journal.state === "restored") return { status: "restored", content: readFileSync3(join3(directory, "before.manifest.json"), "utf8") };
        if (lockReleased) return restoreTransaction(directory, journal);
        try {
          return restoreTransactionLocked(directory, journal);
        } finally {
          lockReleased = true;
          release();
        }
      }
    };
  } finally {
    if (!lockHandedToTransaction) release();
  }
}
function readJournal(directory, expectedId) {
  const path = join3(directory, "transaction.json");
  let value;
  try {
    value = JSON.parse(readFileSync3(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid manifest transaction journal ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid manifest transaction journal ${path}`);
  const journal = value;
  if (journal.schemaVersion !== 1 || typeof journal.id !== "string" || expectedId && journal.id !== expectedId || !["prepared", "applied", "restored", "conflict", "abandoned"].includes(journal.state ?? "") || typeof journal.path !== "string" || typeof journal.key !== "string" || typeof journal.beforeHash !== "string" || typeof journal.afterHash !== "string") {
    throw new Error(`Invalid manifest transaction journal ${path}`);
  }
  return journal;
}
function validateJournalArtifacts(directory, journal) {
  const before = readFileSync3(join3(directory, "before.manifest.json"), "utf8");
  const after = readFileSync3(join3(directory, "after.manifest.json"), "utf8");
  if (contentHash(before) !== journal.beforeHash || contentHash(after) !== journal.afterHash) {
    throw new Error(`Manifest transaction ${journal.id} artifact hashes do not match its journal`);
  }
}
function listManifestTransactions() {
  ensureDirectory(transactionsRoot());
  return readdirSync(transactionsRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => readJournal(join3(transactionsRoot(), entry.name), entry.name)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
function recoverManifestTransaction(id, expectedPath) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{5,127}$/.test(id)) throw new Error("Invalid transaction id");
  const directory = transactionPath(id);
  const journal = readJournal(directory, id);
  if (resolve2(expectedPath) !== resolve2(journal.path)) throw new Error(`Transaction ${id} targets an unexpected manifest path`);
  validateJournalArtifacts(directory, journal);
  if (journal.state === "restored" || journal.state === "abandoned") return { status: "restored", content: readFileSync3(join3(directory, "before.manifest.json"), "utf8") };
  if (!["prepared", "applied", "conflict"].includes(journal.state)) throw new Error(`Transaction ${id} is not recoverable from state ${journal.state}`);
  const release = acquireLock(journal.path);
  try {
    if (journal.state === "prepared") {
      const currentText = readFileSync3(journal.path, "utf8");
      if (contentHash(currentText) === journal.beforeHash) {
        journal.state = "abandoned";
        saveJournal(directory, journal);
        return { status: "restored", content: currentText };
      }
      journal.state = "applied";
      saveJournal(directory, journal);
    }
    return restoreTransactionLocked(directory, journal);
  } finally {
    release();
  }
}

// harness/packs/hdt-angular/smoke.ts
import { createWriteStream, existsSync as existsSync11, readFileSync as readFileSync7, writeFileSync as writeFileSync3 } from "node:fs";
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { join as join9, relative as relative4 } from "node:path";
import net2 from "node:net";

// harness/src/shared/process.ts
import { spawnSync } from "node:child_process";
import net from "node:net";
function executable(name) {
  if (process.platform !== "win32") return name;
  if (["npm", "npx", "pnpm", "yarn", "mvn"].includes(name)) return `${name}.cmd`;
  if (name === "gradle") return "gradle.bat";
  return name;
}
function run(command, args, options = {}) {
  const started = Date.now();
  const cwd = options.cwd ?? ROOT;
  const spawnOptions = { cwd, encoding: "utf8", env: { ...process.env, ...options.env }, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024, windowsHide: true };
  const result = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable(command)) ? spawnSync([executable(command), ...args].map((part) => /[\s"&|<>^]/.test(part) ? `"${part.replace(/"/g, '""')}"` : part).join(" "), { ...spawnOptions, shell: true }) : spawnSync(executable(command), args, spawnOptions);
  return {
    command: [command, ...args].join(" "),
    cwd,
    code: result.status ?? 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? (result.signal ? `Process terminated by signal ${result.signal}` : ""),
    durationMs: Date.now() - started
  };
}
function waitForPort(port, host = "127.0.0.1", timeoutMs = 12e4) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });
      socket.setTimeout(1e3);
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error(`Timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 500);
      };
      socket.once("error", retry);
      socket.once("timeout", retry);
    };
    attempt();
  });
}

// harness/src/topology/workspaces.ts
import { existsSync as existsSync10, readFileSync as readFileSync6, readdirSync as readdirSync3 } from "node:fs";
import { basename as basename4, dirname as dirname3, join as join8, relative as relative3, resolve as resolve6 } from "node:path";

// harness/src/units/gradle.ts
import { existsSync as existsSync6, readFileSync as readFileSync4 } from "node:fs";
import { basename, join as join4, resolve as resolve3 } from "node:path";

// harness/src/inspection/changes.ts
function affectsWholeWorkspace(change) {
  return /^(?:package(?:-lock)?\.json|nx\.json|tsconfig(?:\.base)?\.json|eslint\.config\.[cm]?js|jest\.config\.[cm]?ts|\.env(?:\..*)?|pom\.xml|(?:settings|build)\.gradle(?:\.kts)?|gradle\.properties|gradle\/libs\.versions\.toml)$/i.test(normalizePath(change.path));
}

// harness/src/units/dependents.ts
function unavailable(reason) {
  return { status: "unavailable", reason };
}
function transitiveConsumers(consumers, start) {
  const seen = /* @__PURE__ */ new Set([start]);
  const queue = [start];
  for (let name = queue.shift(); name !== void 0; name = queue.shift()) {
    for (const consumer of consumers.get(name) ?? []) {
      if (seen.has(consumer)) continue;
      seen.add(consumer);
      queue.push(consumer);
    }
  }
  seen.delete(start);
  return [...seen].sort();
}
function addConsumer(consumers, used, consumer) {
  consumers.set(used, [...consumers.get(used) ?? [], consumer]);
}

// harness/src/units/step.ts
import { existsSync as existsSync5 } from "node:fs";
function commandStep(workspace, project, target, command, changes, buildFiles2) {
  const id = `${workspace.relativeRoot}:${project ?? "all"}:${target}`;
  const files = [...changes.map((change) => change.absolutePath), ...buildFiles2.filter(existsSync5)];
  return { id, kind: "command", workspace: workspace.relativeRoot, project, target, command, cwd: workspace.root, fingerprint: fileHash(files, id) };
}

// harness/src/units/gradle.ts
var GOAL = "check";
var SETTINGS = ["settings.gradle.kts", "settings.gradle"];
function settingsFile(root) {
  return SETTINGS.map((name) => join4(root, name)).find(existsSync6) ?? null;
}
function unit(workspace, path) {
  const relativeRoot = path === ":" ? "." : path.slice(1).replaceAll(":", "/");
  const root = resolve3(workspace.root, relativeRoot);
  return { name: path === ":" ? basename(workspace.root) : path, root, relativeRoot, sourceRoot: null, projectType: null, targets: { [GOAL]: {} }, configPath: settingsFile(workspace.root) ?? join4(root, "build.gradle") };
}
function loadProjects(workspace) {
  const settings = settingsFile(workspace.root);
  const text = settings ? readFileSync4(settings, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "") : "";
  const paths = /* @__PURE__ */ new Set();
  for (const statement of text.matchAll(/\binclude\b\s*\(?((?:\s*["'][^"']+["']\s*,?)+)/g)) {
    for (const name of statement[1].matchAll(/["']([^"']+)["']/g)) paths.add(name[1].startsWith(":") ? name[1] : `:${name[1]}`);
  }
  if (!paths.size) return [unit(workspace, ":")];
  return [...paths].map((path) => unit(workspace, path)).sort((left, right) => left.name.localeCompare(right.name));
}
function gradle(workspace) {
  if (process.platform === "win32") return existsSync6(join4(workspace.root, "gradlew.bat")) ? "gradlew.bat" : "gradle";
  return existsSync6(join4(workspace.root, "gradlew")) ? "./gradlew" : "gradle";
}
function buildFiles(workspace, projects) {
  return [...SETTINGS, "build.gradle.kts", "build.gradle", "gradle.properties"].map((name) => join4(workspace.root, name)).concat(projects.flatMap((project) => [join4(project.root, "build.gradle.kts"), join4(project.root, "build.gradle")]));
}
function verifyPlan(group) {
  const projects = loadProjects(group.workspace);
  const owners = [...new Set(group.changes.map((change) => resolveProject(change.absolutePath, projects)).filter((project) => project !== null))];
  if (group.changes.some(affectsWholeWorkspace) || owners.some((project) => project.relativeRoot === ".")) {
    return {
      affectedProjects: [{ workspace: group.workspace.relativeRoot, project: "*" }],
      steps: [commandStep(group.workspace, null, GOAL, [gradle(group.workspace), GOAL], group.changes, buildFiles(group.workspace, projects))]
    };
  }
  if (!owners.length) return { affectedProjects: [], steps: [] };
  const tasks = owners.map((project) => `${project.name}:${GOAL}`).sort();
  return {
    affectedProjects: owners.map((project) => ({ workspace: group.workspace.relativeRoot, project: project.name })),
    // One Gradle invocation, so the daemon configures the build once.
    steps: [commandStep(group.workspace, owners.map((project) => project.name).sort().join(","), GOAL, [gradle(group.workspace), ...tasks], group.changes, buildFiles(group.workspace, owners))]
  };
}
var gradleAdapter = {
  name: "gradle",
  codeFiles: [".java", ".kt", ".kts", ".xml"],
  detect: (directory) => [...SETTINGS, "build.gradle.kts", "build.gradle"].some((name) => existsSync6(join4(directory, name))),
  loadUnits: loadProjects,
  verifyPlan,
  unitPlan: (workspace, project) => [commandStep(workspace, project.name, GOAL, [gradle(workspace), project.relativeRoot === "." ? GOAL : `${project.name}:${GOAL}`], [], buildFiles(workspace, [project]))],
  dependents: () => unavailable("Gradle project dependencies are declared in build scripts and are not read")
};

// harness/src/units/maven.ts
import { existsSync as existsSync7, readFileSync as readFileSync5 } from "node:fs";
import { basename as basename2, join as join5, resolve as resolve4 } from "node:path";
var GOAL2 = "verify";
function unit2(workspace, relativeRoot) {
  const root = resolve4(workspace.root, relativeRoot);
  return { name: relativeRoot === "." ? basename2(workspace.root) : relativeRoot, root, relativeRoot, sourceRoot: null, projectType: null, targets: { [GOAL2]: {} }, configPath: join5(root, "pom.xml") };
}
function loadModules(workspace) {
  const pom = readFileSync5(join5(workspace.root, "pom.xml"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const modules = [...new Set([...pom.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map((match) => normalizePath(match[1]).replace(/\/$/, "")))];
  if (!modules.length) return [unit2(workspace, ".")];
  return modules.filter((module) => existsSync7(join5(workspace.root, module, "pom.xml"))).map((module) => unit2(workspace, module)).sort((left, right) => left.name.localeCompare(right.name));
}
function maven(workspace) {
  if (process.platform === "win32") return existsSync7(join5(workspace.root, "mvnw.cmd")) ? "mvnw.cmd" : "mvn";
  return existsSync7(join5(workspace.root, "mvnw")) ? "./mvnw" : "mvn";
}
function verifyPlan2(group) {
  const modules = loadModules(group.workspace);
  const buildFiles2 = modules.map((module) => module.configPath).concat(join5(group.workspace.root, "pom.xml"));
  const owners = [...new Set(group.changes.map((change) => resolveProject(change.absolutePath, modules)).filter((module) => module !== null))];
  if (group.changes.some(affectsWholeWorkspace) || owners.some((module) => module.relativeRoot === ".")) {
    return {
      affectedProjects: [{ workspace: group.workspace.relativeRoot, project: "*" }],
      steps: [commandStep(group.workspace, null, GOAL2, [maven(group.workspace), "-q", GOAL2], group.changes, buildFiles2)]
    };
  }
  if (!owners.length) return { affectedProjects: [], steps: [] };
  const list = owners.map((module) => module.relativeRoot).sort().join(",");
  return {
    affectedProjects: owners.map((module) => ({ workspace: group.workspace.relativeRoot, project: module.name })),
    // One reactor run: -am builds what the changed modules need once instead of once per module.
    steps: [commandStep(group.workspace, list, GOAL2, [maven(group.workspace), "-q", "-pl", list, "-am", GOAL2], group.changes, buildFiles2)]
  };
}
function tag(text, name) {
  return new RegExp(`<${name}>s*([^<]+?)s*</${name}>`).exec(text)?.[1];
}
function coordinates(module) {
  const pom = readFileSync5(module.configPath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const parentGroup = tag(/<parent>[\s\S]*?<\/parent>/.exec(pom)?.[0] ?? "", "groupId");
  const body = pom.replace(/<(parent|dependencyManagement|build)>[\s\S]*?<\/\1>/g, "");
  const head = body.split("<dependencies>")[0];
  const groupId = tag(head, "groupId") ?? parentGroup;
  const dependsOn = [...body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].flatMap(([, dependency]) => {
    const group = tag(dependency, "groupId")?.replace(/^\$\{(?:project|pom)\.groupId\}$/, groupId ?? "");
    const artifact = tag(dependency, "artifactId");
    return group && artifact ? [`${group}:${artifact}`] : [];
  });
  return { key: `${groupId}:${tag(head, "artifactId")}`, dependsOn };
}
function dependents(workspace, unit3) {
  const modules = loadModules(workspace).map((module) => ({ name: module.name, ...coordinates(module) }));
  const nameOf = new Map(modules.map((module) => [module.key, module.name]));
  const consumers = /* @__PURE__ */ new Map();
  for (const module of modules) {
    for (const used of module.dependsOn) {
      const usedName = nameOf.get(used);
      if (usedName) addConsumer(consumers, usedName, module.name);
    }
  }
  return { status: "ok", units: transitiveConsumers(consumers, unit3.name), workspaces: [], notes: [] };
}
var mavenAdapter = {
  name: "maven",
  codeFiles: [".java", ".kt", ".kts", ".xml"],
  detect: (directory) => existsSync7(join5(directory, "pom.xml")),
  loadUnits: loadModules,
  verifyPlan: verifyPlan2,
  unitPlan: (workspace, module) => [commandStep(workspace, module.name, GOAL2, module.relativeRoot === "." ? [maven(workspace), "-q", GOAL2] : [maven(workspace), "-q", "-pl", module.relativeRoot, "-am", GOAL2], [], [module.configPath, join5(workspace.root, "pom.xml")])],
  dependents
};

// harness/src/units/npm.ts
import { existsSync as existsSync8 } from "node:fs";
import { basename as basename3, join as join6 } from "node:path";
var LOCKFILES = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]];
function packageManager(root) {
  const configured = loadConfig().units.packageManager;
  if (configured) return configured;
  const declared = readJson(join6(root, "package.json"), {}).packageManager;
  if (typeof declared === "string" && declared) return declared.split("@")[0];
  return LOCKFILES.find(([file]) => existsSync8(join6(root, file)))?.[1] ?? "npm";
}
function loadUnits(workspace) {
  const { name, scripts = {} } = readJson(join6(workspace.root, "package.json"), {});
  return [{
    name: name ?? basename3(workspace.root),
    root: workspace.root,
    relativeRoot: ".",
    sourceRoot: null,
    projectType: null,
    targets: Object.fromEntries(Object.keys(scripts).map((script) => [script, {}])),
    configPath: join6(workspace.root, "package.json")
  }];
}
function steps(workspace, targets, changes) {
  const manager = packageManager(workspace.root);
  const buildFiles2 = [join6(workspace.root, "package.json"), ...LOCKFILES.map(([file]) => join6(workspace.root, file))];
  return targets.filter((target) => workspace.scripts[target] !== void 0).map((target) => commandStep(workspace, workspace.name, target, [manager, "run", target], changes, buildFiles2));
}
function verifyPlan3(group, targets) {
  return { affectedProjects: [{ workspace: group.workspace.relativeRoot, project: group.workspace.name }], steps: steps(group.workspace, targets, group.changes) };
}
var npmAdapter = {
  name: "npm",
  codeFiles: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".html", ".scss", ".css", ".json", ".jsonc", ".yaml", ".yml"],
  detect: (directory) => existsSync8(join6(directory, "package.json")),
  loadUnits,
  verifyPlan: verifyPlan3,
  unitPlan: (workspace, _unit, targets) => steps(workspace, targets, []),
  dependents: () => unavailable("an npm package is one unit; the packages that use it live outside the project")
};

// harness/src/units/nx.ts
import { existsSync as existsSync9, readdirSync as readdirSync2 } from "node:fs";
import { join as join7, relative as relative2, resolve as resolve5 } from "node:path";
function loadProjects2(workspace) {
  const projects = [];
  const visit = (directory) => {
    for (const entry of readdirSync2(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(join7(directory, entry.name));
        continue;
      }
      if (entry.name !== "project.json") continue;
      const configPath2 = join7(directory, entry.name);
      const raw = parseJsonObject(configPath2, "Nx project.json");
      const config = raw;
      if (typeof config.name !== "string" || !config.name) throw new Error(`Invalid Nx project.json ${normalizePath(configPath2)}: name is required`);
      for (const field of ["root", "sourceRoot", "projectType"]) {
        if (config[field] !== void 0 && typeof config[field] !== "string") throw new Error(`Invalid Nx project.json ${normalizePath(configPath2)}: ${field} must be a string`);
      }
      if (config.targets !== void 0 && (!config.targets || typeof config.targets !== "object" || Array.isArray(config.targets))) {
        throw new Error(`Invalid Nx project.json ${normalizePath(configPath2)}: targets must be an object`);
      }
      const projectRoot = resolve5(workspace.root, config.root ?? relative2(workspace.root, directory));
      projects.push({
        name: config.name,
        root: projectRoot,
        relativeRoot: normalizePath(relative2(workspace.root, projectRoot)),
        sourceRoot: config.sourceRoot ?? null,
        projectType: config.projectType ?? null,
        targets: config.targets ?? {},
        configPath: configPath2
      });
    }
  };
  visit(workspace.root);
  return projects.sort((left, right) => left.name.localeCompare(right.name));
}
function addStep(steps2, step) {
  if (!steps2.some((existing) => existing.id === step.id)) steps2.push(step);
}
function targetStep(workspace, project, target, changes) {
  const id = `${workspace.relativeRoot}:${project.name}:${target}`;
  const relevantFiles = [...changes.map((change) => change.absolutePath), ...[project.configPath, join7(workspace.root, "package.json"), join7(workspace.root, "nx.json")].filter(existsSync9)];
  return { id, kind: "command", workspace: workspace.relativeRoot, project: project.name, target, command: ["npx", "nx", "run", `${project.name}:${target}`], cwd: workspace.root, fingerprint: fileHash(relevantFiles, id) };
}
function runManyStep(group, target) {
  const id = `${group.workspace.relativeRoot}:all:${target}`;
  const relevantFiles = [...group.changes.map((change) => change.absolutePath), ...[join7(group.workspace.root, "package.json"), join7(group.workspace.root, "nx.json")].filter(existsSync9)];
  return { id, kind: "command", workspace: group.workspace.relativeRoot, project: null, target, command: ["npx", "nx", "run-many", "--target", target, "--all"], cwd: group.workspace.root, fingerprint: fileHash(relevantFiles, id) };
}
function queryAffectedProjects(group, ownerNames) {
  const cli = join7(group.workspace.root, "node_modules", "nx", "bin", "nx.js");
  const result = run("node", [cli, "show", "projects", "--affected", "--base=HEAD"], { cwd: group.workspace.root });
  if (result.code !== 0) return { names: [], error: result.stderr.trim() || result.stdout.trim() || "Nx affected query failed" };
  const names = new Set(ownerNames);
  for (const name of result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) names.add(name);
  return { names: [...names], error: null };
}
function verifyPlan4(group, targets) {
  const steps2 = [];
  const affectedProjects = [];
  const projects = loadProjects2(group.workspace);
  const byProject = /* @__PURE__ */ new Map();
  const workspaceChanges = [];
  for (const change of group.changes) {
    const project = resolveProject(change.absolutePath, projects);
    if (!project) workspaceChanges.push(change);
    else byProject.set(project.name, [...byProject.get(project.name) ?? [], change]);
  }
  if (workspaceChanges.some(affectsWholeWorkspace)) {
    affectedProjects.push({ workspace: group.workspace.relativeRoot, project: "*" });
    const availableTargets = new Set(projects.flatMap((project) => Object.keys(project.targets)));
    for (const target of targets) if (availableTargets.has(target)) addStep(steps2, runManyStep(group, target));
    return { affectedProjects, steps: steps2 };
  }
  const affected = group.scopeToOwners ? { names: [...byProject.keys()], error: null } : queryAffectedProjects(group, byProject.keys());
  if (affected.error) {
    addStep(steps2, { id: `${group.workspace.relativeRoot}:affected-discovery`, kind: "configuration-error", workspace: group.workspace.relativeRoot, project: null, message: affected.error });
    return { affectedProjects, steps: steps2 };
  }
  for (const projectName of affected.names) {
    const project = projects.find((candidate) => candidate.name === projectName);
    if (!project) continue;
    affectedProjects.push({ workspace: group.workspace.relativeRoot, project: projectName });
    for (const target of targets) if (project.targets[target]) addStep(steps2, targetStep(group.workspace, project, target, group.changes));
  }
  return { affectedProjects, steps: steps2 };
}
var GRAPH_FILES = [join7(".nx", "cache", "project-graph.json"), join7(".nx", "workspace-data", "project-graph.json")];
var DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];
function packageName(project) {
  return readJson(join7(project.root, "package.json"), {}).name;
}
function cachedGraph(workspace) {
  const path = GRAPH_FILES.map((file) => join7(workspace.root, file)).find(existsSync9);
  return path ? readJson(path, null) : null;
}
function dependentProjects(graph, name) {
  const consumers = /* @__PURE__ */ new Map();
  for (const [source, edges] of Object.entries(graph.dependencies ?? {})) {
    for (const { target } of edges) if (graph.nodes?.[source] && graph.nodes[target]) addConsumer(consumers, target, source);
  }
  return transitiveConsumers(consumers, name);
}
function consumingWorkspaces(workspace, packages) {
  const found = [];
  for (const other of discoverWorkspaces()) {
    if (other.relativeRoot === workspace.relativeRoot) continue;
    const manifest = readJson(join7(other.root, "package.json"), {});
    const spec = DEPENDENCY_SECTIONS.flatMap((section) => [...packages].map((name) => manifest[section]?.[name])).find((value) => typeof value === "string");
    if (spec) found.push({ workspace: other.relativeRoot, spec });
  }
  return found;
}
function dependents2(workspace, project) {
  const graph = cachedGraph(workspace);
  const units = graph ? dependentProjects(graph, project.name) : [];
  const involved = loadProjects2(workspace).filter((candidate) => candidate.name === project.name || units.includes(candidate.name));
  const packages = new Set(involved.flatMap((candidate) => packageName(candidate) ?? []));
  return {
    status: "ok",
    units,
    workspaces: consumingWorkspaces(workspace, packages),
    notes: graph ? [] : [`no cached Nx project graph in ${workspace.relativeRoot} (${normalizePath(GRAPH_FILES[0])}); dependents inside the workspace are unknown, run an nx command there to create it`]
  };
}
var nxAdapter = {
  name: "nx",
  codeFiles: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".scss", ".css", ".json", ".jsonc", ".yaml", ".yml"],
  detect: (directory) => existsSync9(join7(directory, "package.json")) && existsSync9(join7(directory, "nx.json")),
  loadUnits: loadProjects2,
  verifyPlan: verifyPlan4,
  unitPlan: (workspace, project, targets) => targets.filter((target) => project.targets[target]).map((target) => targetStep(workspace, project, target, [])),
  dependents: dependents2
};

// harness/src/units/adapter.ts
var ADAPTERS2 = { nx: nxAdapter, maven: mavenAdapter, gradle: gradleAdapter, npm: npmAdapter };
var UNIT_ADAPTERS = Object.values(ADAPTERS2);
function unitAdapter(name) {
  return ADAPTERS2[name];
}

// harness/src/topology/workspaces.ts
function parseJsonObject(path, label) {
  let value;
  try {
    value = JSON.parse(readFileSync6(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} ${normalizePath(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label} ${normalizePath(path)}: expected an object`);
  return value;
}
function detectAdapter(directory) {
  return loadConfig().units.adapters.map(unitAdapter).find((adapter) => adapter.detect(directory)) ?? null;
}
function loadWorkspace(root, adapter = detectAdapter(root)) {
  if (!adapter) throw new Error(`No configured unit adapter recognises ${normalizePath(root)}`);
  const path = join8(root, "package.json");
  const packageJson = existsSync10(path) ? parseJsonObject(path, "workspace package.json") : {};
  if (packageJson.name !== void 0 && typeof packageJson.name !== "string") throw new Error(`Invalid workspace package.json ${normalizePath(path)}: name must be a string`);
  if (packageJson.scripts !== void 0 && (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts) || !Object.values(packageJson.scripts).every((script) => typeof script === "string"))) {
    throw new Error(`Invalid workspace package.json ${normalizePath(path)}: scripts must map names to strings`);
  }
  return {
    name: packageJson.name ?? basename4(root),
    root,
    relativeRoot: logicalRelativePath(relative3(ROOT, root)) || ".",
    adapter: adapter.name,
    scripts: packageJson.scripts ?? {}
  };
}
function discoverWorkspaces(root = ROOT) {
  if (loadConfig().layout === "single") {
    const adapter = detectAdapter(root);
    return adapter ? [loadWorkspace(root, adapter)] : [];
  }
  const found = [];
  const visit = (directory) => {
    const adapter = directory === root ? null : detectAdapter(directory);
    if (adapter) {
      found.push(loadWorkspace(directory, adapter));
      return;
    }
    for (const entry of readdirSync3(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      visit(join8(directory, entry.name));
    }
  };
  visit(root);
  return found.sort((left, right) => left.relativeRoot.localeCompare(right.relativeRoot));
}
function loadProjects3(workspace) {
  return unitAdapter(workspace.adapter).loadUnits(workspace);
}
function resolveProject(input, projects) {
  const target = resolve6(input);
  return projects.filter((project) => isWithin(project.root, target)).sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}

// harness/packs/hdt-angular/smoke.ts
var BROWSERS = [
  process.env.MF_SMOKE_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter((path) => Boolean(path));
var MANIFEST_PATH = join9("src", "assets", "module-federation.manifest.json");
function targetPort(project, targetName = "serve") {
  const target = project.targets[targetName];
  const value = target?.options?.port ?? target?.configurations?.development?.port;
  return Number.isInteger(value) ? Number(value) : null;
}
function findHost(hostWorkspaceName, hostProjectName) {
  const workspace = discoverWorkspaces().find((candidate) => candidate.relativeRoot === hostWorkspaceName || candidate.name === hostWorkspaceName);
  if (!workspace) throw new Error(`Smoke host workspace not found: ${hostWorkspaceName}`);
  const projects = loadProjects3(workspace).filter((candidate) => hostProjectName ? candidate.name === hostProjectName : existsSync11(join9(candidate.root, MANIFEST_PATH)));
  if (projects.length !== 1 || !projects[0]) {
    throw new Error(hostProjectName ? `Smoke host project not found: ${hostWorkspaceName}:${hostProjectName}` : `${hostWorkspaceName} has ${projects.length} projects with ${normalizePath(MANIFEST_PATH)}; pass --host-project`);
  }
  return { workspace, project: projects[0] };
}
function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolvePromise) => {
    const socket = net2.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    const closed = () => {
      socket.destroy();
      resolvePromise(false);
    };
    socket.once("error", closed);
    socket.once("timeout", closed);
  });
}
function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net2.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Could not allocate an isolated host port"));
      else server.close(() => resolvePromise(address.port));
    });
  });
}
function findRemote(name) {
  const matches = [];
  for (const workspace of discoverWorkspaces()) for (const project of loadProjects3(workspace)) if (project.name === name && project.targets.serve) matches.push({ workspace, project });
  if (matches.length !== 1) throw new Error(matches.length ? `Remote name is ambiguous: ${name}` : `Serve target not found: ${name}`);
  const match = matches[0];
  if (!match) throw new Error(`Serve target not found: ${name}`);
  return match;
}
function startLogged(command, args, cwd, logPath) {
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end();
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("exit", () => log.end());
  return child;
}
function waitForProcessPort(child, port, timeoutMs) {
  return Promise.race([
    waitForPort(port, "127.0.0.1", timeoutMs),
    new Promise((_, reject) => {
      child.once("exit", (code) => reject(new Error(`Process exited before port ${port} became ready (exit ${code})`)));
      child.once("error", reject);
    })
  ]);
}
function stopOwned(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync2("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
  else child.kill("SIGTERM");
}
function selectManifestKey(manifest, remote, explicit) {
  if (explicit) {
    if (!(explicit in manifest)) throw new Error(`Manifest key not found: ${explicit}`);
    return explicit;
  }
  if (remote in manifest) return remote;
  const byRoute = Object.entries(manifest).filter(([, route]) => route === `/${remote}`);
  if (byRoute.length === 1 && byRoute[0]) return byRoute[0][0];
  throw new Error(`Cannot infer manifest key for ${remote}; pass --manifest-key`);
}
function inferShellRoute(remote, hostProjectRoot) {
  const source = readFileSync7(join9(hostProjectRoot, "src", "app", "app.routes.ts"), "utf8");
  const singleQuote = source.indexOf(`loadRemoteModule('${remote}'`);
  const doubleQuote = source.indexOf(`loadRemoteModule("${remote}"`);
  const remoteIndex = singleQuote >= 0 ? singleQuote : doubleQuote;
  if (remoteIndex < 0) return null;
  const paths = [...source.slice(Math.max(0, remoteIndex - 1200), remoteIndex).matchAll(/\bpath\s*:\s*['"]([^'"]+)['"]/g)];
  const path = paths.at(-1)?.[1];
  return path ? `/${path}` : null;
}
var delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
async function waitForFile(path, timeoutMs = 2e4) {
  const started = Date.now();
  while (!existsSync11(path)) {
    if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for ${path}`);
    await delay(100);
  }
}
async function waitForManifest(port, key, expected, timeoutMs = 3e4) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/assets/module-federation.manifest.json`, { cache: "no-store" });
      const current = response.ok ? await response.json() : null;
      if (current?.[key] === expected) return;
    } catch {
    }
    await delay(250);
  }
  throw new Error(`Host did not publish the temporary manifest override for ${key}`);
}
function createCdpClient(url) {
  const socket = new WebSocket(url);
  const pending = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Map();
  const events = [];
  let requestId = 0;
  const opened = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", () => resolvePromise(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools connection failed")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) events.push(message);
    if (message.id) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler?.reject(new Error(message.error.message));
      else handler?.resolve(message.result ?? {});
      return;
    }
    const handlers = listeners.get(message.method ?? "") ?? [];
    listeners.delete(message.method ?? "");
    handlers.forEach((handler) => handler(message.params ?? {}));
  });
  return {
    events,
    async request(method, params = {}) {
      await opened;
      const id = ++requestId;
      const response = new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for Chrome DevTools response to ${method}`));
        }, 3e4);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolvePromise(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    waitFor(method, timeoutMs = 3e4) {
      return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
        listeners.set(method, [...listeners.get(method) ?? [], (params) => {
          clearTimeout(timeout);
          resolvePromise(params);
        }]);
      });
    },
    close() {
      socket.close();
    }
  };
}
async function captureRoute(browser, rootUrl, route, remoteEntry, artifactDirectory, ownedProcesses) {
  if (!browser) throw new Error("Chrome or Edge is required for browser smoke proof");
  const profile = join9(artifactDirectory, "browser-profile");
  ensureDirectory(profile);
  const browserProcess = startLogged(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], ROOT, join9(artifactDirectory, "browser.log"));
  ownedProcesses.add(browserProcess);
  try {
    const portFile = join9(profile, "DevToolsActivePort");
    await waitForFile(portFile);
    const port = readFileSync7(portFile, "utf8").split(/\r?\n/)[0];
    if (!port) throw new Error("Browser did not publish a debugging port");
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Cannot create browser target: HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    const client = createCdpClient(target.webSocketDebuggerUrl);
    try {
      await client.request("Page.enable");
      await client.request("Runtime.enable");
      await client.request("Network.enable");
      await client.request("Network.setCacheDisabled", { cacheDisabled: true });
      let loaded = client.waitFor("Page.loadEventFired");
      await client.request("Page.navigate", { url: new URL("/assets/module-federation.manifest.json", rootUrl).href });
      await loaded;
      const contractUrl = `${remoteEntry}${remoteEntry.includes("?") ? "&" : "?"}mf-contract=${Date.now()}`;
      const remoteContract = await client.request("Runtime.evaluate", { expression: `(async () => { const container = await import(${JSON.stringify(contractUrl)}); return typeof (await container.get('./Routes')); })()`, awaitPromise: true, returnByValue: true });
      if (remoteContract.exceptionDetails || remoteContract.result?.value !== "function") {
        throw new Error(`Browser could not resolve ./Routes from ${remoteEntry}: ${JSON.stringify(remoteContract.exceptionDetails ?? remoteContract.result ?? {})}`);
      }
      const routeEventStart = client.events.length;
      const requestedUrl = new URL(route, rootUrl).href;
      loaded = client.waitFor("Page.loadEventFired");
      await client.request("Page.navigate", { url: requestedUrl });
      await loaded;
      await delay(12e3);
      const state = await client.request("Runtime.evaluate", { expression: `({ title: document.title, path: location.pathname, text: document.body?.innerText?.slice(0, 2000) ?? '', htmlLength: document.body?.innerHTML?.length ?? 0 })`, returnByValue: true });
      const value = state.result?.value ?? {};
      const screenshot = await client.request("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const screenshotPath = join9(artifactDirectory, "page.png");
      writeFileSync3(screenshotPath, Buffer.from(String(screenshot.data ?? ""), "base64"));
      if (!value.htmlLength) throw new Error(`Browser rendered an empty document for ${route}`);
      const routeEvents = client.events.slice(routeEventStart);
      const shellLoadedRemote = routeEvents.some((event) => event.method === "Network.responseReceived" && event.params?.response?.url === remoteEntry && event.params.response.status >= 200 && event.params.response.status < 400);
      const routeMatched = value.path === route;
      return { screenshotPath, page: value, proof: [
        { phase: "remote-contract-resolved", status: "passed", evidence: "Browser resolved the remote ./Routes factory through a cache-distinct import." },
        { phase: "shell-route-navigation", status: shellLoadedRemote && routeMatched ? "passed" : "unavailable", evidence: shellLoadedRemote && routeMatched ? `A full-page request to ${route} caused the shell to load ${remoteEntry}.` : `The browser reached ${value.path || "<unknown>"}, but no shell-owned remote entry request proved route mounting.` },
        { phase: "authenticated-feature-render", status: "unavailable", evidence: "No authenticated session or feature-specific rendered selector was supplied." }
      ] };
    } finally {
      client.close();
    }
  } finally {
    stopOwned(browserProcess);
    ownedProcesses.delete(browserProcess);
    await delay(500);
    try {
      removePath(profile);
    } catch {
    }
  }
}
async function runSmoke(remoteName, options) {
  const { workspace, project } = findRemote(remoteName);
  const remotePort = targetPort(project);
  if (!remotePort) throw new Error(`Serve port is missing for ${workspace.relativeRoot}:${project.name}`);
  const { workspace: hostWorkspace, project: hostProject } = findHost(options.host, options.hostProject);
  const manifestPath = join9(hostProject.root, MANIFEST_PATH);
  if (!existsSync11(manifestPath)) throw new Error(`Smoke host manifest not found: ${normalizePath(relative4(ROOT, manifestPath))}`);
  const configuredHostPort = targetPort(hostProject) ?? 4200;
  const configuredHostBusy = await portOpen(configuredHostPort);
  const hostPort = configuredHostBusy ? await freePort() : configuredHostPort;
  const proof = [];
  const diagnostics = [];
  const manifest = JSON.parse(readFileSync7(manifestPath, "utf8"));
  const manifestKey = selectManifestKey(manifest, project.name, options.manifestKey);
  const originalRoute = manifest[manifestKey];
  if (typeof originalRoute !== "string") throw new Error(`Manifest value for ${manifestKey} must be a string`);
  const inferredRoute = inferShellRoute(project.name, hostProject.root);
  const selectedRoute = options.route ?? inferredRoute ?? (originalRoute.startsWith("/") ? originalRoute : `/${manifestKey}`);
  let route = selectedRoute.startsWith("/") ? selectedRoute : `/${selectedRoute}`;
  let remoteEntry = `http://localhost:${remotePort}/remoteEntry.mjs`;
  const base = {
    schemaVersion: 2,
    status: options.dryRun ? "planned" : "running",
    remote: { workspace: workspace.relativeRoot, project: project.name, port: remotePort },
    host: { workspace: hostWorkspace.relativeRoot, project: hostProject.name, port: hostPort },
    manifest: { key: manifestKey, original: originalRoute, override: remoteEntry },
    url: `http://127.0.0.1:${hostPort}${route}`,
    proof
  };
  if (options.dryRun) return base;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const artifactDirectory = join9(SCRATCH_ROOT, "smoke", `${stamp}-${project.name}`);
  ensureDirectory(artifactDirectory);
  const ownedProcesses = /* @__PURE__ */ new Set();
  let transaction = null;
  let remoteProcess;
  let hostProcess;
  let cleaned = false;
  let cleanupFailed = false;
  let result;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (transaction) {
        const restoration = transaction.restore();
        if (restoration.status === "merged") diagnostics.push({ level: "warning", message: "Manifest changed during smoke; restored only the harness-owned remote key." });
        if (restoration.status === "conflict") {
          cleanupFailed = true;
          diagnostics.push({ level: "error", message: `Manifest restore conflicted; transaction ${transaction.journal.id} was retained for recovery.` });
        }
      }
    } catch (error) {
      cleanupFailed = true;
      diagnostics.push({ level: "error", message: `Manifest cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      for (const child of ownedProcesses) stopOwned(child);
      ownedProcesses.clear();
    }
  };
  const terminate = (code) => {
    cleanup();
    process.exit(code);
  };
  const onSigint = () => terminate(130);
  const onSigterm = () => terminate(143);
  try {
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const remoteReused = await portOpen(remotePort);
    if (!remoteReused) {
      remoteProcess = startLogged(process.execPath, [join9(workspace.root, "node_modules", "nx", "bin", "nx.js"), "serve", project.name, "--host", "127.0.0.1"], workspace.root, join9(artifactDirectory, "remote.log"));
      ownedProcesses.add(remoteProcess);
      await waitForProcessPort(remoteProcess, remotePort, 12e4);
    }
    proof.push({ phase: "remote-process-ready", status: "passed", evidence: remoteReused ? `Reused the process listening on ${remotePort}.` : `Started the remote and observed port ${remotePort}.` });
    let remoteSource = "";
    for (const candidate of [`http://localhost:${remotePort}/remoteEntry.mjs`, `http://localhost:${remotePort}/remoteEntry.js`]) {
      const response2 = await fetch(candidate);
      if (!response2.ok) continue;
      remoteEntry = candidate;
      remoteSource = await response2.text();
      break;
    }
    if (!remoteSource) throw new Error(`Remote entry was not served on port ${remotePort}`);
    if (!remoteSource.includes("./Routes")) throw new Error(`Remote entry does not expose ./Routes: ${remoteEntry}`);
    proof.push({ phase: "remote-entry-served", status: "passed", evidence: `${remoteEntry} returned a successful response and declared ./Routes.` });
    const currentManifest = JSON.parse(readFileSync7(manifestPath, "utf8"));
    const currentKey = selectManifestKey(currentManifest, project.name, options.manifestKey);
    const currentOriginalRoute = currentManifest[currentKey];
    if (typeof currentOriginalRoute !== "string") throw new Error(`Manifest value for ${currentKey} must be a string`);
    if (!options.route && !inferredRoute) {
      route = currentOriginalRoute.startsWith("/") ? currentOriginalRoute : `/${currentKey}`;
      base.url = `http://127.0.0.1:${hostPort}${route.startsWith("/") ? route : `/${route}`}`;
    }
    base.manifest = { key: currentKey, original: currentOriginalRoute, override: remoteEntry };
    transaction = beginManifestTransaction(manifestPath, currentKey, remoteEntry);
    base.transaction = transaction.journal.id;
    hostProcess = startLogged(
      process.execPath,
      [join9(hostWorkspace.root, "node_modules", "nx", "bin", "nx.js"), "serve", hostProject.name, "--host", "127.0.0.1", "--port", String(hostPort)],
      hostWorkspace.root,
      join9(artifactDirectory, "host.log")
    );
    ownedProcesses.add(hostProcess);
    await waitForProcessPort(hostProcess, hostPort, 18e4);
    proof.push({ phase: "shell-process-ready", status: "passed", evidence: `Observed the shell on port ${hostPort}.` });
    const rootUrl = `http://127.0.0.1:${hostPort}/`;
    const response = await fetch(rootUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`Shell root returned HTTP ${response.status}: ${rootUrl}`);
    await waitForManifest(hostPort, currentKey, remoteEntry);
    proof.push({ phase: "shell-manifest-observed", status: "passed", evidence: `The served manifest mapped ${currentKey} to ${remoteEntry}.` });
    const capture = await captureRoute(BROWSERS.find(existsSync11), rootUrl, route, remoteEntry, artifactDirectory, ownedProcesses);
    proof.push(...capture.proof);
    diagnostics.push({ level: "info", message: `Rendered ${capture.page.path} (${capture.page.title || "untitled"})` });
    diagnostics.push({ level: "info", message: remoteReused ? `Reused process on remote port ${remotePort}` : "Started and stopped an owned remote process" });
    diagnostics.push({ level: "info", message: configuredHostBusy ? `Started an isolated host because port ${configuredHostPort} was already active` : "Started and stopped an owned host process" });
    result = { ...base, status: proof.some((item) => item.status === "unavailable") ? "partial" : "passed", screenshot: normalizePath(relative4(ROOT, capture.screenshotPath)), artifacts: normalizePath(relative4(ROOT, artifactDirectory)), diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    proof.push({ phase: "smoke-run", status: "failed", evidence: message });
    diagnostics.push({ level: "error", message });
    result = { ...base, status: "failed", diagnostics };
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    cleanup();
  }
  if (cleanupFailed) {
    proof.push({ phase: "manifest-restoration", status: "failed", evidence: "The host manifest could not be restored safely; inspect the retained transaction before continuing." });
    result.status = "failed";
  }
  return result;
}

// harness/packs/hdt-angular/cli.ts
var USAGE = `Usage:
  mf-smoke <remote-project> --host <workspace> [--host-project <project>] [--route <path>] [--manifest-key <key>] [--dry-run] [--json]
  mf-smoke transactions [--json]
  mf-smoke recover <transaction-id> --host <workspace> [--host-project <project>]`;
var VALUE_OPTIONS = /* @__PURE__ */ new Set(["--host", "--host-project", "--route", "--manifest-key"]);
var BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["--dry-run", "--json"]);
function parse(argv) {
  const positional = [];
  const values = /* @__PURE__ */ new Map();
  const flags = /* @__PURE__ */ new Set();
  for (let index = 0; index < argv.length; index++) {
    const part = argv[index] ?? "";
    if (BOOLEAN_OPTIONS.has(part)) flags.add(part);
    else if (VALUE_OPTIONS.has(part)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${part} needs a value`);
      values.set(part, value);
    } else if (part.startsWith("--")) throw new Error(`Unknown option ${part}`);
    else positional.push(part);
  }
  return { positional, values, flags };
}
function requireHost(values) {
  const host = values.get("--host");
  if (!host) throw new Error("--host <workspace> is required: name the workspace of the shell that loads the remote");
  return host;
}
async function main() {
  const { positional, values, flags } = parse(process.argv.slice(2));
  const json = flags.has("--json");
  const [first, second] = positional;
  if (!first || positional.length > 2) {
    console.error(USAGE);
    return 2;
  }
  if (!initRoot()) throw new Error("flow is not initialised here: no .flow/config.json in this directory or its parents. Run `flow init` first.");
  if (first === "transactions") {
    const journals = listManifestTransactions();
    if (json) console.log(JSON.stringify(journals, null, 2));
    else for (const journal of journals) console.log(`${journal.id}  ${journal.state}  ${normalizePath(journal.path)}`);
    return 0;
  }
  if (first === "recover") {
    if (!second) throw new Error("recover needs a transaction id");
    const { project } = findHost(requireHost(values), values.get("--host-project"));
    const restoration = recoverManifestTransaction(second, join10(project.root, MANIFEST_PATH));
    console.log(json ? JSON.stringify(restoration, null, 2) : `Transaction ${second}: ${restoration.status}`);
    return restoration.status === "conflict" ? 1 : 0;
  }
  const result = await runSmoke(first, {
    host: requireHost(values),
    hostProject: values.get("--host-project") ?? null,
    route: values.get("--route") ?? null,
    manifestKey: values.get("--manifest-key") ?? null,
    dryRun: flags.has("--dry-run")
  });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`mf-smoke ${result.status.toUpperCase()}: ${result.remote.workspace}:${result.remote.project} in ${result.host.workspace}:${result.host.project}`);
    console.log(`  url ${result.url}`);
    console.log(`  manifest ${result.manifest.key}: ${result.manifest.original} -> ${result.manifest.override}`);
    for (const item of result.proof) console.log(`  ${item.status.padEnd(11)} ${item.phase}: ${item.evidence}`);
    for (const item of result.diagnostics ?? []) console.log(`  ${item.level} ${item.message}`);
    if (result.screenshot) console.log(`  screenshot ${result.screenshot}`);
  }
  return result.status === "failed" ? 1 : 0;
}
main().then((code) => {
  process.exitCode = code;
}, (error) => {
  console.error(`mf-smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
