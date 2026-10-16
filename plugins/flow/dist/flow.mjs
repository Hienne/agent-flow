#!/usr/bin/env node

// harness/src/cli.ts
import { readFileSync as readFileSync15 } from "node:fs";
import { relative as relative9, resolve as resolve15 } from "node:path";

// harness/src/artifacts/artifacts.ts
import { existsSync as existsSync2, readFileSync, readdirSync, statSync as statSync2 } from "node:fs";
import { basename, relative as relative2, resolve as resolve2 } from "node:path";

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
function relativeToRoot(path) {
  return normalizePath(relative(ROOT, path));
}
function resolveInput(path = ".") {
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}
function nearestExistingPath(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}
function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || !path.startsWith("..") && !isAbsolute(path);
}
function existingDirectory(path) {
  const existing = nearestExistingPath(path);
  if (!existing) return null;
  return statSync(existing).isDirectory() ? existing : dirname(existing);
}
function slugify(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

// harness/src/artifacts/artifacts.ts
var ARTIFACTS = { decisions: true, spec: true, "architecture-candidate": true, "ticket-index": true, ticket: true, worklog: true };
var STATUSES = { draft: true, validated: true, ready: true, blocked: true, done: true };
var READINESS = { observed: true, validated: true, "investigation-only": true, "ready-for-spec": true, "ready-for-implementation": true, rejected: true };
var HANDOFFS = { "ready-for-spec": true, "ready-for-implementation": true, "blocked-by-decision": true };
var READY_SPEC_SECTIONS = ["Problem", "Desired behaviour", "Observable acceptance criteria", "Contracts and state transitions", "Verification seams", "Constraints", "Out of scope", "Open decisions"];
var TICKET_SECTIONS = ["What to build", "Source acceptance criteria", "Contract affected", "Risk", "Suggested verification", "Blocked by", "Acceptance criteria"];
var READY_CANDIDATE_SECTIONS = ["Evidence from current code", "Observed maintenance or change pressure", "Why the current interface is shallow", "Proposed seam", "Counter-evidence", "Feasibility check", "Migration shape", "Verification seam", "Design scorecard", "Readiness and confidence"];
function markdownFiles(path) {
  if (!existsSync2(path)) throw new Error(`Path does not exist: ${path}`);
  if (!statSync2(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve2(path, entry.name);
    if (entry.isDirectory()) return markdownFiles(child);
    return entry.isFile() && entry.name.endsWith(".md") ? [child] : [];
  });
}
function expectedArtifact(file, root) {
  const path = normalizePath(relative2(root, file));
  if (path === "decisions.md") return "decisions";
  if (path === "spec.md") return "spec";
  if (path === "worklog.md") return "worklog";
  if (/^architecture\/candidate-\d+\.md$/.test(path)) return "architecture-candidate";
  if (path === "issues/index.md") return "ticket-index";
  if (/^issues\/\d+-[^/]+\.md$/.test(path)) return "ticket";
  return null;
}
function parseArtifact(file) {
  const text = readFileSync(file, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match?.[1]) return { file, text, metadata: null, body: text };
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return { file, text, metadata, body: text.slice(match[0].length) };
}
function section(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}\\s*$`, "im").exec(body);
  if (!match) return null;
  const remainder = body.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^## /m);
  return remainder.slice(0, nextHeading < 0 ? void 0 : nextHeading).trim();
}
function ticketNumber(file) {
  return basename(file).match(/^(\d+)-/)?.[1] ?? null;
}
function blockerNumbers(artifact) {
  const value = section(artifact.body, "Blocked by");
  if (!value || /^(none|không|n\/a)\b/i.test(value)) return [];
  return [...new Set(value.match(/\b\d{2,}\b/g) ?? [])];
}
function identifiers(value, prefix) {
  return [...(value ?? "").matchAll(new RegExp(`\\b${prefix}-\\d{3}\\b`, "g"))].map((match) => match[0]);
}
function headingIdentifiers(value, prefix) {
  return [...value.matchAll(new RegExp(`^##\\s+(${prefix}-\\d{3})\\b`, "gm"))].map((match) => match[1]).filter((id) => Boolean(id));
}
function featureRoot(input) {
  const absolute = resolve2(input);
  if (statSync2(absolute).isDirectory()) return absolute;
  const parent = resolve2(absolute, "..");
  return ["issues", "architecture"].includes(basename(parent)) ? resolve2(parent, "..") : parent;
}
function localSource(source) {
  return Boolean(source && source !== "conversation" && !/^[a-z]+:\/\//i.test(source) && !/^issue:/i.test(source));
}
function resolveSource(root, source) {
  const fromFeature = resolve2(root, source);
  if (existsSync2(fromFeature)) return fromFeature;
  const fromUmbrella = resolve2(ROOT, source);
  return existsSync2(fromUmbrella) ? fromUmbrella : fromFeature;
}
function add(findings, severity, file, message) {
  findings.push({ severity, file, message });
}
function validateRequiredSections(item, path, headings, findings) {
  for (const heading of headings) {
    const value = section(item.body, heading);
    if (value === null) add(findings, "error", path, `Missing section: ${heading}`);
    else if (!value) add(findings, "error", path, `Empty section: ${heading}`);
  }
}
function validateTicketGraph(tickets, findings, root) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const reported = /* @__PURE__ */ new Set();
  const visit = (number, trail = []) => {
    if (visiting.has(number)) {
      const cycle = [...trail.slice(trail.indexOf(number)), number].join(" -> ");
      if (!reported.has(cycle)) {
        reported.add(cycle);
        const ticket2 = tickets.get(number);
        if (ticket2) add(findings, "error", normalizePath(relative2(root, ticket2.file)), `Ticket dependency cycle: ${cycle}`);
      }
      return;
    }
    if (visited.has(number)) return;
    const ticket = tickets.get(number);
    if (!ticket) return;
    visiting.add(number);
    for (const blocker of blockerNumbers(ticket)) if (tickets.has(blocker)) visit(blocker, [...trail, number]);
    visiting.delete(number);
    visited.add(number);
  };
  for (const number of tickets.keys()) visit(number);
}
function validateArtifacts(root, artifacts) {
  const findings = [];
  const recognized = artifacts.filter((item) => expectedArtifact(item.file, root));
  if (!recognized.length) return [{ severity: "error", file: normalizePath(root), message: "No workflow artifacts found" }];
  const byFile = new Map(recognized.map((item) => [resolve2(item.file), item]));
  const tickets = /* @__PURE__ */ new Map();
  for (const item of recognized.filter((candidate) => expectedArtifact(candidate.file, root) === "ticket")) {
    const number = ticketNumber(item.file);
    if (!number) continue;
    if (tickets.has(number)) add(findings, "error", normalizePath(relative2(root, item.file)), `Duplicate ticket number: ${number}`);
    tickets.set(number, item);
  }
  for (const item of recognized) {
    const path = normalizePath(relative2(root, item.file));
    const expected = expectedArtifact(item.file, root);
    if (!item.metadata) {
      add(findings, "error", path, "Missing YAML frontmatter");
      continue;
    }
    const metadata = item.metadata;
    for (const field of ["artifact", "status", "workspace", "project", "source", "revision"]) {
      if (!metadata[field]) add(findings, "error", path, `Missing metadata field: ${field}`);
    }
    if (metadata.artifact && !ARTIFACTS[metadata.artifact]) add(findings, "error", path, `Unknown artifact type: ${metadata.artifact}`);
    if (metadata.artifact && metadata.artifact !== expected) add(findings, "error", path, `Expected artifact type ${expected}, found ${metadata.artifact}`);
    if (metadata.status && !STATUSES[metadata.status]) add(findings, "error", path, `Unknown status: ${metadata.status}`);
    if (metadata.revision && !/^[1-9]\d*$/.test(metadata.revision)) add(findings, "error", path, "revision must be a positive integer");
    let sourceArtifact = null;
    if (localSource(metadata.source)) {
      const sourcePath = resolveSource(root, metadata.source);
      if (!existsSync2(sourcePath)) add(findings, "error", path, `Source artifact not found: ${metadata.source}`);
      else {
        sourceArtifact = byFile.get(resolve2(sourcePath)) ?? parseArtifact(sourcePath);
        if (!/^[1-9]\d*$/.test(metadata.source_revision ?? "")) add(findings, "error", path, "Local artifact source requires source_revision");
        else if (sourceArtifact.metadata?.revision !== metadata.source_revision) add(findings, "error", path, `Source revision mismatch: expected ${sourceArtifact.metadata?.revision ?? "<missing>"}, found ${metadata.source_revision}`);
      }
    }
    if (expected === "decisions") {
      if (!metadata.handoff || !HANDOFFS[metadata.handoff]) add(findings, "error", path, `Invalid decisions handoff: ${metadata.handoff ?? "<missing>"}`);
      if (["ready-for-spec", "ready-for-implementation"].includes(metadata.handoff ?? "") && metadata.status !== "validated") add(findings, "error", path, `${metadata.handoff} requires status: validated`);
      if (metadata.handoff === "blocked-by-decision" && metadata.status !== "blocked") add(findings, "error", path, "blocked-by-decision requires status: blocked");
      const decisionIds = headingIdentifiers(item.body, "DEC");
      if (!decisionIds.length) add(findings, "error", path, "Decisions artifact requires at least one DEC-### identifier");
      if (new Set(decisionIds).size !== decisionIds.length) add(findings, "error", path, "Decision identifiers must be unique");
    }
    if (expected === "architecture-candidate") {
      if (!metadata.readiness || !READINESS[metadata.readiness]) add(findings, "error", path, `Invalid architecture readiness: ${metadata.readiness ?? "<missing>"}`);
      const requiredStatus = ["observed", "investigation-only"].includes(metadata.readiness ?? "") ? "draft" : ["validated", "ready-for-spec", "ready-for-implementation"].includes(metadata.readiness ?? "") ? "validated" : metadata.readiness === "rejected" ? "done" : null;
      if (["ready-for-spec", "ready-for-implementation"].includes(metadata.readiness ?? "")) validateRequiredSections(item, path, READY_CANDIDATE_SECTIONS, findings);
      if (requiredStatus && metadata.status !== requiredStatus) add(findings, "error", path, `${metadata.readiness} requires status: ${requiredStatus}`);
    }
    if (expected === "spec" && metadata.status === "ready") {
      validateRequiredSections(item, path, READY_SPEC_SECTIONS, findings);
      const openDecisions = section(item.body, "Open decisions");
      if (openDecisions !== null && !/^(none|không|n\/a)[.!]?$/i.test(openDecisions)) add(findings, "error", path, "A ready spec cannot contain unresolved open decisions");
      const criteria = identifiers(section(item.body, "Observable acceptance criteria"), "AC");
      if (!criteria.length) add(findings, "error", path, "Ready spec requires at least one AC-### identifier");
      if (new Set(criteria).size !== criteria.length) add(findings, "error", path, "Acceptance-criterion identifiers must be unique");
      if (sourceArtifact?.metadata?.artifact === "decisions" && sourceArtifact.metadata.handoff !== "ready-for-spec") add(findings, "error", path, `Ready spec requires decisions handoff ready-for-spec, found ${sourceArtifact.metadata.handoff ?? "<missing>"}`);
      if (sourceArtifact?.metadata?.artifact === "architecture-candidate" && sourceArtifact.metadata.readiness !== "ready-for-spec") add(findings, "error", path, `Ready spec requires architecture readiness ready-for-spec, found ${sourceArtifact.metadata.readiness ?? "<missing>"}`);
    }
    if ((expected === "ticket" || expected === "ticket-index") && metadata.status === "ready") {
      if (sourceArtifact?.metadata?.artifact !== "spec") add(findings, "error", path, `Ready ${expected} requires a local source spec`);
      else if (sourceArtifact.metadata.status !== "ready") add(findings, "error", path, `Ready ${expected} requires a ready source spec`);
    }
    if (expected === "ticket") {
      validateRequiredSections(item, path, TICKET_SECTIONS, findings);
      const blockers = blockerNumbers(item);
      const missing = blockers.filter((number) => !tickets.has(number));
      const incomplete = blockers.filter((number) => tickets.get(number)?.metadata?.status !== "done");
      if (missing.length) add(findings, "error", path, `Unknown blocker ticket(s): ${missing.join(", ")}`);
      if (metadata.status === "ready" && incomplete.length) add(findings, "error", path, `Ready ticket has incomplete blocker(s): ${incomplete.join(", ")}`);
      if (metadata.status === "blocked" && blockers.length && !incomplete.length) add(findings, "warning", path, "All ticket blockers are done; consider status: ready");
      const sourceCriteria = identifiers(section(item.body, "Source acceptance criteria"), "AC");
      if (!sourceCriteria.length) add(findings, "error", path, "Ticket requires at least one source AC-### identifier");
      if (sourceArtifact?.metadata?.artifact === "spec") {
        const available = new Set(identifiers(section(sourceArtifact.body, "Observable acceptance criteria"), "AC"));
        const unknown = sourceCriteria.filter((id) => !available.has(id));
        if (unknown.length) add(findings, "error", path, `Unknown source acceptance criteria: ${[...new Set(unknown)].join(", ")}`);
      }
    }
  }
  validateTicketGraph(tickets, findings, root);
  return findings;
}
function load(input) {
  const root = featureRoot(input);
  return { root, artifacts: markdownFiles(root).map(parseArtifact) };
}
function checkArtifacts(input) {
  const { root, artifacts } = load(input);
  const findings = validateArtifacts(root, artifacts);
  return { schemaVersion: 1, status: findings.some((finding) => finding.severity === "error") ? "failed" : "passed", root: normalizePath(root), findings };
}
function artifactFrontier(input) {
  const { root, artifacts } = load(input);
  const findings = validateArtifacts(root, artifacts);
  if (findings.some((finding) => finding.severity === "error")) return { schemaVersion: 1, status: "failed", root: normalizePath(root), findings, frontier: [] };
  const tickets = artifacts.filter((item) => expectedArtifact(item.file, root) === "ticket" && item.metadata).sort((left, right) => left.file.localeCompare(right.file));
  const byNumber = new Map(tickets.map((item) => [ticketNumber(item.file), item]));
  const frontier = tickets.filter((item) => item.metadata?.status === "ready").filter((item) => blockerNumbers(item).every((number) => byNumber.get(number)?.metadata?.status === "done")).map((item) => ({
    id: ticketNumber(item.file) ?? "",
    file: normalizePath(relative2(root, item.file)),
    title: item.body.match(/^#\s+(?:\d+:\s*)?(.+)$/m)?.[1]?.trim() ?? basename(item.file)
  }));
  return { schemaVersion: 1, status: "passed", root: normalizePath(root), findings, frontier };
}

// harness/src/check/check.ts
import { existsSync as existsSync3, readFileSync as readFileSync2, readdirSync as readdirSync2, statSync as statSync3 } from "node:fs";
import { basename as basename2, join as join2, relative as relative3 } from "node:path";

// harness/src/shared/process.ts
import { spawnSync } from "node:child_process";
function executable(name) {
  if (process.platform !== "win32") return name;
  if (["npm", "npx", "pnpm", "yarn", "mvn"].includes(name)) return `${name}.cmd`;
  if (name === "gradle") return "gradle.bat";
  return name;
}
function run(command2, args2, options2 = {}) {
  const started = Date.now();
  const cwd = options2.cwd ?? ROOT;
  const spawnOptions = { cwd, encoding: "utf8", env: { ...process.env, ...options2.env }, maxBuffer: options2.maxBuffer ?? 16 * 1024 * 1024, windowsHide: true };
  const result = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable(command2)) ? spawnSync([executable(command2), ...args2].map((part) => /[\s"&|<>^]/.test(part) ? `"${part.replace(/"/g, '""')}"` : part).join(" "), { ...spawnOptions, shell: true }) : spawnSync(executable(command2), args2, spawnOptions);
  return {
    command: [command2, ...args2].join(" "),
    cwd,
    code: result.status ?? 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? (result.signal ? `Process terminated by signal ${result.signal}` : ""),
    durationMs: Date.now() - started
  };
}
function truncateOutput(value, limit = 4e3) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit / 2)}
... <truncated> ...
${value.slice(-limit / 2)}`;
}

// harness/src/check/check.ts
var unreverse = (value) => [...value].reverse().join("");
var BANNED_PATTERNS = [
  new RegExp(unreverse("vdib"), "i"),
  new RegExp(`\\b${unreverse("hcs")}(?:\\b|_)`, "i"),
  new RegExp(unreverse("-tms"), "i"),
  new RegExp(unreverse("tioa"), "i"),
  new RegExp(unreverse("tsetdupadl"), "i")
];
var SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set([".git", "node_modules"]);
var REFERENCE_FILE = /\.(md|json)$/;
function walk(directory, files = []) {
  for (const entry of readdirSync2(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join2(directory, entry.name), files);
    } else if (entry.isFile()) files.push(join2(directory, entry.name));
  }
  return files;
}
function repositoryFiles(root) {
  const listed = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
  if (listed.code !== 0) return walk(root);
  return listed.stdout.split("\0").filter(Boolean).map((file) => join2(root, file)).filter((path) => existsSync3(path));
}
function textOf(path) {
  const buffer = readFileSync2(path);
  return buffer.includes(0) ? null : buffer.toString("utf8");
}
function bannedProblems(root, files) {
  const problems = [];
  for (const path of files) {
    const file = normalizePath(relative3(root, path));
    if (BANNED_PATTERNS.some((pattern) => pattern.test(file))) problems.push({ file, line: null, message: "banned name in the file path" });
    const text = textOf(path);
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      const pattern = BANNED_PATTERNS.find((candidate) => candidate.test(line));
      if (pattern) problems.push({ file, line: index + 1, message: `banned string matching /${pattern.source}/i` });
    });
  }
  return problems;
}
function names(directory, pick) {
  if (!existsSync3(directory)) return /* @__PURE__ */ new Set();
  return new Set(readdirSync2(directory).map(pick).filter((name) => name !== null));
}
function loadPlugins(root) {
  const pluginsDirectory = join2(root, "plugins");
  if (!existsSync3(pluginsDirectory)) return [];
  return readdirSync2(pluginsDirectory).flatMap((entry) => {
    const pluginRoot2 = join2(pluginsDirectory, entry);
    const manifest = join2(pluginRoot2, ".claude-plugin", "plugin.json");
    if (!existsSync3(manifest)) return [];
    const value = JSON.parse(readFileSync2(manifest, "utf8"));
    const skillsDirectory = join2(pluginRoot2, "skills");
    return [{
      name: value.name ?? entry,
      root: pluginRoot2,
      dependencies: (value.dependencies ?? []).map((dependency) => typeof dependency === "string" ? dependency : dependency.name ?? ""),
      skills: names(skillsDirectory, (name) => existsSync3(join2(skillsDirectory, name, "SKILL.md")) ? name : null),
      agents: names(join2(pluginRoot2, "agents"), (name) => name.endsWith(".md") ? basename2(name, ".md") : null),
      principles: names(join2(skillsDirectory, "principles", "principles"), (name) => /^P-[a-z0-9-]+\.md$/.test(name) ? basename2(name, ".md") : null)
    }];
  });
}
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}
function frontmatterProblems(root, plugin) {
  const documents = [
    ...[...plugin.skills].map((name) => ({ name, path: join2(plugin.root, "skills", name, "SKILL.md") })),
    ...[...plugin.agents].map((name) => ({ name, path: join2(plugin.root, "agents", `${name}.md`) }))
  ];
  return documents.flatMap(({ name, path }) => {
    const fields = frontmatter(readFileSync2(path, "utf8"));
    const file = normalizePath(relative3(root, path));
    if (!fields) return [{ file, line: 1, message: "missing frontmatter" }];
    const problems = [];
    if (fields.name !== name) problems.push({ file, line: null, message: `frontmatter name "${fields.name ?? ""}" does not match "${name}"` });
    if (!fields.description) problems.push({ file, line: null, message: "frontmatter description is empty" });
    return problems;
  });
}
var PLUGIN_ROOT_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]*[\w-])/g;
var SLASH_REFERENCE = /(?<![\w.~/-])\/([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)/g;
var PRINCIPLE_REFERENCE = /\bP-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;
function referenceProblems(root, plugin, plugins) {
  const visible = [plugin, ...plugin.dependencies.map((name) => plugins.get(name)).filter((value) => Boolean(value))];
  const visibleNames = new Set(visible.map((item) => item.name));
  const bareReference = new RegExp(`(?<![\\w/-])(${[...plugins.keys()].map((name) => name.replace(/[-]/g, "\\-")).join("|")}):([a-z][a-z0-9-]*)`, "g");
  const problems = [];
  const scanned = walk(plugin.root).filter((path) => REFERENCE_FILE.test(path));
  for (const path of scanned) {
    const file = normalizePath(relative3(root, path));
    readFileSync2(path, "utf8").split(/\r?\n/).forEach((line, index) => {
      const report = (message) => problems.push({ file, line: index + 1, message });
      for (const match of line.matchAll(PLUGIN_ROOT_PATH)) {
        if (!existsSync3(join2(plugin.root, match[1]))) report(`\${CLAUDE_PLUGIN_ROOT}/${match[1]} does not exist`);
      }
      for (const match of line.matchAll(SLASH_REFERENCE)) {
        const [, owner, skill] = match;
        if (!visibleNames.has(owner)) report(`/${owner}:${skill} names a plugin that ${plugin.name} does not depend on`);
        else if (!plugins.get(owner).skills.has(skill)) report(`/${owner}:${skill} is not a skill of ${owner}`);
      }
      for (const match of line.matchAll(bareReference)) {
        const [, owner, name] = match;
        const target = plugins.get(owner);
        if (!visibleNames.has(owner)) report(`${owner}:${name} names a plugin that ${plugin.name} does not depend on`);
        else if (!target.skills.has(name) && !target.agents.has(name)) report(`${owner}:${name} is neither a skill nor an agent of ${owner}`);
      }
      for (const match of line.matchAll(PRINCIPLE_REFERENCE)) {
        if (!visible.some((item) => item.principles.has(match[0]))) report(`${match[0]} is not a principle of ${[...visibleNames].join(" or ")}`);
      }
    });
  }
  return problems;
}
function checkRepository(root) {
  if (!statSync3(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${root}`);
  const plugins = new Map(loadPlugins(root).map((plugin) => [plugin.name, plugin]));
  return [
    ...bannedProblems(root, repositoryFiles(root)),
    ...[...plugins.values()].flatMap((plugin) => [...frontmatterProblems(root, plugin), ...referenceProblems(root, plugin, plugins)])
  ];
}

// harness/src/config/config.ts
import { existsSync as existsSync5, readFileSync as readFileSync4 } from "node:fs";
import { join as join3 } from "node:path";

// harness/src/shared/filesystem.ts
import { createHash } from "node:crypto";
import { closeSync, existsSync as existsSync4, fsyncSync, mkdirSync, openSync, readFileSync as readFileSync3, renameSync, rmSync, statSync as statSync4, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync3(path, "utf8"));
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
    if (!existsSync4(path) || statSync4(path).isDirectory()) {
      hash.update("<missing>\0");
      continue;
    }
    hash.update(readFileSync3(path)).update("\0");
  }
  return hash.digest("hex");
}

// harness/src/config/config.ts
var ADAPTERS = { nx: true, maven: true, gradle: true, npm: true };
var TOP_KEYS = /* @__PURE__ */ new Set(["$schema", "layout", "artifactsDir", "units", "verify", "codeFiles", "review", "policy", "context", "hooks"]);
var NotInitialisedError = class extends Error {
  constructor() {
    super("flow is not initialised here: no .flow/config.json in this directory or its parents. Run `flow init` first.");
  }
};
function strings(value, label2) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${label2} must be an array of strings`);
  return value;
}
function object(value, label2) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label2} must be an object`);
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
  return join3(root, CONFIG_FILE);
}
function isInitialised(root = ROOT) {
  return existsSync5(configPath(root));
}
function loadConfig(root = ROOT) {
  const path = configPath(root);
  if (!existsSync5(path)) throw new NotInitialisedError();
  let value;
  try {
    value = JSON.parse(readFileSync4(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseConfig(value);
}
function configFingerprint(root = ROOT) {
  return fileHash([configPath(root)]);
}
function reviewThresholds(config = loadConfig()) {
  return { broad: config.review?.broad ?? [100, 5], deep: config.review?.deep ?? 300 };
}
function verifyTargets(config = loadConfig()) {
  return config.verify?.targets ?? ["lint", "test", "build"];
}
function initRoot(starts) {
  const root = discoverRoot(starts);
  if (!root) return false;
  useRoot(root, loadConfig(root).artifactsDir);
  return true;
}

// harness/src/context/session.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname3, join as join4, resolve as resolve3 } from "node:path";
import { fileURLToPath } from "node:url";
var SESSION_CONTEXT_HOOK = "session-context";
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT ?? resolve3(dirname3(fileURLToPath(import.meta.url)), "..");
}
function coreRules() {
  return readFileSync5(join4(pluginRoot(), "context", "core-rules.md"), "utf8");
}
function sessionStartOutput(config, rules) {
  if (config.hooks?.disabled?.includes(SESSION_CONTEXT_HOOK)) return null;
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rules } };
}

// harness/src/init/init.ts
import { chmodSync, existsSync as existsSync13, readFileSync as readFileSync10, readdirSync as readdirSync5 } from "node:fs";
import { homedir } from "node:os";
import { join as join11, resolve as resolve9 } from "node:path";

// harness/src/topology/workspaces.ts
import { existsSync as existsSync12, readFileSync as readFileSync9, readdirSync as readdirSync4 } from "node:fs";
import { basename as basename6, dirname as dirname4, join as join10, relative as relative5, resolve as resolve8 } from "node:path";

// harness/src/units/gradle.ts
import { existsSync as existsSync8, readFileSync as readFileSync7 } from "node:fs";
import { basename as basename3, join as join6, resolve as resolve5 } from "node:path";

// harness/src/inspection/changes.ts
import { existsSync as existsSync6, readFileSync as readFileSync6, statSync as statSync5 } from "node:fs";
import { extname, join as join5, resolve as resolve4 } from "node:path";
function parseStatus(output2) {
  const tokens = output2.split("\0").filter(Boolean);
  const records = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    records.push({ path: normalizePath(entry.slice(3)), status, untracked: status === "??" });
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return records;
}
function parseNameStatus(output2) {
  const tokens = output2.split("\0").filter(Boolean);
  const records = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index] ?? "";
    if (/^[RC]/.test(status)) index += 1;
    index += 1;
    const path = tokens[index];
    if (path) records.push({ path: normalizePath(path), status: `${status[0]} `, untracked: false });
  }
  return records;
}
function parseNumstat(output2) {
  const stats = /* @__PURE__ */ new Map();
  const tokens = output2.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const [added = "0", deleted = "0", path = ""] = token.split("	");
    let destination = path;
    if (!destination) {
      index += 2;
      destination = tokens[index] ?? "";
    }
    if (!destination) continue;
    stats.set(normalizePath(destination), {
      added: added === "-" ? 0 : Number(added),
      deleted: deleted === "-" ? 0 : Number(deleted)
    });
  }
  return stats;
}
function countLines(path) {
  if (!existsSync6(path) || statSync5(path).isDirectory()) return 0;
  const text = readFileSync6(path, "utf8");
  if (!text) return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}
function affectsWholeWorkspace(change) {
  return /^(?:package(?:-lock)?\.json|nx\.json|tsconfig(?:\.base)?\.json|eslint\.config\.[cm]?js|jest\.config\.[cm]?ts|\.env(?:\..*)?|pom\.xml|(?:settings|build)\.gradle(?:\.kts)?|gradle\.properties|gradle\/libs\.versions\.toml)$/i.test(normalizePath(change.path));
}
function changedLines(workspaceRoot, change, base) {
  const absolute = resolve4(workspaceRoot, change.path);
  if (change.untracked) return new Set(Array.from({ length: countLines(absolute) }, (_, index) => index + 1));
  const result = run("git", ["diff", "--unified=0", base, "--", change.path], { cwd: workspaceRoot });
  if (result.code !== 0) return /* @__PURE__ */ new Set();
  const lines = /* @__PURE__ */ new Set();
  for (const match of result.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === void 0 ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return lines;
}
function collectWorkspaceChanges(workspace, base = "HEAD") {
  const empty = { workspace, available: false, changes: [], added: 0, deleted: 0, codeAdded: 0, codeDeleted: 0, codeFiles: 0 };
  if (!existsSync6(join5(workspace.root, ".git"))) return { ...empty, error: "Git repository not found" };
  const statusResult = run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: workspace.root });
  if (statusResult.code !== 0) return { ...empty, error: statusResult.stderr.trim() };
  const numstatResult = run("git", ["diff", "--numstat", "-z", base, "--"], { cwd: workspace.root });
  if (numstatResult.code !== 0) return { ...empty, error: numstatResult.stderr.trim() };
  const numstat = parseNumstat(numstatResult.stdout);
  const records = parseStatus(statusResult.stdout);
  if (base !== "HEAD") {
    const committed = run("git", ["diff", "--name-status", "-z", base, "HEAD", "--"], { cwd: workspace.root });
    if (committed.code !== 0) return { ...empty, error: committed.stderr.trim() };
    const seen = new Set(records.map((record) => record.path));
    records.push(...parseNameStatus(committed.stdout).filter((record) => !seen.has(record.path) && numstat.has(record.path)));
  }
  const codeExtensions = new Set(loadConfig().codeFiles ?? unitAdapter(workspace.adapter).codeFiles);
  const changes = records.map((change) => {
    const absolutePath = resolve4(workspace.root, change.path);
    const stat = numstat.get(change.path) ?? { added: change.untracked ? countLines(absolutePath) : 0, deleted: 0 };
    return {
      ...change,
      absolutePath,
      exists: existsSync6(absolutePath),
      added: stat.added,
      deleted: stat.deleted,
      isCode: codeExtensions.has(extname(change.path).toLowerCase()),
      changedLines: changedLines(workspace.root, change, base)
    };
  });
  const codeChanges = changes.filter((change) => change.isCode);
  return {
    workspace,
    base,
    available: true,
    changes,
    added: changes.reduce((sum, change) => sum + change.added, 0),
    deleted: changes.reduce((sum, change) => sum + change.deleted, 0),
    codeAdded: codeChanges.reduce((sum, change) => sum + change.added, 0),
    codeDeleted: codeChanges.reduce((sum, change) => sum + change.deleted, 0),
    codeFiles: codeChanges.length
  };
}
function reviewStats(groups, thresholds = reviewThresholds()) {
  const changed = groups.filter((group) => group.changes.length > 0);
  const added = changed.reduce((sum, group) => sum + group.added, 0);
  const deleted = changed.reduce((sum, group) => sum + group.deleted, 0);
  const codeAdded = changed.reduce((sum, group) => sum + group.codeAdded, 0);
  const codeDeleted = changed.reduce((sum, group) => sum + group.codeDeleted, 0);
  const codeFiles = changed.reduce((sum, group) => sum + group.codeFiles, 0);
  const codeLines = codeAdded + codeDeleted;
  return {
    added,
    deleted,
    totalLines: added + deleted,
    codeAdded,
    codeDeleted,
    codeLines,
    lines: added + deleted,
    files: changed.reduce((sum, group) => sum + group.changes.length, 0),
    codeFiles,
    workspaces: changed.length,
    // A broad change (more lines than broad[0] over more files than broad[1]) or a deep one (more than deep lines) needs formal review.
    formalReviewRequired: codeLines > thresholds.broad[0] && codeFiles > thresholds.broad[1] || codeLines > thresholds.deep
  };
}

// harness/src/units/dependents.ts
function unavailable(reason) {
  return { status: "unavailable", reason };
}
function transitiveConsumers(consumers2, start) {
  const seen = /* @__PURE__ */ new Set([start]);
  const queue = [start];
  for (let name = queue.shift(); name !== void 0; name = queue.shift()) {
    for (const consumer of consumers2.get(name) ?? []) {
      if (seen.has(consumer)) continue;
      seen.add(consumer);
      queue.push(consumer);
    }
  }
  seen.delete(start);
  return [...seen].sort();
}
function addConsumer(consumers2, used, consumer) {
  consumers2.set(used, [...consumers2.get(used) ?? [], consumer]);
}

// harness/src/units/step.ts
import { existsSync as existsSync7 } from "node:fs";
function commandStep(workspace, project, target, command2, changes, buildFiles2) {
  const id = `${workspace.relativeRoot}:${project ?? "all"}:${target}`;
  const files = [...changes.map((change) => change.absolutePath), ...buildFiles2.filter(existsSync7)];
  return { id, kind: "command", workspace: workspace.relativeRoot, project, target, command: command2, cwd: workspace.root, fingerprint: fileHash(files, id) };
}

// harness/src/units/gradle.ts
var GOAL = "check";
var SETTINGS = ["settings.gradle.kts", "settings.gradle"];
function settingsFile(root) {
  return SETTINGS.map((name) => join6(root, name)).find(existsSync8) ?? null;
}
function unit(workspace, path) {
  const relativeRoot = path === ":" ? "." : path.slice(1).replaceAll(":", "/");
  const root = resolve5(workspace.root, relativeRoot);
  return { name: path === ":" ? basename3(workspace.root) : path, root, relativeRoot, sourceRoot: null, projectType: null, targets: { [GOAL]: {} }, configPath: settingsFile(workspace.root) ?? join6(root, "build.gradle") };
}
function loadProjects(workspace) {
  const settings = settingsFile(workspace.root);
  const text = settings ? readFileSync7(settings, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "") : "";
  const paths = /* @__PURE__ */ new Set();
  for (const statement of text.matchAll(/\binclude\b\s*\(?((?:\s*["'][^"']+["']\s*,?)+)/g)) {
    for (const name of statement[1].matchAll(/["']([^"']+)["']/g)) paths.add(name[1].startsWith(":") ? name[1] : `:${name[1]}`);
  }
  if (!paths.size) return [unit(workspace, ":")];
  return [...paths].map((path) => unit(workspace, path)).sort((left, right) => left.name.localeCompare(right.name));
}
function gradle(workspace) {
  if (process.platform === "win32") return existsSync8(join6(workspace.root, "gradlew.bat")) ? "gradlew.bat" : "gradle";
  return existsSync8(join6(workspace.root, "gradlew")) ? "./gradlew" : "gradle";
}
function buildFiles(workspace, projects) {
  return [...SETTINGS, "build.gradle.kts", "build.gradle", "gradle.properties"].map((name) => join6(workspace.root, name)).concat(projects.flatMap((project) => [join6(project.root, "build.gradle.kts"), join6(project.root, "build.gradle")]));
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
  detect: (directory) => [...SETTINGS, "build.gradle.kts", "build.gradle"].some((name) => existsSync8(join6(directory, name))),
  loadUnits: loadProjects,
  verifyPlan,
  unitPlan: (workspace, project) => [commandStep(workspace, project.name, GOAL, [gradle(workspace), project.relativeRoot === "." ? GOAL : `${project.name}:${GOAL}`], [], buildFiles(workspace, [project]))],
  dependents: () => unavailable("Gradle project dependencies are declared in build scripts and are not read")
};

// harness/src/units/maven.ts
import { existsSync as existsSync9, readFileSync as readFileSync8 } from "node:fs";
import { basename as basename4, join as join7, resolve as resolve6 } from "node:path";
var GOAL2 = "verify";
function unit2(workspace, relativeRoot) {
  const root = resolve6(workspace.root, relativeRoot);
  return { name: relativeRoot === "." ? basename4(workspace.root) : relativeRoot, root, relativeRoot, sourceRoot: null, projectType: null, targets: { [GOAL2]: {} }, configPath: join7(root, "pom.xml") };
}
function loadModules(workspace) {
  const pom = readFileSync8(join7(workspace.root, "pom.xml"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const modules = [...new Set([...pom.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map((match) => normalizePath(match[1]).replace(/\/$/, "")))];
  if (!modules.length) return [unit2(workspace, ".")];
  return modules.filter((module) => existsSync9(join7(workspace.root, module, "pom.xml"))).map((module) => unit2(workspace, module)).sort((left, right) => left.name.localeCompare(right.name));
}
function maven(workspace) {
  if (process.platform === "win32") return existsSync9(join7(workspace.root, "mvnw.cmd")) ? "mvnw.cmd" : "mvn";
  return existsSync9(join7(workspace.root, "mvnw")) ? "./mvnw" : "mvn";
}
function verifyPlan2(group) {
  const modules = loadModules(group.workspace);
  const buildFiles2 = modules.map((module) => module.configPath).concat(join7(group.workspace.root, "pom.xml"));
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
  const pom = readFileSync8(module.configPath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
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
  const consumers2 = /* @__PURE__ */ new Map();
  for (const module of modules) {
    for (const used of module.dependsOn) {
      const usedName = nameOf.get(used);
      if (usedName) addConsumer(consumers2, usedName, module.name);
    }
  }
  return { status: "ok", units: transitiveConsumers(consumers2, unit3.name), workspaces: [], notes: [] };
}
var mavenAdapter = {
  name: "maven",
  codeFiles: [".java", ".kt", ".kts", ".xml"],
  detect: (directory) => existsSync9(join7(directory, "pom.xml")),
  loadUnits: loadModules,
  verifyPlan: verifyPlan2,
  unitPlan: (workspace, module) => [commandStep(workspace, module.name, GOAL2, module.relativeRoot === "." ? [maven(workspace), "-q", GOAL2] : [maven(workspace), "-q", "-pl", module.relativeRoot, "-am", GOAL2], [], [module.configPath, join7(workspace.root, "pom.xml")])],
  dependents
};

// harness/src/units/npm.ts
import { existsSync as existsSync10 } from "node:fs";
import { basename as basename5, join as join8 } from "node:path";
var LOCKFILES = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]];
function packageManager(root) {
  const configured = loadConfig().units.packageManager;
  if (configured) return configured;
  const declared = readJson(join8(root, "package.json"), {}).packageManager;
  if (typeof declared === "string" && declared) return declared.split("@")[0];
  return LOCKFILES.find(([file]) => existsSync10(join8(root, file)))?.[1] ?? "npm";
}
function loadUnits(workspace) {
  const { name, scripts = {} } = readJson(join8(workspace.root, "package.json"), {});
  return [{
    name: name ?? basename5(workspace.root),
    root: workspace.root,
    relativeRoot: ".",
    sourceRoot: null,
    projectType: null,
    targets: Object.fromEntries(Object.keys(scripts).map((script) => [script, {}])),
    configPath: join8(workspace.root, "package.json")
  }];
}
function steps(workspace, targets, changes) {
  const manager = packageManager(workspace.root);
  const buildFiles2 = [join8(workspace.root, "package.json"), ...LOCKFILES.map(([file]) => join8(workspace.root, file))];
  return targets.filter((target) => workspace.scripts[target] !== void 0).map((target) => commandStep(workspace, workspace.name, target, [manager, "run", target], changes, buildFiles2));
}
function verifyPlan3(group, targets) {
  return { affectedProjects: [{ workspace: group.workspace.relativeRoot, project: group.workspace.name }], steps: steps(group.workspace, targets, group.changes) };
}
var npmAdapter = {
  name: "npm",
  codeFiles: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".html", ".scss", ".css", ".json", ".jsonc", ".yaml", ".yml"],
  detect: (directory) => existsSync10(join8(directory, "package.json")),
  loadUnits,
  verifyPlan: verifyPlan3,
  unitPlan: (workspace, _unit, targets) => steps(workspace, targets, []),
  dependents: () => unavailable("an npm package is one unit; the packages that use it live outside the project")
};

// harness/src/units/nx.ts
import { existsSync as existsSync11, readdirSync as readdirSync3 } from "node:fs";
import { join as join9, relative as relative4, resolve as resolve7 } from "node:path";
function loadProjects2(workspace) {
  const projects = [];
  const visit = (directory) => {
    for (const entry of readdirSync3(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(join9(directory, entry.name));
        continue;
      }
      if (entry.name !== "project.json") continue;
      const configPath2 = join9(directory, entry.name);
      const raw = parseJsonObject(configPath2, "Nx project.json");
      const config = raw;
      if (typeof config.name !== "string" || !config.name) throw new Error(`Invalid Nx project.json ${normalizePath(configPath2)}: name is required`);
      for (const field of ["root", "sourceRoot", "projectType"]) {
        if (config[field] !== void 0 && typeof config[field] !== "string") throw new Error(`Invalid Nx project.json ${normalizePath(configPath2)}: ${field} must be a string`);
      }
      if (config.targets !== void 0 && (!config.targets || typeof config.targets !== "object" || Array.isArray(config.targets))) {
        throw new Error(`Invalid Nx project.json ${normalizePath(configPath2)}: targets must be an object`);
      }
      const projectRoot = resolve7(workspace.root, config.root ?? relative4(workspace.root, directory));
      projects.push({
        name: config.name,
        root: projectRoot,
        relativeRoot: normalizePath(relative4(workspace.root, projectRoot)),
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
  const relevantFiles = [...changes.map((change) => change.absolutePath), ...[project.configPath, join9(workspace.root, "package.json"), join9(workspace.root, "nx.json")].filter(existsSync11)];
  return { id, kind: "command", workspace: workspace.relativeRoot, project: project.name, target, command: ["npx", "nx", "run", `${project.name}:${target}`], cwd: workspace.root, fingerprint: fileHash(relevantFiles, id) };
}
function runManyStep(group, target) {
  const id = `${group.workspace.relativeRoot}:all:${target}`;
  const relevantFiles = [...group.changes.map((change) => change.absolutePath), ...[join9(group.workspace.root, "package.json"), join9(group.workspace.root, "nx.json")].filter(existsSync11)];
  return { id, kind: "command", workspace: group.workspace.relativeRoot, project: null, target, command: ["npx", "nx", "run-many", "--target", target, "--all"], cwd: group.workspace.root, fingerprint: fileHash(relevantFiles, id) };
}
function queryAffectedProjects(group, ownerNames) {
  const cli = join9(group.workspace.root, "node_modules", "nx", "bin", "nx.js");
  const result = run("node", [cli, "show", "projects", "--affected", "--base=HEAD"], { cwd: group.workspace.root });
  if (result.code !== 0) return { names: [], error: result.stderr.trim() || result.stdout.trim() || "Nx affected query failed" };
  const names2 = new Set(ownerNames);
  for (const name of result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) names2.add(name);
  return { names: [...names2], error: null };
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
var GRAPH_FILES = [join9(".nx", "cache", "project-graph.json"), join9(".nx", "workspace-data", "project-graph.json")];
var DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];
function packageName(project) {
  return readJson(join9(project.root, "package.json"), {}).name;
}
function cachedGraph(workspace) {
  const path = GRAPH_FILES.map((file) => join9(workspace.root, file)).find(existsSync11);
  return path ? readJson(path, null) : null;
}
function dependentProjects(graph, name) {
  const consumers2 = /* @__PURE__ */ new Map();
  for (const [source, edges] of Object.entries(graph.dependencies ?? {})) {
    for (const { target } of edges) if (graph.nodes?.[source] && graph.nodes[target]) addConsumer(consumers2, target, source);
  }
  return transitiveConsumers(consumers2, name);
}
function consumingWorkspaces(workspace, packages) {
  const found = [];
  for (const other of discoverWorkspaces()) {
    if (other.relativeRoot === workspace.relativeRoot) continue;
    const manifest = readJson(join9(other.root, "package.json"), {});
    const spec = DEPENDENCY_SECTIONS.flatMap((section2) => [...packages].map((name) => manifest[section2]?.[name])).find((value) => typeof value === "string");
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
  detect: (directory) => existsSync11(join9(directory, "package.json")) && existsSync11(join9(directory, "nx.json")),
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
function parseJsonObject(path, label2) {
  let value;
  try {
    value = JSON.parse(readFileSync9(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label2} ${normalizePath(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label2} ${normalizePath(path)}: expected an object`);
  return value;
}
function detectAdapter(directory) {
  return loadConfig().units.adapters.map(unitAdapter).find((adapter) => adapter.detect(directory)) ?? null;
}
function loadWorkspace(root, adapter = detectAdapter(root)) {
  if (!adapter) throw new Error(`No configured unit adapter recognises ${normalizePath(root)}`);
  const path = join10(root, "package.json");
  const packageJson = existsSync12(path) ? parseJsonObject(path, "workspace package.json") : {};
  if (packageJson.name !== void 0 && typeof packageJson.name !== "string") throw new Error(`Invalid workspace package.json ${normalizePath(path)}: name must be a string`);
  if (packageJson.scripts !== void 0 && (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts) || !Object.values(packageJson.scripts).every((script) => typeof script === "string"))) {
    throw new Error(`Invalid workspace package.json ${normalizePath(path)}: scripts must map names to strings`);
  }
  return {
    name: packageJson.name ?? basename6(root),
    root,
    relativeRoot: logicalRelativePath(relative5(ROOT, root)) || ".",
    adapter: adapter.name,
    scripts: packageJson.scripts ?? {}
  };
}
function workspaceAt(root) {
  if (!existsSync12(root)) return null;
  const adapter = detectAdapter(root);
  return adapter ? loadWorkspace(root, adapter) : null;
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
    for (const entry of readdirSync4(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      visit(join10(directory, entry.name));
    }
  };
  visit(root);
  return found.sort((left, right) => left.relativeRoot.localeCompare(right.relativeRoot));
}
function findWorkspace(input) {
  let current = existingDirectory(input);
  if (!current) return null;
  const umbrella = loadConfig().layout === "umbrella";
  let found = null;
  while (isWithin(ROOT, current)) {
    if (current === ROOT && umbrella) break;
    const adapter = detectAdapter(current);
    if (adapter) found = { root: current, adapter };
    if (current === ROOT) break;
    current = dirname4(current);
  }
  return found ? loadWorkspace(found.root, found.adapter) : null;
}
function loadProjects3(workspace) {
  return unitAdapter(workspace.adapter).loadUnits(workspace);
}
function resolveProject(input, projects) {
  const target = resolve8(input);
  return projects.filter((project) => isWithin(project.root, target)).sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}
