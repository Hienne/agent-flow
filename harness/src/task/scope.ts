import { resolve } from 'node:path';
import { affectsWholeWorkspace } from '../inspection/changes.js';
import { fileHash } from '../shared/filesystem.js';
import { isWithin } from '../shared/paths.js';
import type { ChangeGroup, TaskManifest } from '../shared/types.js';
import { loadProjects } from '../topology/workspaces.js';

export interface ScopeWarning {
  workspace: string;
  file: string;
  message: string;
}

export function scopeChangesToTask(groups: ChangeGroup[], manifest: TaskManifest): { groups: ChangeGroup[]; warnings: ScopeWarning[] } {
  const warnings: ScopeWarning[] = [];
  const scoped = groups.flatMap((group): ChangeGroup[] => {
    const targets = manifest.targets.filter((target) => target.workspace === group.workspace.relativeRoot);
    if (!targets.length) return [];
    const projects = new Map(loadProjects(group.workspace).map((project) => [project.name, project]));
    const allowedRoots = targets
      .map((target) => target.project ? projects.get(target.project)?.root : group.workspace.root)
      .filter((root): root is string => Boolean(root));
    const changes = group.changes.filter((change) => {
      const allowed = affectsWholeWorkspace(change) || allowedRoots.some((root) => isWithin(root, change.absolutePath));
      if (!allowed) {
        warnings.push({
          workspace: group.workspace.relativeRoot,
          file: change.path,
          message: 'Change outside the registered task targets was excluded; register its project or workspace when it belongs to this task.',
        });
        return false;
      }
      const baseline = manifest.baseline.dirtyFiles[`${group.workspace.relativeRoot}/${change.path}`];
      if (!baseline) return true;
      const changedSinceStart = baseline.fingerprint !== fileHash([resolve(group.workspace.root, change.path)]);
      if (changedSinceStart) {
        warnings.push({
          workspace: group.workspace.relativeRoot,
          file: change.path,
          message: 'File was already changed when the task started and changed again; line ownership is ambiguous.',
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
      codeDeleted: codeChanges.reduce((sum, change) => sum + change.deleted, 0),
    }];
  });
  return { groups: scoped, warnings };
}
