import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join, relative } from 'node:path';
import net from 'node:net';
import { ensureDirectory, removePath } from '../../src/shared/filesystem.js';
import { ROOT, SCRATCH_ROOT, normalizePath } from '../../src/shared/paths.js';
import { waitForPort } from '../../src/shared/process.js';
import type { Project, Workspace } from '../../src/shared/types.js';
import { discoverWorkspaces, loadProjects } from '../../src/topology/workspaces.js';
import { beginManifestTransaction, type ManifestRestoration, type ManifestTransaction } from './manifest-transaction.js';

// MF_SMOKE_BROWSER names any Chrome or Edge executable; the rest are the usual install paths.
const BROWSERS = [
  process.env.MF_SMOKE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((path): path is string => Boolean(path));

export const MANIFEST_PATH = join('src', 'assets', 'module-federation.manifest.json');

function targetPort(project: Project, targetName = 'serve'): number | null {
  const target = project.targets[targetName];
  const value = target?.options?.port ?? target?.configurations?.development?.port;
  return Number.isInteger(value) ? Number(value) : null;
}

// The shell project: the one named, or the only project of the host workspace with a federation manifest.
export function findHost(hostWorkspaceName: string, hostProjectName?: string | null): { workspace: Workspace; project: Project } {
  const workspace = discoverWorkspaces().find((candidate) => candidate.relativeRoot === hostWorkspaceName || candidate.name === hostWorkspaceName);
  if (!workspace) throw new Error(`Smoke host workspace not found: ${hostWorkspaceName}`);
  const projects = loadProjects(workspace).filter((candidate) => hostProjectName ? candidate.name === hostProjectName : existsSync(join(candidate.root, MANIFEST_PATH)));
  if (projects.length !== 1 || !projects[0]) {
    throw new Error(hostProjectName ? `Smoke host project not found: ${hostWorkspaceName}:${hostProjectName}` : `${hostWorkspaceName} has ${projects.length} projects with ${normalizePath(MANIFEST_PATH)}; pass --host-project`);
  }
  return { workspace, project: projects[0] };
}

type ProofStatus = 'passed' | 'failed' | 'unavailable';
interface SmokeProof { phase: string; status: ProofStatus; evidence: string }
interface SmokeDiagnostic { level: 'info' | 'warning' | 'error'; message: string }
interface CdpMessage { id?: number; method?: string; params?: Record<string, any>; result?: Record<string, any>; error?: { message: string } }
interface CdpClient {
  events: CdpMessage[];
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, any>>;
  waitFor(method: string, timeoutMs?: number): Promise<Record<string, any>>;
  close(): void;
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    const closed = (): void => { socket.destroy(); resolvePromise(false); };
    socket.once('error', closed);
    socket.once('timeout', closed);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Could not allocate an isolated host port'));
      else server.close(() => resolvePromise(address.port));
    });
  });
}

function findRemote(name: string): { workspace: Workspace; project: Project } {
  const matches: Array<{ workspace: Workspace; project: Project }> = [];
  for (const workspace of discoverWorkspaces()) for (const project of loadProjects(workspace)) if (project.name === name && project.targets.serve) matches.push({ workspace, project });
  if (matches.length !== 1) throw new Error(matches.length ? `Remote name is ambiguous: ${name}` : `Serve target not found: ${name}`);
  const match = matches[0];
  if (!match) throw new Error(`Serve target not found: ${name}`);
  return match;
}

function startLogged(command: string, args: string[], cwd: string, logPath: string): ChildProcessWithoutNullStreams {
  const log = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once('exit', () => log.end());
  return child;
}

function waitForProcessPort(child: ChildProcessWithoutNullStreams, port: number, timeoutMs: number): Promise<void> {
  return Promise.race([
    waitForPort(port, '127.0.0.1', timeoutMs),
    new Promise<void>((_, reject) => {
      child.once('exit', (code) => reject(new Error(`Process exited before port ${port} became ready (exit ${code})`)));
      child.once('error', reject);
    }),
  ]);
}

