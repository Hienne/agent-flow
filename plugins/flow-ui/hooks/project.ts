// The flow project of a session: the nearest folder above the session root holding .flow/config.json.
export type Project = { root: string; artifacts: string }

type Files = { exists: (path: string) => Promise<boolean>; read: (path: string) => Promise<string> }

const forwardSlashes = (path: string) => path.replaceAll('\\', '/')

export async function findProject(files: Files, start: string): Promise<Project | null> {
  let directory = forwardSlashes(start).replace(/\/+$/, '')
  for (;;) {
    const config = `${directory}/.flow/config.json`
    if (await files.exists(config)) {
      const { artifactsDir = '.scratch' } = JSON.parse(await files.read(config)) as { artifactsDir?: string }
      return { root: directory, artifacts: artifactsDir }
    }
    const slash = directory.lastIndexOf('/')
    if (slash <= 0) return null
    directory = directory.slice(0, slash)
  }
}

type Installs = { plugins?: Record<string, { installPath?: string; lastUpdated?: string }[]> }

// In a local directory marketplace (DEC-002) flow is the sibling plugin. A marketplace installed from git is copied
// to <plugins>/cache/<marketplace>/<plugin>/<version>, and flow's own copy is named in <plugins>/installed_plugins.json.
export async function flowCli(files: Files, pluginRoot: string): Promise<string> {
  const root = forwardSlashes(pluginRoot).replace(/\/+$/, '')
  const sibling = `${root}/../flow/dist/flow.mjs`
  const cached = /^(.*)\/cache\/([^/]+)\/[^/]+\/[^/]+$/.exec(root)
  if (!cached || (await files.exists(sibling))) return sibling
  try {
    const { plugins = {} } = JSON.parse(await files.read(`${cached[1]}/installed_plugins.json`)) as Installs
    const install = (plugins[`flow@${cached[2]}`] ?? [])
      .filter(entry => entry.installPath)
      .sort((left, right) => String(right.lastUpdated).localeCompare(String(left.lastUpdated)))[0]
    return install ? `${forwardSlashes(install.installPath!)}/dist/flow.mjs` : sibling
  } catch {
    return sibling
  }
}
