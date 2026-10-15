import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowConfig } from '../config/config.js';

// The `hooks.disabled` name that turns the SessionStart core rules off.
export const SESSION_CONTEXT_HOOK = 'session-context';

// The bundle runs from <plugin>/dist/flow.mjs, so the plugin root is one level up when Claude Code does not set it.
export function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export function coreRules(): string {
  return readFileSync(join(pluginRoot(), 'context', 'core-rules.md'), 'utf8');
}

export function sessionStartOutput(config: FlowConfig, rules: string): Record<string, unknown> | null {
  if (config.hooks?.disabled?.includes(SESSION_CONTEXT_HOOK)) return null;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules } };
}