function stopOwned(child: ChildProcessWithoutNullStreams | undefined): void {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
  else child.kill('SIGTERM');
}

function selectManifestKey(manifest: Record<string, unknown>, remote: string, explicit?: string | null): string {
  if (explicit) {
    if (!(explicit in manifest)) throw new Error(`Manifest key not found: ${explicit}`);
    return explicit;
  }
  if (remote in manifest) return remote;
  const byRoute = Object.entries(manifest).filter(([, route]) => route === `/${remote}`);
  if (byRoute.length === 1 && byRoute[0]) return byRoute[0][0];
  throw new Error(`Cannot infer manifest key for ${remote}; pass --manifest-key`);
}

function inferShellRoute(remote: string, hostProjectRoot: string): string | null {
  const source = readFileSync(join(hostProjectRoot, 'src', 'app', 'app.routes.ts'), 'utf8');
  const singleQuote = source.indexOf(`loadRemoteModule('${remote}'`);
  const doubleQuote = source.indexOf(`loadRemoteModule("${remote}"`);
  const remoteIndex = singleQuote >= 0 ? singleQuote : doubleQuote;
  if (remoteIndex < 0) return null;
  const paths = [...source.slice(Math.max(0, remoteIndex - 1200), remoteIndex).matchAll(/\bpath\s*:\s*['"]([^'"]+)['"]/g)];
  const path = paths.at(-1)?.[1];
  return path ? `/${path}` : null;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitForFile(path: string, timeoutMs = 20000): Promise<void> {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for ${path}`);
    await delay(100);
  }
}

async function waitForManifest(port: number, key: string, expected: string, timeoutMs = 30000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/assets/module-federation.manifest.json`, { cache: 'no-store' });
      const current = response.ok ? await response.json() as Record<string, unknown> : null;
      if (current?.[key] === expected) return;
    } catch {
      // The host may still be rebuilding.
    }
    await delay(250);
  }
  throw new Error(`Host did not publish the temporary manifest override for ${key}`);
}

