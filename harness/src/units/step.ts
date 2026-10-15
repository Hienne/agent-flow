import { existsSync } from 'node:fs';
import { fileHash } from '../shared/filesystem.js';
import type { CommandVerificationStep, Workspace, WorkspaceChange } from '../shared/types.js';

// One command over the workspace; the fingerprint covers the changed files and the build files that shape the command.
export function commandStep(workspace: Workspace, project: string | null, target: string, command: string[], changes: WorkspaceChange[], buildFiles: string[]): CommandVerificationStep {
  const id = `${workspace.relativeRoot}:${project ?? 'all'}:${target}`;
  const files = [...changes.map((change) => change.absolutePath), ...buildFiles.filter(existsSync)];
  return { id, kind: 'command', workspace: workspace.relativeRoot, project, target, command, cwd: workspace.root, fingerprint: fileHash(files, id) };
}

