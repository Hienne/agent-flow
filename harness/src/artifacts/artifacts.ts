import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { ROOT, normalizePath } from '../shared/paths.js';

interface ArtifactMetadata extends Record<string, string | undefined> {
  artifact?: string;
  status?: string;
  workspace?: string;
  project?: string;
  source?: string;
  source_revision?: string;
  revision?: string;
  handoff?: string;
  readiness?: string;
}

interface Artifact {
  file: string;
  text: string;
  metadata: ArtifactMetadata | null;
  body: string;
}

export interface ArtifactFinding {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

const ARTIFACTS: Record<string, true> = { decisions: true, spec: true, 'architecture-candidate': true, 'ticket-index': true, ticket: true, worklog: true };
const STATUSES: Record<string, true> = { draft: true, validated: true, ready: true, blocked: true, done: true };
const READINESS: Record<string, true> = { observed: true, validated: true, 'investigation-only': true, 'ready-for-spec': true, 'ready-for-implementation': true, rejected: true };
const HANDOFFS: Record<string, true> = { 'ready-for-spec': true, 'ready-for-implementation': true, 'blocked-by-decision': true };
const READY_SPEC_SECTIONS = ['Problem', 'Desired behaviour', 'Observable acceptance criteria', 'Contracts and state transitions', 'Verification seams', 'Constraints', 'Out of scope', 'Open decisions'];
const TICKET_SECTIONS = ['What to build', 'Source acceptance criteria', 'Contract affected', 'Risk', 'Suggested verification', 'Blocked by', 'Acceptance criteria'];
const READY_CANDIDATE_SECTIONS = ['Evidence from current code', 'Observed maintenance or change pressure', 'Why the current interface is shallow', 'Proposed seam', 'Counter-evidence', 'Feasibility check', 'Migration shape', 'Verification seam', 'Design scorecard', 'Readiness and confidence'];

function markdownFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`);
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return markdownFiles(child);
    return entry.isFile() && entry.name.endsWith('.md') ? [child] : [];
  });
}

function expectedArtifact(file: string, root: string): string | null {
  const path = normalizePath(relative(root, file));
  if (path === 'decisions.md') return 'decisions';
  if (path === 'spec.md') return 'spec';
  if (path === 'worklog.md') return 'worklog';
  if (/^architecture\/candidate-\d+\.md$/.test(path)) return 'architecture-candidate';
  if (path === 'issues/index.md') return 'ticket-index';
  if (/^issues\/\d+-[^/]+\.md$/.test(path)) return 'ticket';
  return null;
}

export function parseArtifact(file: string): Artifact {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match?.[1]) return { file, text, metadata: null, body: text };
  const metadata: ArtifactMetadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { file, text, metadata, body: text.slice(match[0].length) };
}

export function section(body: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^## ${escaped}\\s*$`, 'im').exec(body);
  if (!match) return null;
  const remainder = body.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^## /m);
  return remainder.slice(0, nextHeading < 0 ? undefined : nextHeading).trim();
}

function ticketNumber(file: string): string | null {
  return basename(file).match(/^(\d+)-/)?.[1] ?? null;
}

function blockerNumbers(artifact: Artifact): string[] {
  const value = section(artifact.body, 'Blocked by');
  if (!value || /^(none|không|n\/a)\b/i.test(value)) return [];
  return [...new Set(value.match(/\b\d{2,}\b/g) ?? [])];
}

function identifiers(value: string | null, prefix: string): string[] {
  return [...(value ?? '').matchAll(new RegExp(`\\b${prefix}-\\d{3}\\b`, 'g'))].map((match) => match[0]);
}

function headingIdentifiers(value: string, prefix: string): string[] {
  return [...value.matchAll(new RegExp(`^##\\s+(${prefix}-\\d{3})\\b`, 'gm'))].map((match) => match[1]).filter((id): id is string => Boolean(id));
}

function featureRoot(input: string): string {
  const absolute = resolve(input);
  if (statSync(absolute).isDirectory()) return absolute;
  const parent = resolve(absolute, '..');
  return ['issues', 'architecture'].includes(basename(parent)) ? resolve(parent, '..') : parent;
}