function findProject(name) {
  const matches = [];
  for (const workspace of discoverWorkspaces()) {
    for (const project of loadProjects3(workspace)) {
      if (project.name === name) matches.push({ workspace, project });
    }
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

// harness/src/init/init.ts
var SETTINGS_FILE = join11(".claude", "settings.json");
var FLOW_HOOK_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PreCompact", "Stop", "SubagentStart", "SubagentStop"];
function adapterOf(directory) {
  return UNIT_ADAPTERS.find((adapter) => adapter.detect(directory))?.name ?? null;
}
function nestedAdapters(root) {
  const found = /* @__PURE__ */ new Set();
  const visit = (directory) => {
    for (const entry of readdirSync5(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const child = join11(directory, entry.name);
      const adapter = adapterOf(child);
      if (adapter) found.add(adapter);
      else visit(child);
    }
  };
  visit(root);
  return [...found];
}
function detectConfig(root, layout = null) {
  const supported = UNIT_ADAPTERS.map((adapter) => adapter.name).join(", ");
  const own = layout === "umbrella" ? null : adapterOf(root);
  if (own) return { layout: "single", units: { adapters: [own] } };
  if (layout === "single") throw new Error(`No supported build tool (${supported}) recognises ${normalizePath(root)} as a workspace`);
  const nested = nestedAdapters(root);
  if (!nested.length) throw new Error(`No workspace of a supported build tool (${supported}) found in ${normalizePath(root)}`);
  return { layout: "umbrella", units: { adapters: nested } };
}
var directoryMarketplace = (path) => ({ path: resolve9(path), source: { source: "directory", path: resolve9(path) } });
var KNOWN_MARKETPLACES = join11(homedir(), ".claude", "plugins", "known_marketplaces.json");
var offersFlow = (path) => readJson(join11(path, ".claude-plugin", "marketplace.json"), {}).plugins?.some((plugin) => plugin.name === "flow") ?? false;
function defaultMarketplace(plugin = pluginRoot(), registry = KNOWN_MARKETPLACES) {
  const checkout = resolve9(plugin, "..", "..");
  if (existsSync13(join11(checkout, ".claude-plugin", "marketplace.json"))) return directoryMarketplace(checkout);
  const known = readJson(registry, {});
  for (const value of Object.values(known)) {
    const path = value.source?.source === "directory" ? value.source.path : value.installLocation;
    if (value.source && path && offersFlow(path)) return { path, source: value.source };
  }
  return null;
}
function hookCommands(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => (group?.hooks ?? []).map((hook) => String(hook?.command ?? "")));
}
function writeInit(plan) {
  if (!plan.config.exists) writeJsonAtomic(plan.config.path, plan.config.value);
  if (plan.settings.changes.length) writeJsonAtomic(plan.settings.path, plan.settings.value);
}
function planInit(root, options2) {
  const marketplacePath = options2.marketplace.path;
  const manifestPath = join11(marketplacePath, ".claude-plugin", "marketplace.json");
  if (!existsSync13(manifestPath)) throw new Error(`Not a marketplace directory: ${normalizePath(marketplacePath)} has no .claude-plugin/marketplace.json`);
  const marketplace = parseJsonObject(manifestPath, "marketplace manifest");
  if (!marketplace.name) throw new Error(`${normalizePath(manifestPath)} has no name`);
  const entries = marketplace.plugins ?? [];
  const available = new Set(entries.map((plugin) => plugin.name));
  const plugins = ["flow", "flow-ui", ...options2.stacks.map((stack) => `stack-${stack}`)];
  const missing = plugins.filter((plugin) => !available.has(plugin));
  if (missing.length) throw new Error(`Marketplace ${marketplace.name} has no plugin ${missing.join(", ")}`);
  const configPath2 = join11(root, CONFIG_FILE);
  const exists = existsSync13(configPath2);
  const config = exists ? parseConfig(parseJsonObject(configPath2, CONFIG_FILE)) : detectConfig(root, options2.layout);
  const settingsPath = join11(root, SETTINGS_FILE);
  const settings = existsSync13(settingsPath) ? parseJsonObject(settingsPath, SETTINGS_FILE) : {};
  const changes = [];
  const set = (section2, key, value) => {
    const current = settings[section2] ?? {};
    if (JSON.stringify(current[key]) === JSON.stringify(value)) return;
    changes.push(`${key in current ? "~" : "+"} ${section2}.${key} = ${JSON.stringify(value)}`);
    settings[section2] = { ...current, [key]: value };
  };
  set("extraKnownMarketplaces", marketplace.name, { source: options2.marketplace.source });
  for (const plugin of plugins) set("enabledPlugins", `${plugin}@${marketplace.name}`, true);
  const hooks = settings.hooks ?? {};
  const warnings = FLOW_HOOK_EVENTS.filter((event) => hookCommands(hooks[event]).length).map((event) => `${SETTINGS_FILE} already has ${event} hooks (${hookCommands(hooks[event]).join("; ")}); flow handles ${event} too, so remove any that do the same job`);
  const flowAgentsDirectory = join11(marketplacePath, entries.find((plugin) => plugin.name === "flow")?.source ?? "", "agents");
  const flowAgents = existsSync13(flowAgentsDirectory) ? readdirSync5(flowAgentsDirectory).filter((name) => name.endsWith(".md")) : [];
  for (const agent of flowAgents) {
    if (existsSync13(join11(root, ".claude", "agents", agent))) warnings.push(`.claude/agents/${agent} has the same name as the flow agent flow:${agent.slice(0, -3)}; remove one of them`);
  }
  return { root, config: { path: configPath2, value: config, exists }, settings: { path: settingsPath, value: settings, changes }, warnings };
}
function installShim(directory, plugin = pluginRoot()) {
  ensureDirectory(directory);
  const files = [
    ["flow.mjs", readFileSync10(join11(plugin, "shim", "flow.mjs"), "utf8")],
    ["flow", '#!/bin/sh\nexec node "$(dirname -- "$0")/flow.mjs" "$@"\n'],
    ["flow.cmd", '@node "%~dp0flow.mjs" %*\r\n']
  ];
  for (const [name, content] of files) writeFileAtomic(join11(directory, name), content);
  chmodSync(join11(directory, "flow"), 493);
  return files.map(([name]) => normalizePath(join11(directory, name)));
}
var DEFAULT_SHIM_DIRECTORY = join11(homedir(), ".local", "bin");

// harness/src/doctor/doctor.ts
function check(name, status, message, details = null) {
  return { name, status, message, details };
}
function runDoctor() {
  const checks = [];
  if (!isInitialised()) {
    checks.push(check("config", "failed", `No .flow/config.json above ${ROOT}; run flow init`));
    return { schemaVersion: 2, status: "failed", checks };
  }
  try {
    const config = loadConfig();
    checks.push(check("config", "passed", `.flow/config.json is valid (layout ${config.layout}, adapters ${config.units.adapters.join(", ")})`));
  } catch (error) {
    checks.push(check("config", "failed", error instanceof Error ? error.message : String(error)));
    return { schemaVersion: 2, status: "failed", checks };
  }
  try {
    const workspaces = discoverWorkspaces();
    const invalid = [];
    let projectCount = 0;
    for (const workspace of workspaces) {
      const projects = loadProjects3(workspace);
      projectCount += projects.length;
      const names2 = /* @__PURE__ */ new Set();
      for (const project of projects) {
        if (names2.has(project.name)) invalid.push(`${workspace.relativeRoot}:${project.name}`);
        names2.add(project.name);
      }
    }
    checks.push(check("unit-discovery", workspaces.length && !invalid.length ? "passed" : "failed", `${workspaces.length} workspaces and ${projectCount} units discovered`, invalid));
  } catch (error) {
    checks.push(check("unit-discovery", "failed", error instanceof Error ? error.message : String(error)));
  }
  const failures = checks.filter((item) => item.status === "failed");
  const warnings = checks.filter((item) => item.status === "warning");
  return { schemaVersion: 2, status: failures.length ? "failed" : warnings.length ? "degraded" : "passed", checks };
}

// harness/src/inspection/inspect.ts
import { existsSync as existsSync14 } from "node:fs";
import { relative as relative6, resolve as resolve10 } from "node:path";

// harness/src/verification/planner.ts
function classifyPaths(paths) {
  return paths.length && paths.every((path) => /(?:^|\/)(?:docs\/|[^/]+\.md$)/i.test(path)) ? ["docs"] : ["code"];
}
function globPattern(glob) {
  const source = glob.split(/(\*\*\/|\*\*|\*|\?)/).map((part) => {
    if (part === "**/") return "(?:.*/)?";
    if (part === "**") return ".*";
    if (part === "*") return "[^/]*";
    if (part === "?") return "[^/]";
    return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${source}$`);
}
function customSteps(group) {
  return (loadConfig().verify?.custom ?? []).flatMap((rule) => {
    const patterns = rule.files.map(globPattern);
    const matched = group.changes.filter((change) => patterns.some((pattern) => pattern.test(normalizePath(change.path))));
    return matched.length ? [commandStep(group.workspace, null, `custom:${rule.name}`, rule.command, matched, [])] : [];
  });
}
function planVerification(groups) {
  const plan = { schemaVersion: 1, affectedProjects: [], steps: [] };
  const targets = verifyTargets();
  const add2 = (step) => {
    if (!plan.steps.some((existing) => existing.id === step.id)) plan.steps.push(step);
  };
  for (const group of groups) {
    if (!group.changes.length) continue;
    if (classifyPaths(group.changes.map((change) => normalizePath(change.path)))[0] !== "docs") {
      const planned = unitAdapter(group.workspace.adapter).verifyPlan(group, targets);
      plan.affectedProjects.push(...planned.affectedProjects);
      planned.steps.forEach(add2);
    }
    customSteps(group).forEach(add2);
  }
  return plan;
}

// harness/src/inspection/inspect.ts
var PREFLIGHT = "overengineering-review: run it before introducing or materially expanding a public seam, shared abstraction, configurable workflow, or extension mechanism";
function contextSources(workspace, kinds) {
  const context = loadConfig().context;
  const resolveAll = (sources = []) => sources.map((source) => source.replaceAll("{workspace}", workspace.relativeRoot)).filter((source) => existsSync14(resolve10(ROOT, source)));
  return {
    docs: resolveAll(context?.docs),
    conventions: kinds.includes("code") ? resolveAll(context?.conventions) : [],
    preflights: kinds.includes("code") ? [PREFLIGHT] : []
  };
}
function inspectTarget(input = ".") {
  const absolute = resolveInput(input);
  let workspace = findWorkspace(absolute);
  let project = null;
  let target = absolute;
  if (!workspace) {
    const named = findProject(input);
    if (named) {
      workspace = named.workspace;
      project = named.project;
      target = project.root;
    }
  }
  if (!workspace) return { schemaVersion: 2, status: "outside-workspace", target: normalizePath(absolute), message: "Target is not inside a unit workspace and does not uniquely name a project." };
  project ??= resolveProject(target, loadProjects3(workspace));
  const group = collectWorkspaceChanges(workspace);
  if (!group.available) return {
    schemaVersion: 2,
    status: "git-unavailable",
    target: relativeToRoot(target),
    workspace: { name: workspace.name, root: workspace.relativeRoot },
    project: project ? { name: project.name, root: project.relativeRoot, type: project.projectType, targets: Object.keys(project.targets).sort() } : null,
    message: group.error ?? "Git changes are unavailable"
  };
  const resolvedProject = project;
  const scopedChanges = resolvedProject ? group.changes.filter((change) => isWithin(resolvedProject.root, change.absolutePath) || affectsWholeWorkspace(change)) : group.changes;
  const codeChanges = scopedChanges.filter((change) => change.isCode);
  const scopedGroup = {
    ...group,
    changes: scopedChanges,
    scopeToOwners: true,
    added: scopedChanges.reduce((sum, change) => sum + change.added, 0),
    deleted: scopedChanges.reduce((sum, change) => sum + change.deleted, 0),
    codeFiles: codeChanges.length,
    codeAdded: codeChanges.reduce((sum, change) => sum + change.added, 0),
    codeDeleted: codeChanges.reduce((sum, change) => sum + change.deleted, 0)
  };
  const paths = scopedChanges.length ? scopedChanges.map((change) => change.path) : [normalizePath(relative6(workspace.root, target))];
  const kinds = classifyPaths(paths);
  const plan = scopedChanges.length ? planVerification([scopedGroup]) : { steps: project ? unitAdapter(workspace.adapter).unitPlan(workspace, project, verifyTargets()) : [] };
  const stats = reviewStats([scopedGroup]);
  return {
    schemaVersion: 2,
    status: "ok",
    target: existsSync14(target) ? relativeToRoot(target) : normalizePath(target),
    workspace: { name: workspace.name, root: workspace.relativeRoot },
    project: project ? { name: project.name, root: normalizePath(project.relativeRoot), type: project.projectType, targets: Object.keys(project.targets).sort() } : null,
    task: { kinds },
    context: contextSources(workspace, kinds),
    changes: { ...stats, fileCount: stats.files, files: scopedChanges.map((change) => ({ path: change.path, status: change.status, added: change.added, deleted: change.deleted })) },
    verification: plan.steps
  };
}
function inspectTaskTargets(targets) {
  return targets.map((target) => inspectTarget(resolve10(ROOT, target.path)));
}

// harness/src/observability/state.ts
import { appendFileSync, closeSync as closeSync2, existsSync as existsSync15, openSync as openSync2, readFileSync as readFileSync11, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join12 } from "node:path";
var cachePath = () => join12(SCRATCH_ROOT, "cache", "verification.json");
var cacheLockPath = () => join12(SCRATCH_ROOT, "cache", ".verification.lock");
var telemetryPath = () => join12(SCRATCH_ROOT, "telemetry", "events.jsonl");
function loadVerificationCache() {
  return readJson(cachePath(), { schemaVersion: 1, steps: {} });
}
function mutateVerificationCache(update) {
  ensureDirectory(join12(SCRATCH_ROOT, "cache"));
  let descriptor = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      descriptor = openSync2(cacheLockPath(), "wx");
      writeFileSync2(descriptor, `${process.pid}
`, "utf8");
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (descriptor === null) throw new Error("Verification cache is locked by another process");
  try {
    const cache = loadVerificationCache();
    update(cache);
    writeJsonAtomic(cachePath(), cache);
  } finally {
    closeSync2(descriptor);
    if (existsSync15(cacheLockPath())) unlinkSync(cacheLockPath());
  }
}
function clearVerificationCache() {
  mutateVerificationCache((cache) => {
    cache.steps = {};
  });
}
function recordVerificationCacheStep(id, value) {
  mutateVerificationCache((cache) => {
    cache.steps[id] = value;
  });
}
function recordTelemetry(event) {
  try {
    ensureDirectory(join12(SCRATCH_ROOT, "telemetry"));
    const safe = {
      schemaVersion: 3,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      eventType: event.eventType ?? "command.completed",
      command: event.command ?? null,
      status: event.status ?? null,
      durationMs: event.durationMs ?? null,
      taskId: event.taskId ?? null,
      feature: event.feature ?? null,
      sourceType: event.sourceType ?? null,
      source: event.source ?? null,
      sourceRevision: event.sourceRevision ?? null,
      handoff: event.handoff ?? null,
      transitionFrom: event.transitionFrom ?? null,
      transitionTo: event.transitionTo ?? null,
      questionCount: event.questionCount ?? null,
      decisionCount: event.decisionCount ?? null,
      artifactRevision: event.artifactRevision ?? null,
      workspace: event.workspace ?? null,
      project: event.project ?? null,
      verificationStep: event.verificationStep ?? null,
      changedFiles: event.changedFiles ?? null,
      totalLines: event.totalLines ?? null,
      codeLines: event.codeLines ?? null,
      cacheHits: event.cacheHits ?? 0,
      cacheMissReason: event.cacheMissReason ?? null,
      retries: event.retries ?? 0,
      exitClass: event.exitClass ?? null
    };
    appendFileSync(telemetryPath(), `${JSON.stringify(safe)}
`, "utf8");
  } catch {
  }
}
function automaticWorklogBlock(manifest, groups, stats, results, review) {
  const changedFiles = groups.flatMap((group) => group.changes.map((change) => `${group.workspace.relativeRoot}/${change.path}`));
  return [
    "<!-- flow:auto:start -->",
    `Updated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "",
    "## Changed files",
    "",
    ...changedFiles.length ? changedFiles.map((path) => `- \`${path}\``) : ["- None"],
    "",
    "## Verification ledger",
    "",
    ...results.length ? results.map((result) => `- ${result.status.toUpperCase()} \u2014 \`${result.id}\`${result.cached ? " (cached)" : ""}`) : ["- No verification steps required for the current task-scoped change set."],
    "",
    "## Review threshold",
    "",
    `- Total changed lines: ${stats.totalLines}`,
    `- Implementation/code lines: ${stats.codeLines}`,
    `- Code files: ${stats.codeFiles}`,
    `- Formal review: ${stats.formalReviewRequired ? "required" : "not required"}`,
    ...review ? [`- Gate: ${review.waived ? "waived by the user" : review.satisfied ? "satisfied" : `pending (${[...review.missing.map((kind) => `${kind} missing`), ...review.stale.map((kind) => `${kind} stale`)].join(", ")})`}`] : [],
    ...(manifest.evidence.formalReviews ?? []).map((item) => `- Evidence: ${item.kind} via ${item.source}${item.agentType ? ` (${item.agentType})` : ""} at ${item.recordedAt}${item.blocking === null ? "" : `, ${item.blocking} blocking/${item.nonBlocking ?? 0} non-blocking`}`),
    "<!-- flow:auto:end -->"
  ].join("\n");
}
function updateWorklog(manifest, groups, stats, results, review = null) {
  const directory = join12(ARTIFACTS_ROOT, manifest.feature);
  const path = join12(directory, "worklog.md");
  const workspaces = [...new Set(manifest.targets.map((target) => target.workspace))];
  const projects = [...new Set(manifest.targets.map((target) => target.project).filter((project2) => Boolean(project2)))];
  const workspace = workspaces.length > 1 ? "cross-workspace" : workspaces[0] ?? "unknown";
  const project = projects.length > 1 ? "multiple" : projects[0] ?? "unknown";
  const block = automaticWorklogBlock(manifest, groups, stats, results, review);
  if (!existsSync15(path)) {
    writeFileAtomic(path, [
      "---",
      "artifact: worklog",
      "status: draft",
      `workspace: ${workspace}`,
      `project: ${project}`,
      `source: ${manifest.source.path}`,
      ...manifest.source.revision ? [`source_revision: ${manifest.source.revision}`] : [],
      "revision: 1",
      "---",
      "",
      "# Worklog",
      "",
      "## Goal",
      "",
      `Track implementation and verification for ${manifest.feature}.`,
      "",
      "## Active ticket or slice",
      "",
      `- Task: ${manifest.taskId}`,
      "",
      "## Contracts and invariants",
      "",
      "- None recorded.",
      "",
      "## Decisions",
      "",
      "- None recorded.",
      "",
      block,
      ""
    ].join("\n"));
    return path;
  }
  const current = readFileSync11(path, "utf8");
  const next = current.includes("<!-- flow:auto:start -->") ? current.replace(/<!-- flow:auto:start -->[\s\S]*?<!-- flow:auto:end -->/, block) : `${current.trimEnd()}

${block}
`;
  writeFileAtomic(path, next);
  return path;
}

// harness/src/policy/evaluator.ts
import { existsSync as existsSync20 } from "node:fs";
import { isAbsolute as isAbsolute2, join as join16, resolve as resolve13 } from "node:path";

// harness/src/task/isolation.ts
import { existsSync as existsSync16, lstatSync, readdirSync as readdirSync6, realpathSync, rmdirSync, symlinkSync, unlinkSync as unlinkSync2 } from "node:fs";
import { join as join13, relative as relative7, resolve as resolve11 } from "node:path";
function isolationBranch(feature) {
  return `agent/${feature}`;
}
function activeIsolation(manifest) {
  return manifest.isolation && !manifest.isolation.removedAt ? manifest.isolation : null;
}
function physicalWorkspaceRoot(manifest, workspace) {
  return resolve11(ROOT, activeIsolation(manifest)?.root ?? "", workspace);
}
function worktreePath(isolation, workspace) {
  return resolve11(ROOT, isolation.root, workspace);
}
function dependencyLinkShared(path) {
  let current = resolve11(path);
  const worktrees = resolve11(ROOT, WORKTREES_DIRECTORY);
  while (isWithin(worktrees, current) && current !== worktrees) {
    if (lstatSync(join13(current, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink()) return true;
    current = resolve11(current, "..");
  }
  return false;
}
function git(cwd, args2) {
  return run("git", ["-c", "core.longpaths=true", ...args2], { cwd });
}
function gitOutput(cwd, args2, failure) {
  const result = git(cwd, args2);
  if (result.code !== 0) throw new Error(`${failure}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}
function samePath(left, right) {
  const real = (path) => (existsSync16(path) ? realpathSync.native(path) : resolve11(path)).toLowerCase();
  return real(left) === real(right);
}
function branchExists(repository, branch) {
  return git(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0;
}
function unlinkDependencyJunction(worktree) {
  const link = join13(worktree, "node_modules");
  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) return;
  unlinkSync2(link);
  if (lstatSync(link, { throwIfNoEntry: false })) throw new Error(`Cannot unlink the shared node_modules junction at ${normalizePath(link)}`);
}
function containsFiles(directory) {
  if (!existsSync16(directory)) return false;
  return readdirSync6(directory, { withFileTypes: true }).some((entry) => !entry.isDirectory() || containsFiles(join13(directory, entry.name)));
}
function pruneEmptyDirectories(directory) {
  if (!existsSync16(directory)) return;
  for (const entry of readdirSync6(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirectories(join13(directory, entry.name));
  }
  if (!readdirSync6(directory).length) rmdirSync(directory);
}
function removeRepositories(root, branch, repositories, force) {
  const removal = { removed: [], deletedBranches: [], keptBranches: [] };
  for (const repository of repositories) {
    const source = resolve11(ROOT, repository.workspace);
    const worktree = resolve11(ROOT, root, repository.workspace);
    if (existsSync16(worktree)) {
      unlinkDependencyJunction(worktree);
      const removed = existsSync16(join13(worktree, ".git")) ? git(source, ["worktree", "remove", ...force ? ["--force"] : [], worktree]) : null;
      const message = removed ? (removed.stderr || removed.stdout).trim() : "";
      const deletionFailed = !removed || /failed to delete|Filename too long|Permission denied|Directory not empty/i.test(message);
      if (removed && removed.code !== 0 && containsFiles(worktree) && !deletionFailed) {
        throw new Error(`Cannot remove the ${repository.workspace} worktree: ${message}`);
      }
      if (!removed || removed.code !== 0) removePath(worktree);
      if (existsSync16(worktree)) throw new Error(`Cannot remove the ${repository.workspace} worktree: ${normalizePath(worktree)} is still locked; close editors or dev servers using it and retry`);
    }
    gitOutput(source, ["worktree", "prune"], `Cannot prune the ${repository.workspace} worktree metadata`);
    removal.removed.push(repository.workspace);
    if (!branchExists(source, branch)) continue;
    if (git(source, ["branch", force ? "-D" : "-d", branch]).code === 0) removal.deletedBranches.push(repository.workspace);
    else removal.keptBranches.push(repository.workspace);
  }
  pruneEmptyDirectories(resolve11(ROOT, root));
  return removal;
}
function createIsolation(feature, workspaces, existing = null) {
  const branch = existing?.branch ?? isolationBranch(feature);
  const root = existing?.root ?? `${WORKTREES_DIRECTORY}/${feature}`;
  const known = new Set(existing?.repositories.map((repository) => repository.workspace) ?? []);
  const created = [];
  const warnings = [];
  try {
    for (const workspace of [...new Set(workspaces)].filter((candidate) => !known.has(candidate))) {
      const source = resolve11(ROOT, workspace);
      const top = git(source, ["rev-parse", "--show-toplevel"]);
      if (top.code !== 0 || !samePath(top.stdout.trim(), source)) {
        throw new Error(`${workspace} is not the root of its own git repository; start the task with --no-isolate`);
      }
      const baseHead = gitOutput(source, ["rev-parse", "HEAD"], `Cannot resolve HEAD in ${workspace}`);
      const abbreviated = gitOutput(source, ["rev-parse", "--abbrev-ref", "HEAD"], `Cannot resolve the current branch in ${workspace}`);
      if (branchExists(source, branch)) throw new Error(`Branch ${branch} already exists in ${workspace}; run task cleanup ${feature} or choose another feature name`);
      const worktree = resolve11(ROOT, root, workspace);
      if (existsSync16(worktree)) throw new Error(`Worktree path already exists: ${normalizePath(relative7(ROOT, worktree))}`);
      gitOutput(source, ["worktree", "add", "-b", branch, worktree, baseHead], `Cannot create the ${workspace} worktree`);
      const repository = { workspace, baseHead, baseBranch: abbreviated === "HEAD" ? null : abbreviated };
      created.push(repository);
      const dirty = git(source, ["status", "--porcelain"]).stdout.split(/\r?\n/).filter(Boolean).length;
      if (dirty) warnings.push(`${workspace}: ${dirty} uncommitted change(s) in your checkout are not in ${branch}; the worktree starts from ${repository.baseBranch ?? "detached HEAD"}@${baseHead.slice(0, 8)}`);
      const dependencies = join13(source, "node_modules");
      if (existsSync16(dependencies)) symlinkSync(dependencies, join13(worktree, "node_modules"), "junction");
      else warnings.push(`${workspace}: your checkout has no node_modules, so Nx verification in the worktree fails until dependencies are installed`);
    }
  } catch (error) {
    try {
      removeRepositories(root, branch, created, true);
    } catch (cleanupError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    throw error;
  }
  return { isolation: { branch, root, repositories: [...existing?.repositories ?? [], ...created], removedAt: null }, warnings };
}
function removeIsolation(isolation, force) {
  if (!force) {
    const dirty = isolation.repositories.filter((repository) => {
      const worktree = worktreePath(isolation, repository.workspace);
      return existsSync16(worktree) && git(worktree, ["status", "--porcelain"]).stdout.trim().length > 0;
    }).map((repository) => repository.workspace);
    if (dirty.length) throw new Error(`Worktree has uncommitted changes in ${dirty.join(", ")}; commit them on ${isolation.branch} first, or rerun with --force to discard them`);
  }
  return removeRepositories(isolation.root, isolation.branch, isolation.repositories, force);
}

// harness/src/task/manifest.ts
import { closeSync as closeSync3, existsSync as existsSync18, openSync as openSync3, readFileSync as readFileSync13, readdirSync as readdirSync7, unlinkSync as unlinkSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join14, relative as relative8, resolve as resolve12 } from "node:path";

// harness/src/review/test-integrity.ts
import { existsSync as existsSync17, readFileSync as readFileSync12 } from "node:fs";
var TEST_INTEGRITY_STEP = "test-integrity";
var TEST_FILE = /(?:^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:Tests?|IT)\.(?:java|kt)$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$/;
var SKIP = /\b(?:describe|context|suite|it|test|specify)\s*\.\s*(?:skip|only|todo|fixme)\b|\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(|@(?:Disabled|Ignore)\b|@(?:pytest\.mark\.(?:skip|skipif|xfail)|unittest\.skip)\b|\bpytest\.skip\s*\(|\bt\.Skip(?:Now)?\s*\(/;
var DECLARATION = /^\s*(?:(?:it|test|specify)\s*(?:\.\s*\w+\s*)*\(|@Test\b|def\s+test_|func\s+Test\w*\s*\()/;
var ASSERTION = /\b(?:expect|assert\w*)\s*[.(]|\bassert\s|\.should\b/;
var COMMENT = /^\s*(?:\/\/+|#|\/?\*+)\s*/;
function isTestFile(path) {
  return TEST_FILE.test(path);
}
var normalize = (line) => line.trim().replace(/\s+/g, " ");
function scanTestDiff(file, added, removed) {
  const findings = [];
  const addedText = new Set(added.map(normalize));
  for (const line of added) {
    const comment = COMMENT.exec(line);
    const body = comment ? line.slice(comment[0].length) : null;
    if (body !== null && (DECLARATION.test(body) || ASSERTION.test(body))) findings.push({ file, kind: "commented-out", line: normalize(line) });
    else if (SKIP.test(line)) findings.push({ file, kind: "skipped", line: normalize(line) });
  }
  const removedDeclarations = removed.filter((line) => DECLARATION.test(line));
  if (removedDeclarations.length > added.filter((line) => DECLARATION.test(line)).length) {
    for (const line of removedDeclarations) if (!addedText.has(normalize(line))) findings.push({ file, kind: "test-removed", line: normalize(line) });
  }
  for (const line of removed) {
    if (!COMMENT.test(line) && ASSERTION.test(line) && !addedText.has(normalize(line))) findings.push({ file, kind: "assertion-changed", line: normalize(line) });
  }
  return findings;
}
function diffLines(group, change) {
  if (change.untracked) return { added: existsSync17(change.absolutePath) ? readFileSync12(change.absolutePath, "utf8").split(/\r?\n/) : [], removed: [] };
  const result = run("git", ["diff", "--unified=0", "--no-color", group.base ?? "HEAD", "--", change.path], { cwd: group.workspace.root });
  const lines = result.code === 0 ? result.stdout.split(/\r?\n/) : [];
  return {
    added: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)),
    removed: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).map((line) => line.slice(1))
  };
}
function collectTestIntegrity(groups) {
  return groups.flatMap((group) => group.changes.filter((change) => isTestFile(change.path)).flatMap((change) => {
    const { added, removed } = diffLines(group, change);
    return scanTestDiff(`${group.workspace.relativeRoot}/${change.path}`, added, removed);
  }));
}
var findingKey = (finding) => `${finding.file}|${finding.kind}|${finding.line}`;
function pendingTestIntegrity(manifest, findings) {
  const allowed = new Set((manifest.evidence.testIntegrity ?? []).flatMap((allowance) => allowance.findings));
  return findings.filter((finding) => !allowed.has(findingKey(finding)));
}
function testIntegrityAllowance(findings, reason) {
  return { recordedAt: (/* @__PURE__ */ new Date()).toISOString(), reason, findings: findings.map(findingKey) };
}
function testIntegrityResult(pending) {
  return {
    id: TEST_INTEGRITY_STEP,
    status: pending.length ? "failed" : "passed",
    cached: false,
    cacheMissReason: "not-cacheable",
    durationMs: 0,
    ...pending.length ? { output: testIntegrityReport(pending) } : {}
  };
}
function testIntegrityReport(pending) {
  return [
    `${pending.length} change(s) weaken the existing tests:`,
    ...pending.map((finding) => `  ${finding.kind.padEnd(17)} ${finding.file}: ${finding.line}`),
    "Fix the code instead, or restore the test. When the change is right (the spec changed the behaviour, the test is obsolete), tell the user the root cause and the reason for each line; only they can accept it, with `flow review allow-tests --task <feature> --reason <text>` in their own terminal."
  ].join("\n");
}

// harness/src/task/manifest.ts
var FEATURE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var TASK_PHASES = /* @__PURE__ */ new Set(["inspecting", "implementing", "verifying", "reviewing", "blocked", "completed"]);
var TASK_KEYS = /* @__PURE__ */ new Set(["schemaVersion", "manifestRevision", "taskId", "feature", "state", "phase", "source", "targets", "isolation", "baseline", "plan", "evidence", "taskHandoff", "startedAt", "lastSeenAt"]);
function taskManifestPath(feature) {
  return join14(ARTIFACTS_ROOT, slugify(feature), "task.json");
}
function sourceIdentity(source, explicitRevision) {
  const type = source === "conversation" ? "conversation" : /^[a-z]+:\/\//i.test(source) ? "external" : "artifact";
  const explicit = explicitRevision === void 0 || explicitRevision === null ? null : Number(explicitRevision);
  if (explicit !== null && (!Number.isInteger(explicit) || explicit < 1)) throw new Error(`Source revision must be a positive integer: ${explicitRevision}`);
  if (type !== "artifact") return { type, path: source, revision: explicit };
  const path = resolve12(ROOT, source);
  if (!existsSync18(path)) throw new Error(`Source artifact not found: ${source}`);
  const match = readFileSync13(path, "utf8").match(/^---\r?\n[\s\S]*?^revision:\s*([1-9]\d*)\s*$[\s\S]*?^---\s*$/m);
  if (!match?.[1]) throw new Error(`Source artifact revision not found: ${source}`);
  const actual = Number(match[1]);
  if (explicit !== null && explicit !== actual) throw new Error(`Source revision mismatch for ${source}: expected ${actual}, found ${explicit}`);
  return { type, path: source, revision: actual };
}
function workspaceHead(workspaceRoot) {
  const result = run("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot });
  return result.code === 0 ? result.stdout.trim() : null;
}
function processRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function acquireTaskLock(feature) {
  const path = join14(ARTIFACTS_ROOT, slugify(feature), ".task.lock");
  ensureDirectory(resolve12(path, ".."));
  const create = () => {
    const descriptor = openSync3(path, "wx");
    try {
      writeFileSync3(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: (/* @__PURE__ */ new Date()).toISOString() })}
`, "utf8");
    } finally {
      closeSync3(descriptor);
    }
  };
  try {
    create();
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const owner = readJson(path, {});
    const pid = Number(owner.pid);
    if (!Number.isInteger(pid) || pid <= 0 || processRunning(pid)) throw new Error(`Task manifest is being updated concurrently for ${feature}; retry the operation`);
    unlinkSync3(path);
    create();
  }
  return () => {
    const owner = readJson(path, {});
    if (existsSync18(path) && Number(owner.pid) === process.pid) unlinkSync3(path);
  };
}
function validateTaskManifest(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid task manifest ${path}: expected an object`);
  const unknown = Object.keys(value).filter((key) => !TASK_KEYS.has(key));
  if (unknown.length) throw new Error(`Invalid task manifest ${path}: unknown fields ${unknown.join(", ")}`);
  const manifest = value;
  if (manifest.schemaVersion !== 2 || !Number.isInteger(manifest.manifestRevision) || Number(manifest.manifestRevision) < 1) {
    throw new Error(`Invalid task manifest ${path}: unsupported schema or revision`);
  }
  if (!manifest.feature || manifest.taskId !== `feature:${manifest.feature}` || !FEATURE_PATTERN.test(manifest.feature)) {
    throw new Error(`Invalid task manifest ${path}: invalid task identity`);
  }
  if (!["active", "blocked", "completed"].includes(manifest.state ?? "") || !manifest.phase || !TASK_PHASES.has(manifest.phase) || !Array.isArray(manifest.targets) || !manifest.targets.length) {
    throw new Error(`Invalid task manifest ${path}: invalid state, phase, or targets`);
  }
  if (!manifest.targets.every((target) => target && typeof target.path === "string" && typeof target.workspace === "string")) {
    throw new Error(`Invalid task manifest ${path}: invalid target`);
  }
  if (!manifest.source || !["artifact", "conversation", "external"].includes(manifest.source.type) || typeof manifest.source.path !== "string" || manifest.source.revision !== null && (!Number.isInteger(manifest.source.revision) || Number(manifest.source.revision) < 1) || !manifest.baseline || typeof manifest.baseline.startedAt !== "string" || !manifest.baseline.workspaceHeads || !manifest.baseline.dirtyFiles || !manifest.plan || typeof manifest.plan.configFingerprint !== "string" || !Array.isArray(manifest.plan.verification) || !manifest.evidence || !Array.isArray(manifest.evidence.verification) || !manifest.taskHandoff || !["not-ready", "ready-for-verification", "blocked", "completed"].includes(manifest.taskHandoff.state) || typeof manifest.startedAt !== "string" || typeof manifest.lastSeenAt !== "string") {
    throw new Error(`Invalid task manifest ${path}: invalid source, baseline, plan, evidence, or handoff`);
  }
  const isolation = manifest.isolation;
  if (isolation !== void 0 && isolation !== null && (typeof isolation.branch !== "string" || typeof isolation.root !== "string" || !Array.isArray(isolation.repositories) || !isolation.repositories.every((repository) => repository && typeof repository.workspace === "string" && typeof repository.baseHead === "string") || isolation.removedAt !== null && typeof isolation.removedAt !== "string")) {
    throw new Error(`Invalid task manifest ${path}: invalid isolation`);
  }
  const formalReviews = manifest.evidence.formalReviews;
  if (formalReviews !== void 0 && (!Array.isArray(formalReviews) || !formalReviews.every((item) => item && ["code-review", "code-simplification", "waiver"].includes(item.kind) && ["subagent", "manual", "user"].includes(item.source) && typeof item.recordedAt === "string" && Number.isInteger(item.codeLines) && Number.isInteger(item.codeFiles) && Array.isArray(item.files)))) {
    throw new Error(`Invalid task manifest ${path}: invalid formal review evidence`);
  }
  const testIntegrity = manifest.evidence.testIntegrity;
  if (testIntegrity !== void 0 && (!Array.isArray(testIntegrity) || !testIntegrity.every((item) => item && typeof item.recordedAt === "string" && typeof item.reason === "string" && Array.isArray(item.findings)))) {
    throw new Error(`Invalid task manifest ${path}: invalid test-integrity allowances`);
  }
  delete manifest.evidence.reviews;
  return manifest;
}
function readTaskManifest(path) {
  try {
    return validateTaskManifest(JSON.parse(readFileSync13(path, "utf8")), path);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid task manifest ${path}: ${error.message}`);
    throw error;
  }
}
function loadTaskManifest(feature) {
  if (!feature) return null;
  const path = taskManifestPath(feature);
  return existsSync18(path) ? readTaskManifest(path) : null;
}
function requireTaskManifest(feature) {
  const manifest = loadTaskManifest(feature);
  if (!manifest) throw new Error(`Task manifest not found for ${feature}; run task start first`);
  return manifest;
}
function taskManifests() {
  const scratch = ARTIFACTS_ROOT;
  if (!existsSync18(scratch)) return [];
  return readdirSync7(scratch, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync18(join14(scratch, entry.name, "task.json"))).map((entry) => readTaskManifest(join14(scratch, entry.name, "task.json"))).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
function activeTaskManifests() {
  return taskManifests().filter((manifest) => manifest.state === "active");
}
function isolationGroup(feature, source) {
  if (!source || /^[a-z]+:\/\//i.test(source)) return feature;
  const match = normalizePath(relative8(ARTIFACTS_ROOT, resolve12(ROOT, source))).match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\//);
  return match?.[1] ?? feature;
}
function findSharedIsolation(root) {
  const tasks = taskManifests().filter((manifest) => manifest.isolation && !manifest.isolation.removedAt && manifest.isolation.root === root);
  const newest = tasks[0]?.isolation;
  if (!newest) return null;
  const repositories = /* @__PURE__ */ new Map();
  for (const task of tasks) for (const repository of task.isolation?.repositories ?? []) if (!repositories.has(repository.workspace)) repositories.set(repository.workspace, repository);
  return { isolation: { ...newest, repositories: [...repositories.values()] }, tasks };
}
function acquireTaskIsolation(feature, source, workspaces) {
  const group = isolationGroup(feature, source);
  const root = `${WORKTREES_DIRECTORY}/${group}`;
  const divergent = taskManifests().filter((task) => task.feature !== feature && task.isolation && !task.isolation.removedAt && task.isolation.root !== root && isolationGroup(task.feature, task.source.path) === group);
  if (divergent.length) {
    throw new Error(`${group} still has per-ticket worktrees from ${divergent.map((task) => task.taskId).join(", ")}; merge the latest one and run task cleanup for each before starting another ticket`);
  }
  const shared = findSharedIsolation(root);
  const holders = shared?.tasks.filter((task) => task.feature !== feature && task.state !== "completed") ?? [];
  if (holders.length) {
    throw new Error(`Worktree ${root} is still held by ${holders.map((task) => `${task.taskId} (${task.state}/${task.phase})`).join(", ")}; finish that task before starting another ticket of ${group}`);
  }
  const created = createIsolation(group, workspaces, shared?.isolation ?? null);
  const previous = new Set(shared?.isolation.repositories.map((repository) => repository.workspace) ?? []);
  const added = { ...created.isolation, repositories: created.isolation.repositories.filter((repository) => !previous.has(repository.workspace)) };
  const warnings = [...created.warnings];
  if (shared) warnings.push(`Reusing ${root} on ${created.isolation.branch} from ${shared.tasks.map((task) => task.taskId).join(", ")}; uncommitted work from earlier tickets belongs to this task's baseline`);
  return { isolation: created.isolation, warnings, rollback: () => {
    if (added.repositories.length) removeIsolation(added, true);
  } };
}
function findActiveTaskForTarget(target) {
  return activeTaskManifests().find((manifest) => manifest.targets.some((registered) => isWithin(resolve12(ROOT, registered.path), target))) ?? null;
}
function findIsolatedTaskForUserPath(target) {
  for (const manifest of activeTaskManifests()) {
    const isolation = activeIsolation(manifest);
    if (!isolation) continue;
    const owned = manifest.targets.some((registered) => isWithin(resolve12(ROOT, logicalRelativePath(registered.path)), target));
    if (owned) return { manifest, redirect: resolve12(ROOT, isolation.root, relative8(ROOT, target)) };
  }
  return null;
}
function startTaskManifest(input) {
  const feature = slugify(input.feature);
  if (!feature || feature !== input.feature || !FEATURE_PATTERN.test(input.feature)) throw new Error(`Feature must be English kebab-case: ${input.feature || "<missing>"}`);
  const release = acquireTaskLock(feature);
  try {
    const existing = loadTaskManifest(feature);
    if (existing && existing.state !== "completed" && !existing.isolation?.removedAt) throw new Error(`Feature ${feature} already has an active task in phase ${existing.phase}`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const targets = [];
    const dirtyFiles = {};
    const workspaceHeads = {};
    const verification = /* @__PURE__ */ new Map();
    const isolation = input.isolation ?? null;
    for (const inspection of input.inspections) {
      const target = { path: normalizePath(inspection.target), workspace: inspection.workspace.root, project: inspection.project?.name ?? null };
      if (!targets.some((item) => item.path === target.path && item.workspace === target.workspace && item.project === target.project)) targets.push(target);
      const workspaceRoot = physicalWorkspaceRoot({ isolation }, target.workspace);
      workspaceHeads[target.workspace] ??= workspaceHead(workspaceRoot);
      for (const change of inspection.changes.files) {
        const key = `${target.workspace}/${normalizePath(change.path)}`;
        if (dirtyFiles[key]) continue;
        dirtyFiles[key] = {
          fingerprint: fileHash([resolve12(workspaceRoot, change.path)]),
          status: change.status,
          recordedAt: now
        };
      }
      for (const step of inspection.verification) verification.set(step.id, step);
    }
    const manifest = {
      schemaVersion: 2,
      manifestRevision: (existing?.manifestRevision ?? 0) + 1,
      taskId: `feature:${feature}`,
      feature,
      state: "active",
      phase: "inspecting",
      source: sourceIdentity(input.source ?? "conversation", input.sourceRevision),
      targets,
      ...isolation ? { isolation } : {},
      baseline: { startedAt: now, workspaceHeads, dirtyFiles },
      plan: { configFingerprint: configFingerprint(), verification: [...verification.values()] },
      evidence: { verification: [], lastChangeSnapshotAt: null },
      taskHandoff: { state: "not-ready", reason: null, updatedAt: now },
      startedAt: now,
      lastSeenAt: now
    };
    writeJsonAtomic(taskManifestPath(feature), manifest);
    return manifest;
  } finally {
    release();
  }
}
function updateTaskManifest(feature, update) {
  const release = acquireTaskLock(feature);
  try {
    const path = taskManifestPath(feature);
    const current = requireTaskManifest(feature);
    const expectedRevision = current.manifestRevision;
    const next = update(structuredClone(current));
    next.schemaVersion = 2;
    next.manifestRevision = expectedRevision + 1;
    next.lastSeenAt = (/* @__PURE__ */ new Date()).toISOString();
    const latest = requireTaskManifest(feature);
    if (latest.manifestRevision !== expectedRevision) throw new Error(`Task manifest revision changed while updating ${feature}; expected ${expectedRevision}, found ${latest.manifestRevision}`);
    writeJsonAtomic(path, next);
    return next;
  } finally {
    release();
  }
}
function recordInspection(feature, verification) {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === "completed") throw new Error(`Task ${manifest.taskId} is completed`);
    if (manifest.state === "blocked") throw new Error(`Task ${manifest.taskId} is blocked: ${manifest.taskHandoff.reason ?? "no reason recorded"}`);
    manifest.state = "active";
    manifest.phase = "implementing";
    manifest.plan.configFingerprint = configFingerprint();
    manifest.plan.verification = verification;
    manifest.taskHandoff = { state: "not-ready", reason: null, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return manifest;
  });
}
function setTaskHandoff(feature, handoff, reason = null) {
  return updateTaskManifest(feature, (manifest) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (manifest.state === "completed" && handoff !== "completed") throw new Error(`Task ${manifest.taskId} is completed`);
    if (handoff === "ready-for-verification" && !Array.isArray(manifest.plan.verification)) throw new Error("Task has no persisted verification plan");
    if (handoff === "ready-for-verification" && manifest.phase !== "implementing") throw new Error(`Task ${manifest.taskId} must be in implementing phase before verification handoff`);
    manifest.taskHandoff = { state: handoff, reason, updatedAt: now };
    if (handoff === "blocked") {
      manifest.state = "blocked";
      manifest.phase = "blocked";
    } else if (handoff === "completed") {
      if (manifest.phase === "reviewing") throw new Error(`Task ${manifest.taskId} passed verification but lacks formal code-review/code-simplification evidence; run the review, then verify --task again`);
      if (manifest.state !== "completed") throw new Error("Task completion is produced by successful verification; run verify --task first");
      if (!manifest.evidence.lastChangeSnapshotAt) throw new Error("Cannot complete a task before verification records the current change snapshot");
      if (manifest.evidence.verification.some((item) => item.status !== "passed")) throw new Error("Cannot complete a task with failed verification evidence");
      manifest.phase = "completed";
    } else {
      manifest.state = "active";
      manifest.phase = handoff === "ready-for-verification" ? "verifying" : "implementing";
    }
    return manifest;
  });
}
function beginVerification(feature) {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === "blocked") throw new Error(`Task ${manifest.taskId} is blocked: ${manifest.taskHandoff.reason ?? "no reason recorded"}`);
    if (manifest.state === "completed") throw new Error(`Task ${manifest.taskId} is completed`);
    manifest.phase = "verifying";
    manifest.taskHandoff = { state: "ready-for-verification", reason: null, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return manifest;
  });
}
function recordFormalReview(feature, evidence) {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === "completed") throw new Error(`Task ${manifest.taskId} is completed; formal review evidence can no longer change it`);
    manifest.evidence.formalReviews = [...manifest.evidence.formalReviews ?? [], evidence];
    return manifest;
  });
}
function recordTestIntegrityAllowance(feature, allowance) {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === "completed") throw new Error(`Task ${manifest.taskId} is completed; test-integrity allowances can no longer change it`);
    manifest.evidence.testIntegrity = [...manifest.evidence.testIntegrity ?? [], allowance];
    return manifest;
  });
}
function recordVerification(feature, results, expectedRevision, reviewGate) {
  return updateTaskManifest(feature, (manifest) => {
    if (expectedRevision !== void 0 && manifest.manifestRevision !== expectedRevision) {
      throw new Error(`Task manifest changed during verification; expected revision ${expectedRevision}, found ${manifest.manifestRevision}`);
    }
    if (!results.length) throw new Error("Cannot record verification without at least one verification or no-applicable-steps result");
    const expected = manifest.plan.verification.map((step) => step.id).sort();
    const actual = results.filter((result) => result.id !== TEST_INTEGRITY_STEP).map((result) => result.id).sort();
    const complete = expected.length ? expected.length === actual.length && expected.every((id, index) => id === actual[index]) : actual.length === 1 && actual[0] === "task-scope:no-applicable-steps";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    manifest.evidence.verification = results.map((result) => ({ status: result.status, step: result.id, verifiedAt: now, cached: result.cached }));
    manifest.evidence.lastChangeSnapshotAt = now;
    const passed = complete && results.every((result) => result.status === "passed");
    const reviewPending = passed && reviewGate !== void 0 && !reviewGate.satisfied;
    const done = passed && !reviewPending;
    manifest.state = done ? "completed" : "active";
    manifest.phase = done ? "completed" : reviewPending ? "reviewing" : "implementing";
    const reason = done ? null : reviewPending ? "formal-review-required" : complete ? "verification-failed" : "verification-incomplete";
    manifest.taskHandoff = { state: done ? "completed" : "not-ready", reason, updatedAt: now };
    return manifest;
  });
}

