import type { Register } from 'claude-code'

import { registerGates } from './gates'
import { registerViews } from './views'

// hooks.json names one module per plugin, and `$` never crosses an import, so each file owns its unmatched hooks.
export const register: Register = (on, options) => {
  registerViews(on, options)
  registerGates(on, options)
}