function localSource(source: string | undefined): source is string {
  return Boolean(source && source !== 'conversation' && !/^[a-z]+:\/\//i.test(source) && !/^issue:/i.test(source));
}

function resolveSource(root: string, source: string): string {
  const fromFeature = resolve(root, source);
  if (existsSync(fromFeature)) return fromFeature;
  const fromUmbrella = resolve(ROOT, source);
  return existsSync(fromUmbrella) ? fromUmbrella : fromFeature;
}

function add(findings: ArtifactFinding[], severity: ArtifactFinding['severity'], file: string, message: string): void {
  findings.push({ severity, file, message });
}

function validateRequiredSections(item: Artifact, path: string, headings: string[], findings: ArtifactFinding[]): void {
  for (const heading of headings) {
    const value = section(item.body, heading);
    if (value === null) add(findings, 'error', path, `Missing section: ${heading}`);
    else if (!value) add(findings, 'error', path, `Empty section: ${heading}`);
  }
}

function validateTicketGraph(tickets: Map<string, Artifact>, findings: ArtifactFinding[], root: string): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const visit = (number: string, trail: string[] = []): void => {
    if (visiting.has(number)) {
      const cycle = [...trail.slice(trail.indexOf(number)), number].join(' -> ');
      if (!reported.has(cycle)) {
        reported.add(cycle);
        const ticket = tickets.get(number);
        if (ticket) add(findings, 'error', normalizePath(relative(root, ticket.file)), `Ticket dependency cycle: ${cycle}`);
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

export function validateArtifacts(root: string, artifacts: Artifact[]): ArtifactFinding[] {
  const findings: ArtifactFinding[] = [];
  const recognized = artifacts.filter((item) => expectedArtifact(item.file, root));
  if (!recognized.length) return [{ severity: 'error', file: normalizePath(root), message: 'No workflow artifacts found' }];
  const byFile = new Map(recognized.map((item) => [resolve(item.file), item]));
  const tickets = new Map<string, Artifact>();
  for (const item of recognized.filter((candidate) => expectedArtifact(candidate.file, root) === 'ticket')) {
    const number = ticketNumber(item.file);
    if (!number) continue;
    if (tickets.has(number)) add(findings, 'error', normalizePath(relative(root, item.file)), `Duplicate ticket number: ${number}`);
    tickets.set(number, item);
  }

  for (const item of recognized) {
    const path = normalizePath(relative(root, item.file));
    const expected = expectedArtifact(item.file, root);
    if (!item.metadata) {
      add(findings, 'error', path, 'Missing YAML frontmatter');
      continue;
    }
    const metadata = item.metadata;
    for (const field of ['artifact', 'status', 'workspace', 'project', 'source', 'revision']) {
      if (!metadata[field]) add(findings, 'error', path, `Missing metadata field: ${field}`);
    }
    if (metadata.artifact && !ARTIFACTS[metadata.artifact]) add(findings, 'error', path, `Unknown artifact type: ${metadata.artifact}`);
    if (metadata.artifact && metadata.artifact !== expected) add(findings, 'error', path, `Expected artifact type ${expected}, found ${metadata.artifact}`);
    if (metadata.status && !STATUSES[metadata.status]) add(findings, 'error', path, `Unknown status: ${metadata.status}`);
    if (metadata.revision && !/^[1-9]\d*$/.test(metadata.revision)) add(findings, 'error', path, 'revision must be a positive integer');

    let sourceArtifact: Artifact | null = null;
    if (localSource(metadata.source)) {
      const sourcePath = resolveSource(root, metadata.source);
      if (!existsSync(sourcePath)) add(findings, 'error', path, `Source artifact not found: ${metadata.source}`);
      else {
        sourceArtifact = byFile.get(resolve(sourcePath)) ?? parseArtifact(sourcePath);
        if (!/^[1-9]\d*$/.test(metadata.source_revision ?? '')) add(findings, 'error', path, 'Local artifact source requires source_revision');
        else if (sourceArtifact.metadata?.revision !== metadata.source_revision) add(findings, 'error', path, `Source revision mismatch: expected ${sourceArtifact.metadata?.revision ?? '<missing>'}, found ${metadata.source_revision}`);
      }
    }

    if (expected === 'decisions') {
      if (!metadata.handoff || !HANDOFFS[metadata.handoff]) add(findings, 'error', path, `Invalid decisions handoff: ${metadata.handoff ?? '<missing>'}`);
      if (['ready-for-spec', 'ready-for-implementation'].includes(metadata.handoff ?? '') && metadata.status !== 'validated') add(findings, 'error', path, `${metadata.handoff} requires status: validated`);
      if (metadata.handoff === 'blocked-by-decision' && metadata.status !== 'blocked') add(findings, 'error', path, 'blocked-by-decision requires status: blocked');
      const decisionIds = headingIdentifiers(item.body, 'DEC');
      if (!decisionIds.length) add(findings, 'error', path, 'Decisions artifact requires at least one DEC-### identifier');
      if (new Set(decisionIds).size !== decisionIds.length) add(findings, 'error', path, 'Decision identifiers must be unique');
    }

    if (expected === 'architecture-candidate') {
      if (!metadata.readiness || !READINESS[metadata.readiness]) add(findings, 'error', path, `Invalid architecture readiness: ${metadata.readiness ?? '<missing>'}`);
      const requiredStatus = ['observed', 'investigation-only'].includes(metadata.readiness ?? '') ? 'draft'
        : ['validated', 'ready-for-spec', 'ready-for-implementation'].includes(metadata.readiness ?? '') ? 'validated'
          : metadata.readiness === 'rejected' ? 'done' : null;
      if (['ready-for-spec', 'ready-for-implementation'].includes(metadata.readiness ?? '')) validateRequiredSections(item, path, READY_CANDIDATE_SECTIONS, findings);
      if (requiredStatus && metadata.status !== requiredStatus) add(findings, 'error', path, `${metadata.readiness} requires status: ${requiredStatus}`);
    }

    if (expected === 'spec' && metadata.status === 'ready') {
      validateRequiredSections(item, path, READY_SPEC_SECTIONS, findings);
      const openDecisions = section(item.body, 'Open decisions');
      if (openDecisions !== null && !/^(none|không|n\/a)[.!]?$/i.test(openDecisions)) add(findings, 'error', path, 'A ready spec cannot contain unresolved open decisions');
      const criteria = identifiers(section(item.body, 'Observable acceptance criteria'), 'AC');
      if (!criteria.length) add(findings, 'error', path, 'Ready spec requires at least one AC-### identifier');
      if (new Set(criteria).size !== criteria.length) add(findings, 'error', path, 'Acceptance-criterion identifiers must be unique');
      if (sourceArtifact?.metadata?.artifact === 'decisions' && sourceArtifact.metadata.handoff !== 'ready-for-spec') add(findings, 'error', path, `Ready spec requires decisions handoff ready-for-spec, found ${sourceArtifact.metadata.handoff ?? '<missing>'}`);
      if (sourceArtifact?.metadata?.artifact === 'architecture-candidate' && sourceArtifact.metadata.readiness !== 'ready-for-spec') add(findings, 'error', path, `Ready spec requires architecture readiness ready-for-spec, found ${sourceArtifact.metadata.readiness ?? '<missing>'}`);
    }

    if ((expected === 'ticket' || expected === 'ticket-index') && metadata.status === 'ready') {
      if (sourceArtifact?.metadata?.artifact !== 'spec') add(findings, 'error', path, `Ready ${expected} requires a local source spec`);
      else if (sourceArtifact.metadata.status !== 'ready') add(findings, 'error', path, `Ready ${expected} requires a ready source spec`);
    }

    if (expected === 'ticket') {
      validateRequiredSections(item, path, TICKET_SECTIONS, findings);
      const blockers = blockerNumbers(item);
      const missing = blockers.filter((number) => !tickets.has(number));
      const incomplete = blockers.filter((number) => tickets.get(number)?.metadata?.status !== 'done');
      if (missing.length) add(findings, 'error', path, `Unknown blocker ticket(s): ${missing.join(', ')}`);
      if (metadata.status === 'ready' && incomplete.length) add(findings, 'error', path, `Ready ticket has incomplete blocker(s): ${incomplete.join(', ')}`);
      if (metadata.status === 'blocked' && blockers.length && !incomplete.length) add(findings, 'warning', path, 'All ticket blockers are done; consider status: ready');
      const sourceCriteria = identifiers(section(item.body, 'Source acceptance criteria'), 'AC');
      if (!sourceCriteria.length) add(findings, 'error', path, 'Ticket requires at least one source AC-### identifier');
      if (sourceArtifact?.metadata?.artifact === 'spec') {
        const available = new Set(identifiers(section(sourceArtifact.body, 'Observable acceptance criteria'), 'AC'));
        const unknown = sourceCriteria.filter((id) => !available.has(id));
        if (unknown.length) add(findings, 'error', path, `Unknown source acceptance criteria: ${[...new Set(unknown)].join(', ')}`);
      }
    }
  }
  validateTicketGraph(tickets, findings, root);
  return findings;
}

function load(input: string): { root: string; artifacts: Artifact[] } {
  const root = featureRoot(input);
  return { root, artifacts: markdownFiles(root).map(parseArtifact) };
}

export function checkArtifacts(input: string): { schemaVersion: 1; status: 'passed' | 'failed'; root: string; findings: ArtifactFinding[] } {
  const { root, artifacts } = load(input);
  const findings = validateArtifacts(root, artifacts);
  return { schemaVersion: 1, status: findings.some((finding) => finding.severity === 'error') ? 'failed' : 'passed', root: normalizePath(root), findings };
}

export function artifactFrontier(input: string): { schemaVersion: 1; status: 'passed' | 'failed'; root: string; findings: ArtifactFinding[]; frontier: Array<{ id: string; file: string; title: string }> } {
  const { root, artifacts } = load(input);
  const findings = validateArtifacts(root, artifacts);
  if (findings.some((finding) => finding.severity === 'error')) return { schemaVersion: 1, status: 'failed', root: normalizePath(root), findings, frontier: [] };
  const tickets = artifacts.filter((item) => expectedArtifact(item.file, root) === 'ticket' && item.metadata).sort((left, right) => left.file.localeCompare(right.file));
  const byNumber = new Map(tickets.map((item) => [ticketNumber(item.file), item]));
  const frontier = tickets
    .filter((item) => item.metadata?.status === 'ready')
    .filter((item) => blockerNumbers(item).every((number) => byNumber.get(number)?.metadata?.status === 'done'))
    .map((item) => ({
      id: ticketNumber(item.file) ?? '',
      file: normalizePath(relative(root, item.file)),
      title: item.body.match(/^#\s+(?:\d+:\s*)?(.+)$/m)?.[1]?.trim() ?? basename(item.file),
    }));
  return { schemaVersion: 1, status: 'passed', root: normalizePath(root), findings, frontier };
}
