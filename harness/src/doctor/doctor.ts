import { ROOT } from '../shared/paths.js';
import { isInitialised, loadConfig } from '../config/config.js';
import { discoverWorkspaces, loadProjects } from '../topology/workspaces.js';

interface DoctorCheck { name: string; status: 'passed' | 'warning' | 'failed'; message: string; details: unknown }

function check(name: string, status: DoctorCheck['status'], message: string, details: unknown = null): DoctorCheck {
  return { name, status, message, details };
}

export function runDoctor(): { schemaVersion: 2; status: 'passed' | 'degraded' | 'failed'; checks: DoctorCheck[] } {
  const checks: DoctorCheck[] = [];
  if (!isInitialised()) {
    checks.push(check('config', 'failed', `No .flow/config.json above ${ROOT}; run flow init`));
    return { schemaVersion: 2, status: 'failed', checks };
  }
  try {
    const config = loadConfig();
    checks.push(check('config', 'passed', `.flow/config.json is valid (layout ${config.layout}, adapters ${config.units.adapters.join(', ')})`));
  } catch (error) {
    checks.push(check('config', 'failed', error instanceof Error ? error.message : String(error)));
    return { schemaVersion: 2, status: 'failed', checks };
  }
  try {
    const workspaces = discoverWorkspaces();
    const invalid: string[] = [];
    let projectCount = 0;
    for (const workspace of workspaces) {
      const projects = loadProjects(workspace);
      projectCount += projects.length;
      const names = new Set<string>();
      for (const project of projects) {
        if (names.has(project.name)) invalid.push(`${workspace.relativeRoot}:${project.name}`);
        names.add(project.name);
      }
    }
    checks.push(check('unit-discovery', workspaces.length && !invalid.length ? 'passed' : 'failed', `${workspaces.length} workspaces and ${projectCount} units discovered`, invalid));
  } catch (error) {
    checks.push(check('unit-discovery', 'failed', error instanceof Error ? error.message : String(error)));
  }
  const failures = checks.filter((item) => item.status === 'failed');
  const warnings = checks.filter((item) => item.status === 'warning');
  return { schemaVersion: 2, status: failures.length ? 'failed' : warnings.length ? 'degraded' : 'passed', checks };
}