function createCdpClient(url: string): CdpClient {
  const socket = new WebSocket(url);
  const pending = new Map<number, { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void }>();
  const listeners = new Map<string, Array<(params: Record<string, any>) => void>>();
  const events: CdpMessage[] = [];
  let requestId = 0;
  const opened = new Promise<void>((resolvePromise, reject) => {
    socket.addEventListener('open', () => resolvePromise(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Chrome DevTools connection failed')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (!message.id) events.push(message);
    if (message.id) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler?.reject(new Error(message.error.message));
      else handler?.resolve(message.result ?? {});
      return;
    }
    const handlers = listeners.get(message.method ?? '') ?? [];
    listeners.delete(message.method ?? '');
    handlers.forEach((handler) => handler(message.params ?? {}));
  });
  return {
    events,
    async request(method, params = {}) {
      await opened;
      const id = ++requestId;
      const response = new Promise<Record<string, any>>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for Chrome DevTools response to ${method}`));
        }, 30000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timeout); resolvePromise(value); },
          reject: (error) => { clearTimeout(timeout); reject(error); },
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    waitFor(method, timeoutMs = 30000) {
      return new Promise<Record<string, any>>((resolvePromise, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
        listeners.set(method, [...(listeners.get(method) ?? []), (params) => { clearTimeout(timeout); resolvePromise(params); }]);
      });
    },
    close() { socket.close(); },
  };
}

async function captureRoute(browser: string | undefined, rootUrl: string, route: string, remoteEntry: string, artifactDirectory: string, ownedProcesses: Set<ChildProcessWithoutNullStreams>): Promise<{ screenshotPath: string; page: Record<string, any>; proof: SmokeProof[] }> {
  if (!browser) throw new Error('Chrome or Edge is required for browser smoke proof');
  const profile = join(artifactDirectory, 'browser-profile');
  ensureDirectory(profile);
  const browserProcess = startLogged(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], ROOT, join(artifactDirectory, 'browser.log'));
  ownedProcesses.add(browserProcess);
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    await waitForFile(portFile);
    const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    if (!port) throw new Error('Browser did not publish a debugging port');
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Cannot create browser target: HTTP ${targetResponse.status}`);
    const target = await targetResponse.json() as { webSocketDebuggerUrl: string };
    const client = createCdpClient(target.webSocketDebuggerUrl);
    try {
      await client.request('Page.enable'); await client.request('Runtime.enable'); await client.request('Network.enable'); await client.request('Network.setCacheDisabled', { cacheDisabled: true });
      let loaded = client.waitFor('Page.loadEventFired');
      await client.request('Page.navigate', { url: new URL('/assets/module-federation.manifest.json', rootUrl).href });
      await loaded;
      const contractUrl = `${remoteEntry}${remoteEntry.includes('?') ? '&' : '?'}mf-contract=${Date.now()}`;
      const remoteContract = await client.request('Runtime.evaluate', { expression: `(async () => { const container = await import(${JSON.stringify(contractUrl)}); return typeof (await container.get('./Routes')); })()`, awaitPromise: true, returnByValue: true });
      if (remoteContract.exceptionDetails || remoteContract.result?.value !== 'function') {
        throw new Error(`Browser could not resolve ./Routes from ${remoteEntry}: ${JSON.stringify(remoteContract.exceptionDetails ?? remoteContract.result ?? {})}`);
      }
      const routeEventStart = client.events.length;
      const requestedUrl = new URL(route, rootUrl).href;
      loaded = client.waitFor('Page.loadEventFired');
      await client.request('Page.navigate', { url: requestedUrl }); await loaded; await delay(12000);
      const state = await client.request('Runtime.evaluate', { expression: `({ title: document.title, path: location.pathname, text: document.body?.innerText?.slice(0, 2000) ?? '', htmlLength: document.body?.innerHTML?.length ?? 0 })`, returnByValue: true });
      const value = state.result?.value ?? {};
      const screenshot = await client.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const screenshotPath = join(artifactDirectory, 'page.png');
      writeFileSync(screenshotPath, Buffer.from(String(screenshot.data ?? ''), 'base64'));
      if (!value.htmlLength) throw new Error(`Browser rendered an empty document for ${route}`);
      const routeEvents = client.events.slice(routeEventStart);
      const shellLoadedRemote = routeEvents.some((event) => event.method === 'Network.responseReceived' && event.params?.response?.url === remoteEntry && event.params.response.status >= 200 && event.params.response.status < 400);
      const routeMatched = value.path === route;
      return { screenshotPath, page: value, proof: [
        { phase: 'remote-contract-resolved', status: 'passed', evidence: 'Browser resolved the remote ./Routes factory through a cache-distinct import.' },
        { phase: 'shell-route-navigation', status: shellLoadedRemote && routeMatched ? 'passed' : 'unavailable', evidence: shellLoadedRemote && routeMatched ? `A full-page request to ${route} caused the shell to load ${remoteEntry}.` : `The browser reached ${value.path || '<unknown>'}, but no shell-owned remote entry request proved route mounting.` },
        { phase: 'authenticated-feature-render', status: 'unavailable', evidence: 'No authenticated session or feature-specific rendered selector was supplied.' },
      ] };
    } finally { client.close(); }
  } finally {
    stopOwned(browserProcess); ownedProcesses.delete(browserProcess); await delay(500);
    try { removePath(profile); } catch { /* Cleanup cannot mask smoke evidence. */ }
  }
}

export interface SmokeOptions {
  host: string;
  hostProject?: string | null;
  route?: string | null;
  manifestKey?: string | null;
  dryRun?: boolean;
}
export interface SmokeResult {
  schemaVersion: 2;
  status: 'planned' | 'running' | 'passed' | 'partial' | 'failed';
  remote: { workspace: string; project: string; port: number };
  host: { workspace: string; project: string; port: number };
  manifest: { key: string; original: unknown; override: string };
  url: string;
  proof: SmokeProof[];
  transaction?: string;
  screenshot?: string;
  artifacts?: string;
  diagnostics?: SmokeDiagnostic[];
}

export async function runSmoke(remoteName: string, options: SmokeOptions): Promise<SmokeResult> {
  const { workspace, project } = findRemote(remoteName);
  const remotePort = targetPort(project);
  if (!remotePort) throw new Error(`Serve port is missing for ${workspace.relativeRoot}:${project.name}`);
  const { workspace: hostWorkspace, project: hostProject } = findHost(options.host, options.hostProject);
  const manifestPath = join(hostProject.root, MANIFEST_PATH);
  if (!existsSync(manifestPath)) throw new Error(`Smoke host manifest not found: ${normalizePath(relative(ROOT, manifestPath))}`);
  const configuredHostPort = targetPort(hostProject) ?? 4200;
  const configuredHostBusy = await portOpen(configuredHostPort);
  const hostPort = configuredHostBusy ? await freePort() : configuredHostPort;
  const proof: SmokeProof[] = [];
  const diagnostics: SmokeDiagnostic[] = [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const manifestKey = selectManifestKey(manifest, project.name, options.manifestKey);
  const originalRoute = manifest[manifestKey];
  if (typeof originalRoute !== 'string') throw new Error(`Manifest value for ${manifestKey} must be a string`);
  const inferredRoute = inferShellRoute(project.name, hostProject.root);
  const selectedRoute = options.route ?? inferredRoute ?? (originalRoute.startsWith('/') ? originalRoute : `/${manifestKey}`);
  let route = selectedRoute.startsWith('/') ? selectedRoute : `/${selectedRoute}`;
  let remoteEntry = `http://localhost:${remotePort}/remoteEntry.mjs`;
  const base: SmokeResult = {
    schemaVersion: 2,
    status: options.dryRun ? 'planned' : 'running',
    remote: { workspace: workspace.relativeRoot, project: project.name, port: remotePort },
    host: { workspace: hostWorkspace.relativeRoot, project: hostProject.name, port: hostPort },
    manifest: { key: manifestKey, original: originalRoute, override: remoteEntry },
    url: `http://127.0.0.1:${hostPort}${route}`,
    proof,
  };
  if (options.dryRun) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDirectory = join(SCRATCH_ROOT, 'smoke', `${stamp}-${project.name}`);
  ensureDirectory(artifactDirectory);
  const ownedProcesses = new Set<ChildProcessWithoutNullStreams>();
  let transaction: ManifestTransaction | null = null;
  let remoteProcess: ChildProcessWithoutNullStreams | undefined;
  let hostProcess: ChildProcessWithoutNullStreams | undefined;
  let cleaned = false;
  let cleanupFailed = false;
  let result: SmokeResult;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (transaction) {
        const restoration: ManifestRestoration = transaction.restore();
        if (restoration.status === 'merged') diagnostics.push({ level: 'warning', message: 'Manifest changed during smoke; restored only the harness-owned remote key.' });
        if (restoration.status === 'conflict') {
          cleanupFailed = true;
          diagnostics.push({ level: 'error', message: `Manifest restore conflicted; transaction ${transaction.journal.id} was retained for recovery.` });
        }
      }
    } catch (error) {
      cleanupFailed = true;
      diagnostics.push({ level: 'error', message: `Manifest cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      for (const child of ownedProcesses) stopOwned(child);
      ownedProcesses.clear();
    }
  };
  const terminate = (code: number): never => { cleanup(); process.exit(code); };
  const onSigint = (): never => terminate(130);
  const onSigterm = (): never => terminate(143);
  try {
    process.once('SIGINT', onSigint); process.once('SIGTERM', onSigterm);
    const remoteReused = await portOpen(remotePort);
    if (!remoteReused) {
      remoteProcess = startLogged(process.execPath, [join(workspace.root, 'node_modules', 'nx', 'bin', 'nx.js'), 'serve', project.name, '--host', '127.0.0.1'], workspace.root, join(artifactDirectory, 'remote.log'));
      ownedProcesses.add(remoteProcess); await waitForProcessPort(remoteProcess, remotePort, 120000);
    }
    proof.push({ phase: 'remote-process-ready', status: 'passed', evidence: remoteReused ? `Reused the process listening on ${remotePort}.` : `Started the remote and observed port ${remotePort}.` });
    let remoteSource = '';
    for (const candidate of [`http://localhost:${remotePort}/remoteEntry.mjs`, `http://localhost:${remotePort}/remoteEntry.js`]) {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      remoteEntry = candidate; remoteSource = await response.text(); break;
    }
    if (!remoteSource) throw new Error(`Remote entry was not served on port ${remotePort}`);
    if (!remoteSource.includes('./Routes')) throw new Error(`Remote entry does not expose ./Routes: ${remoteEntry}`);
    proof.push({ phase: 'remote-entry-served', status: 'passed', evidence: `${remoteEntry} returned a successful response and declared ./Routes.` });
    const currentManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const currentKey = selectManifestKey(currentManifest, project.name, options.manifestKey);
    const currentOriginalRoute = currentManifest[currentKey];
    if (typeof currentOriginalRoute !== 'string') throw new Error(`Manifest value for ${currentKey} must be a string`);
    if (!options.route && !inferredRoute) {
      route = currentOriginalRoute.startsWith('/') ? currentOriginalRoute : `/${currentKey}`;
      base.url = `http://127.0.0.1:${hostPort}${route.startsWith('/') ? route : `/${route}`}`;
    }
    base.manifest = { key: currentKey, original: currentOriginalRoute, override: remoteEntry };
    transaction = beginManifestTransaction(manifestPath, currentKey, remoteEntry);
    base.transaction = transaction.journal.id;
    hostProcess = startLogged(
      process.execPath,
      [join(hostWorkspace.root, 'node_modules', 'nx', 'bin', 'nx.js'), 'serve', hostProject.name, '--host', '127.0.0.1', '--port', String(hostPort)],
      hostWorkspace.root,
      join(artifactDirectory, 'host.log'),
    );
    ownedProcesses.add(hostProcess); await waitForProcessPort(hostProcess, hostPort, 180000);
    proof.push({ phase: 'shell-process-ready', status: 'passed', evidence: `Observed the shell on port ${hostPort}.` });
    const rootUrl = `http://127.0.0.1:${hostPort}/`;
    const response = await fetch(rootUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Shell root returned HTTP ${response.status}: ${rootUrl}`);
    await waitForManifest(hostPort, currentKey, remoteEntry);
    proof.push({ phase: 'shell-manifest-observed', status: 'passed', evidence: `The served manifest mapped ${currentKey} to ${remoteEntry}.` });
    const capture = await captureRoute(BROWSERS.find(existsSync), rootUrl, route, remoteEntry, artifactDirectory, ownedProcesses);
    proof.push(...capture.proof);
    diagnostics.push({ level: 'info', message: `Rendered ${capture.page.path} (${capture.page.title || 'untitled'})` });
    diagnostics.push({ level: 'info', message: remoteReused ? `Reused process on remote port ${remotePort}` : 'Started and stopped an owned remote process' });
    diagnostics.push({ level: 'info', message: configuredHostBusy ? `Started an isolated host because port ${configuredHostPort} was already active` : 'Started and stopped an owned host process' });
    result = { ...base, status: proof.some((item) => item.status === 'unavailable') ? 'partial' : 'passed', screenshot: normalizePath(relative(ROOT, capture.screenshotPath)), artifacts: normalizePath(relative(ROOT, artifactDirectory)), diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    proof.push({ phase: 'smoke-run', status: 'failed', evidence: message }); diagnostics.push({ level: 'error', message });
    result = { ...base, status: 'failed', diagnostics };
  } finally {
    process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm); cleanup();
  }
  if (cleanupFailed) {
    proof.push({ phase: 'manifest-restoration', status: 'failed', evidence: 'The host manifest could not be restored safely; inspect the retained transaction before continuing.' });
    result.status = 'failed';
  }
  return result;
}
