import type { AdapterName } from '../config/config.js';
import type { ChangeGroup, Project, VerificationPlan, VerificationStep, Workspace } from '../shared/types.js';
import { gradleAdapter } from './gradle.js';
import { mavenAdapter } from './maven.js';
import type { Dependents } from './dependents.js';
import { npmAdapter } from './npm.js';
import { nxAdapter } from './nx.js';

// A unit adapter teaches the core one build tool: which directories are unit workspaces, which units own a file, and
// which commands verify a change. Internal to the core: projects pick adapters in .flow/config.json, plugins cannot add one.
export interface UnitAdapter {
  readonly name: AdapterName;
  // File extensions counted as code for the review threshold unless .flow/config.json sets codeFiles.
  readonly codeFiles: string[];
  detect(directory: string): boolean;
  loadUnits(workspace: Pick<Workspace, 'root'>): Project[];
  verifyPlan(group: ChangeGroup, targets: string[]): Omit<VerificationPlan, 'schemaVersion'>;
  unitPlan(workspace: Workspace, unit: Project, targets: string[]): VerificationStep[];
  // The units (and, in an umbrella, workspaces) that consume `unit`, for `flow impact`; `unavailable` when the tool offers no graph.
  dependents(workspace: Workspace, unit: Project): Dependents;
}

const ADAPTERS: Record<AdapterName, UnitAdapter> = { nx: nxAdapter, maven: mavenAdapter, gradle: gradleAdapter, npm: npmAdapter };
// Registry order is detection order: a tool that wraps another (nx over npm) comes first.
export const UNIT_ADAPTERS: UnitAdapter[] = Object.values(ADAPTERS);

export function unitAdapter(name: AdapterName): UnitAdapter {
  return ADAPTERS[name];
}
