import { existsSync } from 'node:fs';
import { resolveInput } from '../shared/paths.js';
import type { ChangeGroup, Project, Workspace } from '../shared/types.js';
import { unitAdapter } from '../units/adapter.js';
import type { Dependents } from '../units/dependents.js';
import { findProject, findWorkspace, loadProjects, resolveProject } from '../topology/workspaces.js';

export interface UnitImpact {
  workspace: string;
  unit: string;
  dependents: Dependents;
}

// A single-layout workspace sits at '.', so its units stand alone.
function label({ workspace, unit }: UnitImpact): string {
  return workspace === '.' ? unit : `${workspace}/${unit}`;
}

function impactOf(workspace: Workspace, unit: Project): UnitImpact {
  return { workspace: workspace.relativeRoot, unit: unit.name, dependents: unitAdapter(workspace.adapter).dependents(workspace, unit) };
}

// One impact per unit that owns a changed file; files no unit owns (workspace-level files) have no dependents to name.
export function impactOfChanges(groups: ChangeGroup[]): UnitImpact[] {
  return groups.flatMap((group) => {
    const units = loadProjects(group.workspace);
    const owners = new Set(group.changes.flatMap((change) => resolveProject(change.absolutePath, units) ?? []));
    return [...owners].map((unit) => impactOf(group.workspace, unit));
  });
}

// Each input is a path (a file or directory a unit owns) or a unit name.
export function impactOfInputs(inputs: string[]): UnitImpact[] {
  const impacts = new Map<string, UnitImpact>();
  for (const input of inputs) {
    const path = resolveInput(input);
    const workspace = existsSync(path) ? findWorkspace(path) : null;
    const owned = workspace ? { workspace, project: resolveProject(path, loadProjects(workspace)) } : findProject(input);
    if (!owned?.project) throw new Error(`No unit owns ${input}`);
    const impact = impactOf(owned.workspace, owned.project);
    impacts.set(`${impact.workspace}/${impact.unit}`, impact);
  }
  return [...impacts.values()];
}

function consumers(dependents: Extract<Dependents, { status: 'ok' }>): string {
  return [
    dependents.units.length ? `units ${dependents.units.join(', ')}` : '',
    dependents.workspaces.length ? `workspaces ${dependents.workspaces.map((entry) => `${entry.workspace} (${entry.spec})`).join(', ')}` : '',
  ].filter(Boolean).join('; ');
}

// The `flow impact` report: every unit gets a line, including the ones with no dependents or no way to tell.
export function impactLines(impacts: UnitImpact[]): string[] {
  return impacts.flatMap((impact) => {
    const { dependents } = impact;
    if (dependents.status === 'unavailable') return [`IMPACT ${label(impact)}: unavailable (${dependents.reason})`];
    return [`IMPACT ${label(impact)}: ${consumers(dependents) || 'no dependents'}`, ...dependents.notes.map((note) => `NOTE ${label(impact)}: ${note}`)];
  });
}

// The warnings `flow verify --plan` prints: only what changes the picture, never an adapter that has no graph.
export function planWarnings(impacts: UnitImpact[]): string[] {
  return impacts.flatMap((impact) => {
    const { dependents } = impact;
    if (dependents.status === 'unavailable') return [];
    return [...(consumers(dependents) ? [consumers(dependents)] : []), ...dependents.notes].map((text) => `WARNING impact ${label(impact)}: ${text}`);
  });
}
