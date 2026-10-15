import { loadConfig, verifyTargets } from '../config/config.js';
import { normalizePath } from '../shared/paths.js';
import type { ChangeGroup, TaskKind, VerificationPlan, VerificationStep } from '../shared/types.js';
import { unitAdapter } from '../units/adapter.js';
import { commandStep } from '../units/step.js';

export function classifyPaths(paths: string[]): TaskKind[] {
  return paths.length && paths.every((path) => /(?:^|\/)(?:docs\/|[^/]+\.md$)/i.test(path)) ? ['docs'] : ['code'];
}

// `**` crosses directories, `*` and `?` stay inside one path segment.
export function globPattern(glob: string): RegExp {
  const source = glob.split(/(\*\*\/|\*\*|\*|\?)/).map((part) => {
    if (part === '**/') return '(?:.*/)?';
    if (part === '**') return '.*';
    if (part === '*') return '[^/]*';
    if (part === '?') return '[^/]';
    return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${source}$`);
}

// verify.custom steps run for documentation-only changes too: a rule may exist precisely to check docs.
function customSteps(group: ChangeGroup): VerificationStep[] {
  return (loadConfig().verify?.custom ?? []).flatMap((rule) => {
    const patterns = rule.files.map(globPattern);
    const matched = group.changes.filter((change) => patterns.some((pattern) => pattern.test(normalizePath(change.path))));
    return matched.length ? [commandStep(group.workspace, null, `custom:${rule.name}`, rule.command, matched, [])] : [];
  });
}

export function planVerification(groups: ChangeGroup[]): VerificationPlan {
  const plan: VerificationPlan = { schemaVersion: 1, affectedProjects: [], steps: [] };
  const targets = verifyTargets();
  const add = (step: VerificationStep): void => {
    if (!plan.steps.some((existing) => existing.id === step.id)) plan.steps.push(step);
  };
  for (const group of groups) {
    if (!group.changes.length) continue;
    if (classifyPaths(group.changes.map((change) => normalizePath(change.path)))[0] !== 'docs') {
      const planned = unitAdapter(group.workspace.adapter).verifyPlan(group, targets);
      plan.affectedProjects.push(...planned.affectedProjects);
      planned.steps.forEach(add);
    }
    customSteps(group).forEach(add);
  }
  return plan;
}