// harness/src/review/gate.ts
import { existsSync as existsSync19 } from "node:fs";
import { join as join15 } from "node:path";
var FORMAL_REVIEW_KINDS = ["code-review", "code-simplification"];
var REVIEW_AGENTS = {
  "flow:code-reviewer": "code-review",
  "flow:code-simplifier": "code-simplification"
};
var STALE_EXTRA_CODE_LINES = 100;
var STALE_UNCOVERED_CODE_FILES = 5;
var MAX_STOP_BLOCKS = 2;
var REVIEWER_RUN_WINDOW_MS = 30 * 60 * 1e3;
var SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var RESULT_MARKER = /FLOW-REVIEW-RESULT\s+task=([a-z0-9]+(?:-[a-z0-9]+)*)\s+blocking=(\d+)\s+non-blocking=(\d+)/;
function codeFileKeys(groups) {
  return groups.flatMap((group) => group.changes.filter((change) => change.isCode).map((change) => `${group.workspace.relativeRoot}/${change.path}`));
}
function isStale(evidence, stats, files) {
  const covered = new Set(evidence.files);
  const uncovered = files.filter((file) => !covered.has(file)).length;
  return stats.codeLines > evidence.codeLines + STALE_EXTRA_CODE_LINES || uncovered > STALE_UNCOVERED_CODE_FILES;
}
function evaluateReviewGate(manifest, stats, files) {
  if (!stats.formalReviewRequired) return { required: false, satisfied: true, waived: false, missing: [], stale: [] };
  const evidence = manifest.evidence.formalReviews ?? [];
  if (evidence.some((item) => item.kind === "waiver")) return { required: true, satisfied: true, waived: true, missing: [], stale: [] };
  const missing = [];
  const stale = [];
  for (const kind of FORMAL_REVIEW_KINDS) {
    const latest = evidence.filter((item) => item.kind === kind).at(-1);
    if (!latest) missing.push(kind);
    else if (isStale(latest, stats, files)) stale.push(kind);
  }
  return { required: true, satisfied: !missing.length && !stale.length, waived: false, missing, stale };
}
function reviewGateSummary(gate, stats) {
  const size = `${stats.codeLines} code lines, ${stats.codeFiles} code files`;
  if (!gate.required) return `REVIEW not required (${size})`;
  if (gate.waived) return `REVIEW waived by the user (${size})`;
  if (gate.satisfied) return `REVIEW satisfied: code-review and code-simplification evidence recorded (${size})`;
  const pending = [...gate.missing.map((kind) => `${kind} missing`), ...gate.stale.map((kind) => `${kind} stale`)].join(", ");
  return `REVIEW REQUIRED (${size}): ${pending}. ${reviewInstruction()}`;
}
function reviewInstruction() {
  return "Claude Code: spawn the flow:code-reviewer and flow:code-simplifier subagents in one message (Agent tool, subagent_type set to each name) with the task slug; their SubagentStop hook records the evidence. Other hosts: run each formal skill once, then `flow review record --task <feature> --kind <kind>`. Apply valid findings, then rerun `verify --task <feature>`.";
}
function reviewEvidence(input) {
  return {
    kind: input.kind,
    source: input.source,
    agentType: input.agentType ?? null,
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    codeLines: input.stats.codeLines,
    codeFiles: input.stats.codeFiles,
    files: input.files,
    blocking: input.blocking ?? null,
    nonBlocking: input.nonBlocking ?? null,
    reason: input.reason ?? null
  };
}
function parseReviewResult(message) {
  const match = RESULT_MARKER.exec(message);
  return match ? { feature: match[1], blocking: Number(match[2]), nonBlocking: Number(match[3]) } : null;
}
function sessionPath(sessionId) {
  return SESSION_PATTERN.test(sessionId) ? join15(SCRATCH_ROOT, "sessions", `${sessionId}.json`) : null;
}
function readSession(sessionId) {
  const path = sessionPath(sessionId);
  const empty = { features: [], stopBlocks: {}, running: [], updatedAt: (/* @__PURE__ */ new Date(0)).toISOString() };
  return path && existsSync19(path) ? { ...empty, ...readJson(path, {}) } : empty;
}
function writeSession(sessionId, state) {
  const path = sessionPath(sessionId);
  if (path) writeJsonAtomic(path, { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function bindSessionTask(sessionId, feature) {
  const state = readSession(sessionId);
  if (state.features.includes(feature)) return;
  writeSession(sessionId, { ...state, features: [...state.features, feature] });
}
function markReviewerStarted(sessionId, agentType) {
  const state = readSession(sessionId);
  writeSession(sessionId, { ...state, running: [...state.running, { agentType, startedAt: (/* @__PURE__ */ new Date()).toISOString() }] });
}
function markReviewerStopped(sessionId, agentType) {
  const state = readSession(sessionId);
  const index = state.running.findIndex((item) => item.agentType === agentType);
  if (index < 0) return;
  writeSession(sessionId, { ...state, running: state.running.filter((_, position) => position !== index) });
}
function commandTaskFeature(command2) {
  if (!/\bflow(?:\.mjs|\.cmd)?\b/.test(command2)) return null;
  const match = /--task\s+([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(command2) ?? /\btask\s+(?:start|status|handoff|block|complete)\s+([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(command2);
  return match?.[1] ?? null;
}
function hasRecordedReviews(manifest) {
  const evidence = manifest.evidence.formalReviews ?? [];
  return evidence.some((item) => item.kind === "waiver") || FORMAL_REVIEW_KINDS.every((kind) => evidence.some((item) => item.kind === kind));
}
function evaluateStop(sessionId, manifests) {
  const state = readSession(sessionId);
  const pending = manifests.filter((manifest) => state.features.includes(manifest.feature) && manifest.state === "active" && manifest.phase === "reviewing" && !hasRecordedReviews(manifest));
  if (!pending.length) return { decision: "allow", message: null };
  const now = Date.now();
  if (state.running.some((item) => now - Date.parse(item.startedAt) < REVIEWER_RUN_WINDOW_MS)) return { decision: "allow", message: null };
  const exhausted = pending.filter((manifest) => (state.stopBlocks[`${manifest.feature}@${manifest.manifestRevision}`] ?? 0) >= MAX_STOP_BLOCKS);
  const blocking = pending.filter((manifest) => !exhausted.includes(manifest));
  if (!blocking.length) {
    return { decision: "allow", message: `flow: ${exhausted.map((manifest) => manifest.feature).join(", ")} passed verification but still lacks formal review evidence; the task stays incomplete until code-review and code-simplification run.` };
  }
  const stopBlocks = { ...state.stopBlocks };
  for (const manifest of blocking) {
    const key = `${manifest.feature}@${manifest.manifestRevision}`;
    stopBlocks[key] = (stopBlocks[key] ?? 0) + 1;
  }
  writeSession(sessionId, { ...state, stopBlocks });
  return {
    decision: "block",
    reason: `flow formal review gate: ${blocking.map((manifest) => manifest.feature).join(", ")} passed verification but the change exceeds the review threshold and has no current code-review/code-simplification evidence. ${reviewInstruction()} If the user has explicitly declined the review, stop and tell them only they can waive it with \`flow review waive --task <feature> --reason <text>\` in their own terminal.`
  };
}

// harness/src/policy/shell.ts
var SHELL_INTERPRETER = /^(?:\S*[\\/])?(?:(?:ba|z|da)?sh|pwsh|powershell|cmd)(?:\.exe)?$/i;
function withoutHeredocData(command2) {
  return command2.replace(
    /^([^\n]*?)<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\2([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/gm,
    (match, head, _quote, tag2, rest) => SHELL_INTERPRETER.test(head.trim().split(/\s+/)[0] ?? "") ? match : `${head}<<${tag2}${rest}`
  );
}
function splitSegments(command2) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command2.length; index += 1) {
    const char = command2[index];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"' && index + 1 < command2.length) current += command2[++index];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\\" && index + 1 < command2.length) {
      current += char + command2[++index];
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";" || char === "&" || char === "|" || char === "\n") {
      segments.push(current);
      current = "";
      if ((char === "&" || char === "|") && command2[index + 1] === char) index += 1;
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.replace(/\r$/, ""));
}
var SHELL_COMMAND_FLAG = /^(?:-l?c|-command|\/c)$/i;
function withWrappedCommands(segments) {
  return segments.flatMap((segment) => {
    const tokens = shellTokens(segment.trim());
    const flag = tokens.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
    if (!SHELL_INTERPRETER.test(tokens[0] ?? "") || flag < 0) return [segment];
    return [segment, ...withWrappedCommands(splitSegments(tokens.slice(flag + 1).join(" ")))];
  });
}
var SHELL_TOKEN = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
function shellWords(segment) {
  return [...segment.matchAll(SHELL_TOKEN)].map((token) => ({ text: token[1] ?? token[2] ?? token[3] ?? "", quoted: token[3] === void 0 }));
}
var shellTokens = (segment) => shellWords(segment).map((word) => word.text);

// harness/src/policy/evaluator.ts
var DEPENDENCY_MUTATION = /\b(?:(?:npm(?:\.cmd)?\s+(?:i|install|ci|add|uninstall|remove|rm|update|up|dedupe|prune)|pnpm(?:\.cmd)?\s+(?:i|install|add|remove|update)|yarn(?:\.cmd)?\s+(?:install|add|remove|upgrade))(?=\s|$)|yarn(?:\.cmd)?\s*$)/i;
var escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var nameAlternation = (names2) => names2.map(escapeRegExp).join("|");
function executablePattern(names2) {
  return new RegExp(`^(?:\\S*[\\\\/])?(?:${nameAlternation(names2)})(?:\\.exe|\\.cmd)?$`, "i");
}
function callArguments(segment, executable2) {
  const words = shellWords(segment);
  const index = words.findIndex((word) => !word.quoted && executable2.test(word.text));
  return index < 0 ? null : words.slice(index + 1).map((word) => word.text);
}
var fromGitBashPath = (path) => path.replace(/^\/([a-z])(?=\/|$)/i, (_match, drive) => `${drive.toUpperCase()}:`);
function unitCommandOutsideRoot(segments, cwd, names2) {
  if (!names2.length) return false;
  const executable2 = executablePattern(names2);
  const substitution = new RegExp(`(?:\\$\\(|\`)\\s*(?:${nameAlternation(names2)})(?:\\.cmd|\\.exe)?(?=\\s|[\`)]|$)`, "i");
  let effectiveCwd = cwd;
  const outsideRoot = () => {
    const workspace = findWorkspace(effectiveCwd);
    return !workspace || resolve13(workspace.root) !== resolve13(effectiveCwd);
  };
  for (const segment of segments) {
    const tokens = shellTokens(segment.trim().replace(/^\(+\s*/, ""));
    while (/^[A-Za-z_]\w*=/.test(tokens[0] ?? "")) tokens.shift();
    if (tokens[0] === "timeout") tokens.splice(0, 2);
    const first = tokens[0] ?? "";
    if (first === "cd") {
      effectiveCwd = resolve13(effectiveCwd, fromGitBashPath(tokens[1] ?? "."));
      continue;
    }
    if (SHELL_INTERPRETER.test(first)) {
      const flag = tokens.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
      if (flag > 0 && unitCommandOutsideRoot(splitSegments(tokens.slice(flag + 1).join(" ")), effectiveCwd, names2)) return true;
      continue;
    }
    if ((executable2.test(first) || substitution.test(segment)) && outsideRoot()) return true;
  }
  return false;
}
var GIT = executablePattern(["git"]);
function gitPush(segment) {
  const tokens = callArguments(segment, GIT);
  if (!tokens) return false;
  let index = 0;
  let pushAlias = false;
  while (index < tokens.length && tokens[index]?.startsWith("-")) {
    const option2 = tokens[index] ?? "";
    if (option2 === "-c" && /^alias\.[^=]+=.*\bpush\b/i.test(tokens[index + 1] ?? "")) pushAlias = true;
    index += ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"].includes(option2) ? 2 : 1;
  }
  return pushAlias || tokens[index]?.toLowerCase() === "push";
}
function readOnlyViolation(segment, cli, rule) {
  const tokens = callArguments(segment, executablePattern([cli]));
  if (!tokens) return false;
  const valueOptions = new Set(rule.valueOptions ?? []);
  const words = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("-")) words.push(token.toLowerCase());
    else if (valueOptions.has(token)) index += 1;
  }
  return !rule.allow.some((entry) => {
    const allowed = entry.toLowerCase().split(/\s+/).filter(Boolean);
    return allowed.length > 0 && allowed.every((word, index) => words[index] === word);
  });
}
var MUTATION_TOOLS = { write: true, edit: true };
var CACHE_INVALIDATION_TOOLS = { write: true, edit: true, bash: true };
var FORMAT_EXTENSIONS = /\.(?:ts|html|scss|css|json|jsonc|js|mjs|cjs)$/i;
var EVENT_KEYS = /* @__PURE__ */ new Set(["schemaVersion", "type", "host", "toolName", "cwd", "command", "targets", "task", "isError", "failureClass", "sessionId"]);
var REVIEW_RECORD = /\bflow(?:\.mjs|\.cmd)?\s+review\s+record\b/;
var REVIEW_WAIVE = /\bflow(?:\.mjs|\.cmd)?\s+review\s+waive\b/;
var ALLOW_TESTS = /\bflow(?:\.mjs|\.cmd)?\s+review\s+allow-tests\b/;
var EVENT_TYPES = { "tool-call": true, "tool-result": true, "session-start": true, "session-compact": true };
var EVENT_HOSTS = { claude: true, manual: true };
function validatePolicyEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Policy event must be an object");
  const event = value;
  const unknown = Object.keys(value).filter((key) => !EVENT_KEYS.has(key));
  if (unknown.length) throw new Error(`Policy event has unknown fields: ${unknown.join(", ")}`);
  if (event.schemaVersion !== 1 || !event.type || !(event.type in EVENT_TYPES) || !event.host || !(event.host in EVENT_HOSTS) || typeof event.cwd !== "string" || !event.cwd) throw new Error("Policy event has an invalid schemaVersion, type, host, or cwd");
  if ((event.type === "tool-call" || event.type === "tool-result") && (typeof event.toolName !== "string" || !event.toolName)) {
    throw new Error("Tool policy events require toolName");
  }
  if (event.toolName) event.toolName = event.toolName.toLowerCase();
  if (event.type === "tool-call" && event.toolName === "bash" && (typeof event.command !== "string" || !event.command)) {
    throw new Error("Bash tool-call events require command");
  }
  if (event.command !== void 0 && typeof event.command !== "string") throw new Error("Policy event command must be a string");
  if (event.task !== void 0 && event.task !== null && typeof event.task !== "string") throw new Error("Policy event task must be a string or null");
  if (event.failureClass !== void 0 && event.failureClass !== null && typeof event.failureClass !== "string") throw new Error("Policy event failureClass must be a string or null");
  if (event.type === "tool-call" && (event.toolName === "write" || event.toolName === "edit") && (!Array.isArray(event.targets) || !event.targets.length || !event.targets.every((target) => typeof target === "string" && target.length > 0))) {
    throw new Error("Write and edit tool-call events require targets");
  }
  if (event.targets !== void 0 && (!Array.isArray(event.targets) || !event.targets.every((target) => typeof target === "string"))) throw new Error("Policy event targets must be strings");
  if (event.isError !== void 0 && typeof event.isError !== "boolean") throw new Error("Policy event isError must be boolean");
  if (event.sessionId !== void 0 && event.sessionId !== null && typeof event.sessionId !== "string") throw new Error("Policy event sessionId must be a string or null");
  return event;
}
function absoluteTarget(target, cwd) {
  if (!target || target.includes("://") || /\.(?:zip|jar|war|ear|apk|tar|tgz|tar\.gz):/i.test(target)) return null;
  return isAbsolute2(target) ? resolve13(target) : resolve13(cwd, target);
}
function taskForTarget(feature, target) {
  const manifest = feature ? loadTaskManifest(feature) : findActiveTaskForTarget(target);
  if (!manifest || manifest.state !== "active") return null;
  return manifest.targets.some((registered) => isWithin(resolve13(ROOT, registered.path), target)) ? manifest : null;
}
function evaluatePolicy(event) {
  const messages = [];
  const effects = [];
  let decision = "allow";
  if (event.type === "tool-call" && event.command) {
    const commandSegments = splitSegments(withoutHeredocData(event.command));
    const calls = withWrappedCommands(commandSegments);
    if (calls.some(gitPush)) {
      decision = "block";
      messages.push("flow policy blocks git push; the developer pushes branches.");
    }
    const policy = loadConfig().policy ?? {};
    for (const rule of policy.blockedCommands ?? []) {
      const pattern = new RegExp(rule.pattern);
      if (!calls.some((segment) => pattern.test(segment))) continue;
      decision = "block";
      messages.push(rule.message);
    }
    for (const [cli, rule] of Object.entries(policy.readOnlyCli ?? {})) {
      if (!calls.some((segment) => readOnlyViolation(segment, cli, rule))) continue;
      decision = "block";
      messages.push(`flow policy permits only these ${cli} commands: ${rule.allow.join(", ")}.`);
    }
    if (calls.some((segment) => DEPENDENCY_MUTATION.test(segment)) && dependencyLinkShared(event.cwd)) {
      decision = "block";
      messages.push("This worktree shares node_modules with the user's checkout through a junction; installing here would rewrite the user's dependencies. Ask the user before changing dependencies.");
    }
    if (event.host === "claude" && REVIEW_RECORD.test(event.command)) {
      decision = "block";
      messages.push("Claude Code records formal review evidence only from the flow:code-reviewer and flow:code-simplifier subagents; spawn them with the Agent tool instead of recording evidence by hand.");
    }
    if (event.host === "claude" && REVIEW_WAIVE.test(event.command)) {
      decision = "block";
      messages.push("Only the user can waive formal review. Ask them to run `flow review waive --task <feature> --reason <text>` in their own terminal.");
    }
    if (event.host === "claude" && ALLOW_TESTS.test(event.command)) {
      decision = "block";
      messages.push("Only the user can accept skipped, removed or weakened tests. Give them the root cause and the reason for each test-integrity finding, and ask them to run `flow review allow-tests --task <feature> --reason <text>` in their own terminal.");
    }
    const unitRootOnly = policy.unitRootOnly ?? [];
    if (unitCommandOutsideRoot(commandSegments, event.cwd, unitRootOnly)) {
      decision = "block";
      messages.push(`Run ${unitRootOnly.join(", ")} from the owning unit root (\`cd <unit root> && \u2026\`).`);
    }
  }
  if (event.type === "tool-call" && event.toolName && MUTATION_TOOLS[event.toolName]) {
    const productionTargets = (event.targets ?? []).map((target) => absoluteTarget(target, event.cwd)).filter((target) => Boolean(target)).filter((target) => Boolean(findWorkspace(target)));
    const ownership = productionTargets.map((target) => ({ target, manifest: taskForTarget(event.task, target) }));
    const verifying = ownership.filter((item) => item.manifest?.phase === "verifying");
    if (verifying.length) {
      decision = "block";
      messages.push(`Production mutation is blocked while task verification owns its snapshot: ${verifying.map((item) => item.target).join(", ")}. If no verify is running (it was stopped or crashed), release it with \`flow task handoff ${verifying[0]?.manifest?.feature} --to not-ready\`.`);
    }
    const redirected = ownership.filter((item) => !item.manifest).map((item) => ({ target: item.target, isolated: findIsolatedTaskForUserPath(item.target) })).filter((item) => Boolean(item.isolated));
    if (redirected.length) {
      decision = "block";
      messages.push(...redirected.map((item) => `Task ${item.isolated.manifest.feature} runs in an isolated worktree on ${item.isolated.manifest.isolation?.branch}; the user's checkout is off-limits. Edit ${normalizePath(item.isolated.redirect)} instead of ${normalizePath(item.target)}.`));
    }
    const unowned = ownership.filter((item) => !item.manifest && !redirected.some((entry) => entry.target === item.target)).map((item) => item.target);
    if (unowned.length && decision !== "block") {
      decision = "warn";
      messages.push(`Production mutation has no matching active task target: ${unowned.join(", ")}`);
    }
  }
  if (event.type === "tool-result" && event.toolName && CACHE_INVALIDATION_TOOLS[event.toolName]) effects.push("invalidate-verification-cache");
  if (event.type === "tool-result" && !event.isError && event.toolName && MUTATION_TOOLS[event.toolName]) effects.push("format-targets");
  if (event.type === "tool-result" && event.isError) effects.push("record-failure");
  if (event.type === "tool-result" && !event.isError && event.sessionId && event.command && commandTaskFeature(event.command)) effects.push("bind-session");
  if ((event.type === "session-start" || event.type === "session-compact") && event.task) effects.push("touch-task");
  return { schemaVersion: 1, decision, messages, effects };
}
function handlePolicyEvent(event) {
  const result = evaluatePolicy(event);
  for (const effect of result.effects) {
    if (effect === "invalidate-verification-cache") clearVerificationCache();
    if (effect === "bind-session" && event.sessionId && event.command) {
      const feature = commandTaskFeature(event.command);
      if (feature && loadTaskManifest(feature)) bindSessionTask(event.sessionId, feature);
    }
    if (effect === "touch-task" && event.task) updateTaskManifest(event.task, (manifest) => manifest);
    if (effect === "format-targets") {
      for (const rawTarget of event.targets ?? []) {
        if (!FORMAT_EXTENSIONS.test(rawTarget)) continue;
        const target = absoluteTarget(rawTarget, event.cwd);
        if (!target || !existsSync20(target)) continue;
        const workspace = findWorkspace(target);
        if (!workspace) continue;
        const prettier = join16(workspace.root, "node_modules", "prettier", "bin-prettier.js");
        if (existsSync20(prettier)) run("node", [prettier, "--write", "--ignore-unknown", target], { cwd: workspace.root });
      }
    }
    if (effect === "record-failure") {
      recordTelemetry({
        eventType: "tool.failed",
        ...event.toolName ? { command: event.toolName } : {},
        status: "failed",
        ...event.task ? { feature: event.task } : {},
        exitClass: event.failureClass ?? "tool-failure"
      });
    }
  }
  recordTelemetry({
    eventType: `policy.${event.type}`,
    ...event.toolName ?? event.command ? { command: event.toolName ?? event.command } : {},
    status: result.decision,
    ...event.task ? { feature: event.task } : {},
    exitClass: result.decision === "block" ? "policy-block" : null
  });
  return result;
}

// harness/src/policy/claude-hook.ts
var denyTool = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
function claudePolicyHook(payload) {
  const hookEventName = String(payload.hook_event_name ?? "PreToolUse");
  const rawTool = String(payload.tool_name ?? "").toLowerCase();
  const toolName = rawTool === "powershell" ? "bash" : rawTool === "multiedit" || rawTool === "notebookedit" ? "edit" : rawTool;
  const hookName = hookEventName.toLowerCase();
  const eventType = hookName.includes("sessionstart") ? "session-start" : hookName.includes("compact") ? "session-compact" : hookName.includes("post") ? "tool-result" : "tool-call";
  const input = payload.tool_input ?? {};
  const directTarget = String(input.file_path ?? input.notebook_path ?? input.path ?? "");
  let result;
  try {
    result = handlePolicyEvent(validatePolicyEvent({
      schemaVersion: 1,
      type: eventType,
      host: "claude",
      ...toolName ? { toolName } : {},
      cwd: String(input.cwd ?? payload.cwd ?? process.cwd()),
      ...toolName === "bash" ? { command: String(input.command ?? "") } : {},
      targets: toolName === "write" || toolName === "edit" ? [directTarget].filter(Boolean) : [],
      task: process.env.FLOW_TASK ?? null,
      isError: hookName.includes("failure") || Boolean(payload.tool_response?.is_error),
      sessionId: typeof payload.session_id === "string" ? payload.session_id : null
    }));
  } catch {
    if (eventType === "tool-call") return denyTool("flow policy could not evaluate the tool call.");
    if (eventType === "tool-result" || eventType === "session-start") return { hookSpecificOutput: { hookEventName, additionalContext: "flow non-safety hook processing was unavailable; execution continues." } };
    return null;
  }
  const message = result.messages.join("; ");
  if (eventType === "tool-call") {
    if (result.decision === "block") return denyTool(message);
    return message ? { hookSpecificOutput: { hookEventName, additionalContext: message } } : null;
  }
  if (eventType === "tool-result" && result.decision === "block") return { decision: "block", reason: message };
  if (!message) return null;
  return eventType === "session-compact" ? { systemMessage: message } : { hookSpecificOutput: { hookEventName, additionalContext: message } };
}

// harness/src/review/claude-hook.ts
import { readFileSync as readFileSync14 } from "node:fs";
import { join as join17 } from "node:path";
var REVIEW_HOOK_EVENTS = { Stop: "stop", SubagentStart: "subagent-start", SubagentStop: "subagent-stop" };
function handbackMessage(payload) {
  const path = typeof payload.agent_transcript_path === "string" ? payload.agent_transcript_path : typeof payload.transcript_path === "string" && typeof payload.agent_id === "string" ? join17(payload.transcript_path.replace(/\.jsonl$/, ""), "subagents", `agent-${payload.agent_id}.jsonl`) : null;
  if (!path) return "";
  for (const line of readFileSync14(path, "utf8").trim().split(/\r?\n/).reverse()) {
    const entry = JSON.parse(line);
    if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    const handback = entry.message?.content?.find((part) => part.type === "tool_use" && part.name === "SubagentHandback");
    return typeof handback?.input?.message === "string" ? handback.input.message : "";
  }
  return "";
}
function reviewHookEvent(payload) {
  const event = REVIEW_HOOK_EVENTS[String(payload.hook_event_name ?? "")];
  if (!event) return null;
  let lastMessage = String(payload.last_assistant_message ?? "");
  if (event === "subagent-stop" && !lastMessage.includes("FLOW-REVIEW-RESULT")) {
    try {
      lastMessage = handbackMessage(payload) || lastMessage;
    } catch {
    }
  }
  return {
    event,
    sessionId: typeof payload.session_id === "string" ? payload.session_id : "",
    agentType: typeof payload.agent_type === "string" ? payload.agent_type : null,
    lastMessage,
    stopHookActive: Boolean(payload.stop_hook_active)
  };
}
function claudeReviewOutput(result) {
  if (result.decision === "block") return { decision: "block", reason: result.reason };
  return result.message ? { systemMessage: result.message } : null;
}

// harness/src/inspection/impact.ts
import { existsSync as existsSync21 } from "node:fs";
function label({ workspace, unit: unit3 }) {
  return workspace === "." ? unit3 : `${workspace}/${unit3}`;
}
function impactOf(workspace, unit3) {
  return { workspace: workspace.relativeRoot, unit: unit3.name, dependents: unitAdapter(workspace.adapter).dependents(workspace, unit3) };
}
function impactOfChanges(groups) {
  return groups.flatMap((group) => {
    const units = loadProjects3(group.workspace);
    const owners = new Set(group.changes.flatMap((change) => resolveProject(change.absolutePath, units) ?? []));
    return [...owners].map((unit3) => impactOf(group.workspace, unit3));
  });
}
function impactOfInputs(inputs) {
  const impacts = /* @__PURE__ */ new Map();
  for (const input of inputs) {
    const path = resolveInput(input);
    const workspace = existsSync21(path) ? findWorkspace(path) : null;
    const owned = workspace ? { workspace, project: resolveProject(path, loadProjects3(workspace)) } : findProject(input);
    if (!owned?.project) throw new Error(`No unit owns ${input}`);
    const impact = impactOf(owned.workspace, owned.project);
    impacts.set(`${impact.workspace}/${impact.unit}`, impact);
  }
  return [...impacts.values()];
}
function consumers(dependents3) {
  return [
    dependents3.units.length ? `units ${dependents3.units.join(", ")}` : "",
    dependents3.workspaces.length ? `workspaces ${dependents3.workspaces.map((entry) => `${entry.workspace} (${entry.spec})`).join(", ")}` : ""
  ].filter(Boolean).join("; ");
}
function impactLines(impacts) {
  return impacts.flatMap((impact) => {
    const { dependents: dependents3 } = impact;
    if (dependents3.status === "unavailable") return [`IMPACT ${label(impact)}: unavailable (${dependents3.reason})`];
    return [`IMPACT ${label(impact)}: ${consumers(dependents3) || "no dependents"}`, ...dependents3.notes.map((note) => `NOTE ${label(impact)}: ${note}`)];
  });
}
function planWarnings(impacts) {
  return impacts.flatMap((impact) => {
    const { dependents: dependents3 } = impact;
    if (dependents3.status === "unavailable") return [];
    return [...consumers(dependents3) ? [consumers(dependents3)] : [], ...dependents3.notes].map((text) => `WARNING impact ${label(impact)}: ${text}`);
  });
}

// harness/src/task/scope.ts
import { resolve as resolve14 } from "node:path";
function scopeChangesToTask(groups, manifest) {
  const warnings = [];
  const scoped = groups.flatMap((group) => {
    const targets = manifest.targets.filter((target) => target.workspace === group.workspace.relativeRoot);
    if (!targets.length) return [];
    const projects = new Map(loadProjects3(group.workspace).map((project) => [project.name, project]));
    const allowedRoots = targets.map((target) => target.project ? projects.get(target.project)?.root : group.workspace.root).filter((root) => Boolean(root));
    const changes = group.changes.filter((change) => {
      const allowed = affectsWholeWorkspace(change) || allowedRoots.some((root) => isWithin(root, change.absolutePath));
      if (!allowed) {
        warnings.push({
          workspace: group.workspace.relativeRoot,
          file: change.path,
          message: "Change outside the registered task targets was excluded; register its project or workspace when it belongs to this task."
        });
        return false;
      }
      const baseline = manifest.baseline.dirtyFiles[`${group.workspace.relativeRoot}/${change.path}`];
      if (!baseline) return true;
      const changedSinceStart = baseline.fingerprint !== fileHash([resolve14(group.workspace.root, change.path)]);
      if (changedSinceStart) {
        warnings.push({
          workspace: group.workspace.relativeRoot,
          file: change.path,
          message: "File was already changed when the task started and changed again; line ownership is ambiguous."
        });
      }
      return changedSinceStart;
    });
    const codeChanges = changes.filter((change) => change.isCode);
    return [{
      ...group,
      changes,
      scopeToOwners: true,
      added: changes.reduce((sum, change) => sum + change.added, 0),
      deleted: changes.reduce((sum, change) => sum + change.deleted, 0),
      codeFiles: codeChanges.length,
      codeAdded: codeChanges.reduce((sum, change) => sum + change.added, 0),
      codeDeleted: codeChanges.reduce((sum, change) => sum + change.deleted, 0)
    }];
  });
  return { groups: scoped, warnings };
}

// harness/src/verification/runner.ts
async function executeVerificationPlan(plan, options2 = {}) {
  const results = [];
  for (const step of plan.steps) {
    if (step.kind === "configuration-error") {
      results.push({ id: step.id, status: "failed", cached: false, cacheMissReason: "not-cacheable", durationMs: 0, output: step.message });
      if (!options2.continueOnError) break;
      continue;
    }
    const cached = loadVerificationCache().steps[step.id];
    if (!options2.force && cached?.status === "passed" && cached.fingerprint === step.fingerprint) {
      results.push({ id: step.id, status: "passed", cached: true, cacheMissReason: null, durationMs: 0, output: "" });
      continue;
    }
    const cacheMissReason = options2.force ? "forced" : !cached ? "no-entry" : cached.status !== "passed" ? "previous-failure" : "fingerprint-changed";
    const [command2, ...args2] = step.command;
    if (!command2) {
      results.push({ id: step.id, status: "failed", cached: false, cacheMissReason: "invalid-command", durationMs: 0, output: "Verification command is empty" });
      if (!options2.continueOnError) break;
      continue;
    }
    const execution = run(command2, args2, { cwd: step.cwd, maxBuffer: 32 * 1024 * 1024 });
    const status = execution.code === 0 ? "passed" : "failed";
    const result = {
      id: step.id,
      status,
      cached: false,
      cacheMissReason,
      durationMs: execution.durationMs,
      command: execution.command,
      output: truncateOutput(`${execution.stdout}${execution.stderr}`.trim())
    };
    results.push(result);
    recordVerificationCacheStep(step.id, { status, fingerprint: step.fingerprint, verifiedAt: (/* @__PURE__ */ new Date()).toISOString(), durationMs: execution.durationMs });
    if (status === "failed" && !options2.continueOnError) break;
  }
  return results;
}

// harness/src/cli.ts
var args = process.argv[2] === "clean" ? ["task", "cleanup", ...process.argv.slice(3)] : process.argv.slice(2);
var command = args[0];
var VERSION = true ? "0.2.0" : "dev";
var json = args.includes("--json");
var BOOLEAN_OPTIONS = { "--json": true, "--force": true, "--plan": true, "--dry-run": true, "--continue": true, "--isolate": true, "--no-isolate": true, "--all": true, "--shim": true };
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}
function options(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  return values;
}
function positional(start = 1) {
  const values = [];
  for (let index = start; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (value.startsWith("--")) {
      if (!BOOLEAN_OPTIONS[value]) index += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}
function output(value, human) {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}
` : `${human(value)}
`);
}
function taskChangeFingerprint(groups) {
  const changes = groups.flatMap((group) => group.changes.map((change) => ({
    key: `${group.workspace.relativeRoot}/${change.path}`,
    status: change.status,
    path: change.absolutePath
  }))).sort((left, right) => left.key.localeCompare(right.key));
  return fileHash(changes.map((change) => change.path), JSON.stringify(changes.map(({ key, status }) => ({ key, status }))));
}
function requireLiveIsolation(manifest) {
  if (manifest.isolation?.removedAt) throw new Error(`Task ${manifest.taskId} worktree was removed at ${manifest.isolation.removedAt}; start a new task to continue`);
}
function currentTaskScope(manifest) {
  requireLiveIsolation(manifest);
  const workspaces = [...new Set(manifest.targets.map((target) => target.workspace))].map((workspace) => ({ root: physicalWorkspaceRoot(manifest, workspace), base: manifest.baseline.workspaceHeads[workspace] ?? "HEAD" })).flatMap(({ root, base }) => {
    const workspace = workspaceAt(root);
    return workspace ? [{ workspace, base }] : [];
  });
  if (!workspaces.length) throw new Error("No unit workspace matched the task manifest");
  const collected = workspaces.map(({ workspace, base }) => collectWorkspaceChanges(workspace, base));
  const unavailable2 = collected.filter((group) => !group.available);
  if (unavailable2.length) throw new Error(unavailable2.map((group) => `${group.workspace.relativeRoot}: ${group.error}`).join("; "));
  const scoped = scopeChangesToTask(collected, manifest);
  return { groups: scoped.groups.filter((group) => group.changes.length), warnings: scoped.warnings };
}
function reviewHook(event) {
  if (event.event === "subagent-start") {
    if (REVIEW_AGENTS[event.agentType ?? ""]) markReviewerStarted(event.sessionId, event.agentType ?? "");
    return { decision: "allow" };
  }
  if (event.event === "subagent-stop") {
    const kind = REVIEW_AGENTS[event.agentType ?? ""];
    if (!kind) return { decision: "allow" };
    const parsed = parseReviewResult(event.lastMessage);
    if (!parsed) {
      if (event.stopHookActive) markReviewerStopped(event.sessionId, event.agentType ?? "");
      return event.stopHookActive ? { decision: "allow", message: `flow: ${event.agentType} ended without a FLOW-REVIEW-RESULT line; no ${kind} evidence was recorded.` } : { decision: "block", reason: "End the report with exactly one line: FLOW-REVIEW-RESULT task=<feature-slug> blocking=<count> non-blocking=<count>" };
    }
    markReviewerStopped(event.sessionId, event.agentType ?? "");
    const manifest = requireTaskManifest(parsed.feature);
    const scoped = currentTaskScope(manifest);
    const recorded = recordFormalReview(parsed.feature, reviewEvidence({ kind, source: "subagent", agentType: event.agentType, stats: reviewStats(scoped.groups), files: codeFileKeys(scoped.groups), blocking: parsed.blocking, nonBlocking: parsed.nonBlocking }));
    recordTelemetry({ eventType: "review.recorded", command: "review.hook", status: kind, ...manifestTelemetry(recorded) });
    return { decision: "allow", message: `flow recorded ${kind} evidence for ${parsed.feature} (${parsed.blocking} blocking, ${parsed.nonBlocking} non-blocking). Apply valid findings, then rerun verify --task ${parsed.feature}.` };
  }
  const manifests = readSession(event.sessionId).features.flatMap((feature) => {
    try {
      const manifest = loadTaskManifest(feature);
      return manifest ? [manifest] : [];
    } catch {
      return [];
    }
  });
  return evaluateStop(event.sessionId, manifests);
}
function usage() {
  process.stderr.write([
    "Usage:",
    "  flow task start <feature> --target <path|project> [--target ...] [--source <artifact|conversation>] [--source-revision <n>] [--isolate | --no-isolate]",
    "  flow task <status|complete> <feature>",
    "  flow task cleanup <feature>|--all [--force]",
    "  flow clean <feature>|--all [--force]   (short for task cleanup)",
    "  flow task handoff <feature> --to <state>",
    "  flow task block <feature> --reason <code>",
    "  flow inspect [<path|project> | --task <feature>]",
    "  flow verify --task <feature> [--plan] [--force] [--continue]",
    "  flow impact --task <feature> | [--files <path>]... [<path|unit>...]  # units and workspaces that consume the changed units",
    "  flow review status --task <feature>",
    "  flow review record --task <feature> --kind <code-review|code-simplification> [--blocking <n>] [--non-blocking <n>]  # outside Claude Code",
    "  flow review waive --task <feature> --reason <text>  # user only",
    "  flow review allow-tests --task <feature> --reason <text>  # user only: accept the current test-integrity findings",
    "  flow artifact <check|frontier> <feature-dir-or-file>",
    "  flow explain <path> [--task <feature>]",
    "  flow policy evaluate  # normalized event on stdin",
    "  flow hook  # Claude Code hook payload on stdin (policy and review gate)",
    "  flow event <event-type> [--feature <slug>] [--status <status>] [--handoff <state>]",
    "  flow init [<dir>] [--layout single|umbrella] [--stack <name>[,<name>]] [--marketplace <dir>] [--dry-run]",
    "  flow init --shim [--dry-run]  # user-level flow launcher in ~/.local/bin",
    "  flow check [<repo root>]  # plugin repository rules: banned strings, frontmatter, references",
    "  flow doctor",
    "  flow --version"
  ].join("\n") + "\n");
  process.exitCode = 2;
}
function isolationSummary(manifest) {
  const isolation = manifest.isolation;
  if (!isolation) return ["ISOLATION none: edits land in the user checkout"];
  if (isolation.removedAt) return [`ISOLATION removed at ${isolation.removedAt}`];
  return isolation.repositories.map((repository) => `WORKTREE ${repository.workspace}: ${normalizePath(worktreePath(isolation, repository.workspace))} (branch ${isolation.branch} from ${repository.baseBranch ?? "detached HEAD"}@${repository.baseHead.slice(0, 8)})`);
}
function manifestTelemetry(manifest) {
  if (!manifest) return {};
  return {
    taskId: manifest.taskId,
    feature: manifest.feature,
    sourceType: manifest.source.type,
    source: manifest.source.path,
    sourceRevision: manifest.source.revision
  };
}
function successfulInspection(result) {
  if (result.status !== "ok" || !result.workspace || !result.task || !result.changes || !result.verification) throw new Error(result.message ?? "Inspection failed");
  return result;
}
function publicInspection(result) {
  if (!result.verification) return result;
  return {
    ...result,
    verification: result.verification.map((step) => {
      if (step.kind !== "command") return step;
      const { cwd: _cwd, fingerprint: _fingerprint, ...publicStep } = step;
      return publicStep;
    })
  };
}
function contextLines(inspection) {
  return [
    ...inspection.context?.docs.map((doc) => `CONTEXT ${doc}`) ?? [],
    ...inspection.context?.conventions.map((doc) => `CONVENTION ${doc}`) ?? [],
    ...inspection.context?.preflights.map((preflight) => `PREFLIGHT suggested ${preflight}`) ?? []
  ];
}
function cleanupWorktree(root, force) {
  const shared = findSharedIsolation(root);
  if (!shared) throw new Error(`No live worktree found at ${root}`);
  const verifying = shared.tasks.filter((task) => task.phase === "verifying");
  if (verifying.length) throw new Error(`Cannot remove the worktree while verification owns the snapshot of ${verifying.map((task) => task.taskId).join(", ")}`);
  const removal = removeIsolation(shared.isolation, force);
  const removedAt = (/* @__PURE__ */ new Date()).toISOString();
  for (const task of shared.tasks) {
    updateTaskManifest(task.feature, (current) => {
      if (current.isolation) current.isolation.removedAt = removedAt;
      return current;
    });
  }
  return { branch: shared.isolation.branch, ...removal, tasks: shared.tasks.map((task) => task.taskId) };
}
function cleanupSummary(value) {
  return [
    `CLEANED: ${value.tasks.join(", ")}`,
    ...value.removed.map((workspace) => `REMOVED worktree ${workspace}`),
    ...value.deletedBranches.map((workspace) => `DELETED branch ${value.branch} in ${workspace}`),
    ...value.keptBranches.map((workspace) => `KEPT branch ${value.branch} in ${workspace}: not merged into the checked-out branch; merge it, or rerun with --force to delete it`)
  ].join("\n");
}
var FAIL_OPEN = { schemaVersion: 1, decision: "allow", message: null, messages: [], effects: [] };
async function main() {
  const started = Date.now();
  if (command === "--version" || command === "-v") {
    output({ schemaVersion: 1, version: VERSION }, (value) => value.version);
    return;
  }
  const initialised = initRoot();
  if (command === "hook") {
    if (!initialised) return;
    let payload;
    try {
      payload = JSON.parse(readFileSync15(0, "utf8"));
    } catch {
      payload = {};
    }
    const reviewEvent = reviewHookEvent(payload);
    let hookOutput;
    if (payload.hook_event_name === "SessionStart") hookOutput = sessionStartOutput(loadConfig(), coreRules());
    else if (!reviewEvent) hookOutput = claudePolicyHook(payload);
    else {
      try {
        hookOutput = claudeReviewOutput(reviewHook(reviewEvent));
      } catch {
        hookOutput = { systemMessage: "flow review gate hook was unavailable; the task still cannot complete without formal review evidence." };
      }
    }
    if (hookOutput) process.stdout.write(JSON.stringify(hookOutput));
    return;
  }
  if (command === "check") {
    const problems = checkRepository(resolve15(positional(1)[0] ?? "."));
    output({ schemaVersion: 1, problems }, (value) => value.problems.length ? value.problems.map((problem) => `${problem.file}${problem.line ? `:${problem.line}` : ""}: ${problem.message}`).join("\n") : "flow check: clean");
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (command === "init") {
    const dryRun = args.includes("--dry-run");
    if (args.includes("--shim")) {
      const files = dryRun ? [] : installShim(DEFAULT_SHIM_DIRECTORY);
      output({ schemaVersion: 1, directory: normalizePath(DEFAULT_SHIM_DIRECTORY), files, dryRun }, (value) => dryRun ? `DRY RUN: would write flow, flow.cmd and flow.mjs to ${value.directory}` : [...value.files.map((file) => `WROTE ${file}`), `Add ${value.directory} to PATH to run flow from any terminal.`].join("\n"));
      return;
    }
    const layout = option("--layout");
    if (layout !== null && layout !== "single" && layout !== "umbrella") return usage();
    const directory = option("--marketplace");
    const marketplace = directory ? directoryMarketplace(directory) : defaultMarketplace();
    if (!marketplace) throw new Error("Cannot find the agentflow marketplace; run /plugin marketplace add Hienne/agent-flow in Claude Code, or pass --marketplace <dir>");
    const plan = planInit(resolve15(positional(1)[0] ?? "."), { layout, marketplace, stacks: options("--stack").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean) });
    if (!dryRun) writeInit(plan);
    output({ schemaVersion: 1, ...plan, dryRun }, (value) => [
      `CONFIG ${normalizePath(value.config.path)} (${value.config.exists ? "kept" : "new"}): ${JSON.stringify(value.config.value)}`,
      `SETTINGS ${normalizePath(value.settings.path)}${value.settings.changes.length ? "" : " (no change)"}`,
      ...value.settings.changes.map((change) => `  ${change}`),
      ...value.warnings.map((warning) => `WARN ${warning}`),
      dryRun ? "DRY RUN: nothing written" : "DONE"
    ].join("\n"));
    return;
  }
  if (!initialised && command === "policy" && args[1] === "evaluate") {
    output(FAIL_OPEN, () => "ALLOW");
    return;
  }
  if (!initialised && command && !["artifact", "doctor"].includes(command)) throw new NotInitialisedError();
  if (command === "task") {
    const action = args[1];
    const feature = positional(2)[0];
    if (action === "cleanup" && args.includes("--all")) {
      const force = args.includes("--force");
      const roots = [...new Set(taskManifests().flatMap((task) => task.isolation && !task.isolation.removedAt ? [task.isolation.root] : []))];
      const results = roots.map((root) => {
        try {
          const holders = findSharedIsolation(root)?.tasks.filter((task) => task.state !== "completed") ?? [];
          if (holders.length) throw new Error(`skipped, still held by ${holders.map((task) => `${task.taskId} (${task.state}/${task.phase})`).join(", ")}; run clean ${holders[0]?.feature} to remove it`);
          return { root, ...cleanupWorktree(root, force) };
        } catch (error) {
          return { root, error: error instanceof Error ? error.message : String(error) };
        }
      });
      output({ schemaVersion: 1, status: "cleaned-all", results }, (value) => value.results.length ? value.results.map((result) => "error" in result ? `FAILED ${result.root}: ${result.error}` : cleanupSummary(result)).join("\n") : "No live worktrees");
      if (results.some((result) => "error" in result)) process.exitCode = 1;
      return;
    }
    if (!feature || !["start", "status", "handoff", "block", "complete", "cleanup"].includes(action ?? "")) return usage();
    if (action === "start") {
      const targets = options("--target");
      if (!targets.length) throw new Error("task start requires at least one --target");
      if (slugify(feature) !== feature) throw new Error(`Feature must be English kebab-case: ${feature}`);
      const existing = loadTaskManifest(feature);
      if (existing && existing.state !== "completed" && !existing.isolation?.removedAt) throw new Error(`Feature ${feature} already has an active task in phase ${existing.phase}`);
      let inspections = targets.map(inspectTarget).map(successfulInspection);
      const isolate = !args.includes("--no-isolate") && (args.includes("--isolate") || Boolean(findSharedIsolation(`${WORKTREES_DIRECTORY}/${isolationGroup(feature, option("--source"))}`)));
      const created = !isolate ? null : acquireTaskIsolation(feature, option("--source"), inspections.map((inspection) => inspection.workspace.root));
      const isolation = created?.isolation ?? null;
      let manifest2;
      try {
        if (isolation) {
          inspections = inspections.map((inspection) => successfulInspection(inspectTarget(resolve15(ROOT, isolation.root, relative9(ROOT, resolve15(ROOT, inspection.target))))));
        }
        manifest2 = startTaskManifest({ feature, source: option("--source") ?? "conversation", sourceRevision: option("--source-revision"), inspections, isolation });
      } catch (error) {
        created?.rollback();
        throw error;
      }
      for (const warning of created?.warnings ?? []) process.stderr.write(`WARNING ${warning}
`);
      output(manifest2, (value) => [
        `STARTED: ${value.taskId} (${value.targets.map((target) => `${target.workspace}:${target.project ?? "*"}`).join(", ")})`,
        ...isolationSummary(value),
        ...isolation ? ["Edit files only inside the worktree above and run npm/nx from its workspace root; the user keeps working in their own checkout."] : []
      ].join("\n"));
      recordTelemetry({ eventType: "task.started", command: "task.start", status: "active", ...manifestTelemetry(manifest2) });
      return;
    }
    if (action === "status") {
      const manifest2 = requireTaskManifest(feature);
      output(manifest2, (value) => [`${value.taskId}: ${value.state}/${value.phase}, handoff=${value.taskHandoff.state}, revision=${value.manifestRevision}`, ...isolationSummary(value)].join("\n"));
      return;
    }
    if (action === "cleanup") {
      const root = loadTaskManifest(feature)?.isolation?.root ?? `${WORKTREES_DIRECTORY}/${feature}`;
      output({ schemaVersion: 1, status: "cleaned", ...cleanupWorktree(root, args.includes("--force")) }, cleanupSummary);
      return;
    }
    if (action === "handoff") {
      const handoff = option("--to");
      if (!handoff || !["not-ready", "ready-for-verification", "blocked", "completed"].includes(handoff)) throw new Error("Invalid task handoff state");
      const before = requireTaskManifest(feature);
      const manifest2 = setTaskHandoff(feature, handoff, option("--reason"));
      output(manifest2, (value) => `HANDOFF: ${value.taskId} -> ${value.taskHandoff.state}`);
      recordTelemetry({ eventType: "task.handoff", command: "task.handoff", status: manifest2.state, transitionFrom: before.taskHandoff.state, transitionTo: handoff, handoff, ...manifestTelemetry(manifest2) });
      return;
    }
    if (action === "block") {
      const manifest2 = setTaskHandoff(feature, "blocked", option("--reason") ?? "external-blocker");
      output(manifest2, (value) => `BLOCKED: ${value.taskId} (${value.taskHandoff.reason})`);
      return;
    }
    const manifest = setTaskHandoff(feature, "completed");
    output(manifest, (value) => `COMPLETED: ${value.taskId}`);
    return;
  }
  if (command === "inspect") {
    const task = option("--task");
    if (task) {
      const manifest = requireTaskManifest(task);
      requireLiveIsolation(manifest);
      const inspections = inspectTaskTargets(manifest.targets).map(successfulInspection);
      const steps2 = /* @__PURE__ */ new Map();
      for (const inspection of inspections) for (const step of inspection.verification) steps2.set(step.id, step);
      const updated = recordInspection(task, [...steps2.values()]);
      const result2 = { schemaVersion: 2, status: "ok", task: updated, inspections: inspections.map(publicInspection) };
      output(result2, (value) => [`Task: ${value.task.taskId}`, ...value.inspections.flatMap((inspection) => [
        ...contextLines(inspection)
      ])].join("\n"));
      recordTelemetry({ eventType: "task.inspected", command: "inspect", status: "ok", durationMs: Date.now() - started, ...manifestTelemetry(updated) });
      return;
    }
    const result = inspectTarget(positional()[0] ?? ".");
    output(publicInspection(result), (value) => value.status === "ok" ? [`Workspace: ${value.workspace?.root}`, `Project: ${value.project?.name ?? "(workspace-level)"}`, `Task: ${value.task?.kinds.join(", ")}`, ...contextLines(value), ...value.verification?.map((step) => `VERIFY ${step.id}`) ?? []].join("\n") : `ERROR: ${value.message}`);
    if (result.status !== "ok") process.exitCode = 2;
    return;
  }
  if (command === "impact") {
    const feature = option("--task");
    const inputs = [...positional(), ...options("--files")];
    if (Boolean(feature) === Boolean(inputs.length)) return usage();
    const result = { schemaVersion: 1, status: "ok", impacts: feature ? impactOfChanges(currentTaskScope(requireTaskManifest(feature)).groups) : impactOfInputs(inputs) };
    output(result, (value) => impactLines(value.impacts).join("\n") || "No changed unit");
    return;
  }
  if (command === "verify") {
    const feature = option("--task");
    if (!feature) return usage();
    const manifest = requireTaskManifest(feature);
    const scoped = currentTaskScope(manifest);
    const groups = scoped.groups;
    const stats = reviewStats(groups);
    const plan = planVerification(groups);
    if (args.includes("--plan")) {
      const review2 = evaluateReviewGate(manifest, stats, codeFileKeys(groups));
      const impact = impactOfChanges(groups);
      const testIntegrity = pendingTestIntegrity(manifest, collectTestIntegrity(groups));
      const result2 = { schemaVersion: 2, status: "planned", stats, review: review2, plan, scopeWarnings: scoped.warnings, impact, testIntegrity };
      output(result2, (value) => [...value.scopeWarnings.map((warning) => `WARNING ${warning.workspace}/${warning.file}: ${warning.message}`), ...planWarnings(value.impact), ...value.plan.steps.map((step) => `${step.kind.padEnd(12)} ${step.id}`), ...value.testIntegrity.length ? [`WARNING ${testIntegrityReport(value.testIntegrity)}`] : [], reviewGateSummary(value.review, value.stats)].join("\n"));
      return;
    }
    const isolation = activeIsolation(manifest);
    recordInspection(feature, plan.steps);
    const active = beginVerification(feature);
    const beforeFingerprint = taskChangeFingerprint(groups);
    const results = await executeVerificationPlan(plan, {
      force: args.includes("--force"),
      continueOnError: args.includes("--continue"),
      ...isolation ? { workspaceRoot: (workspace) => worktreePath(isolation, workspace) } : {}
    });
    if (!results.length) results.push(groups.length ? {
      id: "task-scope:no-verification-steps",
      status: "failed",
      cached: false,
      cacheMissReason: "not-cacheable",
      durationMs: 0,
      output: "Task-scoped changes exist, but no applicable verification step could be planned."
    } : {
      id: "task-scope:no-applicable-steps",
      status: "passed",
      cached: false,
      cacheMissReason: "not-cacheable",
      durationMs: 0,
      output: "The current task-scoped change set has no applicable verification steps."
    });
    const after = currentTaskScope(active);
    const afterGroups = after.groups;
    if (taskChangeFingerprint(afterGroups) !== beforeFingerprint) {
      throw new Error("Task-scoped changes changed during verification; results were not recorded. Re-run verify against the current snapshot.");
    }
    results.push(testIntegrityResult(pendingTestIntegrity(active, collectTestIntegrity(groups))));
    const failed = results.filter((result2) => result2.status === "failed");
    const review = evaluateReviewGate(active, stats, codeFileKeys(groups));
    const completed = recordVerification(feature, results, active.manifestRevision, review);
    const worklog = updateWorklog(completed, groups, stats, results, review);
    const status = failed.length ? "failed" : completed.phase === "reviewing" ? "review-required" : "passed";
    const result = { schemaVersion: 2, status, stats, review, scopeWarnings: scoped.warnings, worklog: normalizePath(relative9(ROOT, worklog)), task: completed, results };
    output(result, (value) => [...value.scopeWarnings.map((warning) => `WARNING ${warning.workspace}/${warning.file}: ${warning.message}`), ...value.results.flatMap((item) => [`${item.status.toUpperCase().padEnd(7)} ${item.id}${item.cached ? " (cached)" : ""}`, ...item.status === "failed" && item.output ? [item.output.replace(/^/gm, "    ")] : []]), reviewGateSummary(value.review, value.stats), `Task: ${value.task.state}/${value.task.phase}`, `Worklog: ${value.worklog}`].join("\n"));
    for (const item of results) recordTelemetry({ eventType: "verification.completed", command: "verify", status: item.status, durationMs: item.durationMs, verificationStep: item.id, cacheHits: item.cached ? 1 : 0, cacheMissReason: item.cacheMissReason, ...manifestTelemetry(completed) });
    if (failed.length) process.exitCode = 1;
    else if (status === "review-required") process.exitCode = 3;
    return;
  }
  if (command === "review") {
    const action = args[1];
    const feature = option("--task");
    if (!feature || !["status", "record", "waive", "allow-tests"].includes(action ?? "")) return usage();
    const manifest = requireTaskManifest(feature);
    const scoped = currentTaskScope(manifest);
    const stats = reviewStats(scoped.groups);
    const files = codeFileKeys(scoped.groups);
    if (action === "record") {
      const kind = option("--kind");
      if (!kind || !FORMAL_REVIEW_KINDS.includes(kind)) throw new Error(`review record requires --kind ${FORMAL_REVIEW_KINDS.join("|")}`);
      const count = (name) => option(name) === null ? null : Number(option(name));
      recordFormalReview(feature, reviewEvidence({ kind, source: "manual", stats, files, blocking: count("--blocking"), nonBlocking: count("--non-blocking") }));
    }
    if (action === "allow-tests") {
      const reason = option("--reason");
      if (!reason) throw new Error("review allow-tests requires --reason");
      const findings = pendingTestIntegrity(manifest, collectTestIntegrity(scoped.groups));
      if (findings.length) recordTestIntegrityAllowance(feature, testIntegrityAllowance(findings, reason));
      output({ schemaVersion: 1, status: "allowed", findings }, (value) => value.findings.length ? [`Accepted ${value.findings.length} test-integrity finding(s); a later weakening needs a new allowance.`, ...value.findings.map((finding) => `  ${finding.kind.padEnd(17)} ${finding.file}: ${finding.line}`)].join("\n") : "No pending test-integrity findings.");
      return;
    }
    if (action === "waive") {
      const reason = option("--reason");
      if (!reason) throw new Error("review waive requires --reason");
      recordFormalReview(feature, reviewEvidence({ kind: "waiver", source: "user", stats, files, reason }));
    }
    const current = requireTaskManifest(feature);
    const review = evaluateReviewGate(current, stats, files);
    output({ schemaVersion: 1, status: review.satisfied ? "satisfied" : "required", stats, review, evidence: current.evidence.formalReviews ?? [] }, (value) => [
      reviewGateSummary(value.review, value.stats),
      ...value.evidence.map((item) => `EVIDENCE ${item.kind} via ${item.source}${item.agentType ? ` (${item.agentType})` : ""} at ${item.recordedAt}: ${item.codeLines} code lines, ${item.codeFiles} files${item.blocking === null ? "" : `, ${item.blocking} blocking/${item.nonBlocking ?? 0} non-blocking`}${item.reason ? `, reason: ${item.reason}` : ""}`)
    ].join("\n"));
    if (!review.satisfied) process.exitCode = 3;
    return;
  }
  if (command === "artifact") {
    const action = args[1];
    const path = positional(2)[0];
    if (!path || !["check", "frontier"].includes(action ?? "")) return usage();
    if (action === "check") {
      const result2 = checkArtifacts(path);
      output(result2, (value) => value.status === "failed" ? value.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.file}: ${finding.message}`).join("\n") : value.findings.length ? value.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.file}: ${finding.message}`).join("\n") : "Workflow artifacts valid");
      if (result2.status === "failed") process.exitCode = 1;
      return;
    }
    const result = artifactFrontier(path);
    output(result, (value) => value.status === "failed" ? value.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.file}: ${finding.message}`).join("\n") : value.frontier.map((ticket) => `${ticket.id}: ${ticket.title} (${ticket.file})`).join("\n") || "Frontier empty");
    if (result.status === "failed") process.exitCode = 1;
    return;
  }
  if (command === "explain") {
    const path = positional()[0];
    if (!path) return usage();
    const task = option("--task");
    const manifest = task ? requireTaskManifest(task) : null;
    const inspection = successfulInspection(inspectTarget(path));
    const explained = { schemaVersion: 1, status: "ok", target: inspection.target, kinds: inspection.task.kinds, context: inspection.context, taskId: manifest?.taskId ?? null };
    output(explained, () => [`Target: ${inspection.target} (${inspection.task.kinds.join(", ")})`, ...contextLines(inspection)].join("\n"));
    return;
  }
  if (command === "policy" && args[1] === "evaluate") {
    const payload = validatePolicyEvent(JSON.parse(readFileSync15(0, "utf8")));
    const result = handlePolicyEvent(payload);
    output(result, (value) => `${value.decision.toUpperCase()}: ${value.messages.join("; ") || "policy permits event"}`);
    if (result.decision === "block") process.exitCode = 1;
    return;
  }
  if (command === "event") {
    const eventType = positional()[0];
    if (!eventType) return usage();
    const feature = option("--feature");
    const manifest = feature ? loadTaskManifest(feature) : null;
    const identity = manifestTelemetry(manifest);
    if (!manifest && feature) Object.assign(identity, { taskId: `feature:${slugify(feature)}`, feature: slugify(feature) });
    recordTelemetry({ eventType, command: "event", status: option("--status") ?? "recorded", handoff: option("--handoff"), artifactRevision: option("--artifact-revision") ? Number(option("--artifact-revision")) : null, transitionFrom: option("--from"), transitionTo: option("--to"), questionCount: option("--questions") ? Number(option("--questions")) : null, decisionCount: option("--decisions") ? Number(option("--decisions")) : null, ...identity });
    output({ schemaVersion: 1, status: "recorded", eventType, taskId: identity.taskId ?? null }, (value) => `RECORDED: ${value.eventType}${value.taskId ? ` (${String(value.taskId)})` : ""}`);
    return;
  }
  if (command === "doctor") {
    const result = runDoctor();
    output(result, (value) => value.checks.map((item) => `${item.status.toUpperCase().padEnd(7)} ${item.name}: ${item.message}`).join("\n"));
    if (result.status === "failed") process.exitCode = 1;
    return;
  }
  usage();
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const result = { schemaVersion: 2, status: "error", message };
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  else process.stderr.write(`ERROR: ${message}
`);
  recordTelemetry({ command: command ?? "unknown", status: "error", durationMs: 0, exitClass: "runtime-error" });
  process.exitCode = 2;
});
