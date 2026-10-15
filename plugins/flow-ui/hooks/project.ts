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

// flow-ui is read from the local marketplace folder (DEC-002), where flow is its sibling plugin.
export const flowCli = (pluginRoot: string) => `${forwardSlashes(pluginRoot)}/../flow/dist/flow.mjs`
