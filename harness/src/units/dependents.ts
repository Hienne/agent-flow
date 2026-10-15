// What consumes a changed unit. `units` are unit names in the same workspace, `workspaces` are other workspaces of an
// umbrella that declare the unit's package, with the version spec they use (`file:` links included).
export type Dependents =
  | { status: 'ok'; units: string[]; workspaces: Array<{ workspace: string; spec: string }>; notes: string[] }
  | { status: 'unavailable'; reason: string };

export function unavailable(reason: string): Dependents {
  return { status: 'unavailable', reason };
}

// Every unit reachable from `start` along consumer edges (consumers.get(a) = the units that use a), `start` excluded.
export function transitiveConsumers(consumers: Map<string, string[]>, start: string): string[] {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    for (const consumer of consumers.get(name) ?? []) {
      if (seen.has(consumer)) continue;
      seen.add(consumer);
      queue.push(consumer);
    }
  }
  seen.delete(start);
  return [...seen].sort();
}

export function addConsumer(consumers: Map<string, string[]>, used: string, consumer: string): void {
  consumers.set(used, [...(consumers.get(used) ?? []), consumer]);
}
