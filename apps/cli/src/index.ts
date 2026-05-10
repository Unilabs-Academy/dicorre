#!/usr/bin/env -S pnpm exec tsx
import { webcrypto } from 'node:crypto'
import {
  anonymize,
  clearCustomField,
  clearProject,
  createProject,
  download,
  ingest,
  listStudies,
  loadConfig,
  send,
  setCustomField,
  showConfig,
  validateConfig,
} from './commands'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}

type ParsedArgs = {
  command: string
  positionals: string[]
  options: Record<string, string | boolean | string[]>
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const [command = 'help', ...rest] = argv
  const positionals: string[] = []
  const options: Record<string, string | boolean | string[]> = {}

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const key = arg.slice(2)
    const next = rest[i + 1]
    const value = next && !next.startsWith('--') ? next : true
    if (value !== true) i++

    if (key === 'study') {
      const values = String(value).split(',').filter(Boolean)
      const prev = options[key]
      options[key] = Array.isArray(prev) ? [...prev, ...values] : values
    } else {
      options[key] = value
    }
  }

  return { command, positionals, options }
}

const asString = (value: string | boolean | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

const asNumber = (value: string | boolean | string[] | undefined): number | undefined =>
  typeof value === 'string' ? Number(value) : undefined

const asStudies = (value: string | boolean | string[] | undefined): string[] =>
  Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : ['all']

const help = () => ({
  usage: [
    'dicorre ingest <paths...> [--workspace .dicorre] [--state state.json] [--config config.json]',
    'dicorre studies [--workspace .dicorre] [--state state.json]',
    'dicorre anonymize [--study all|uid] [--workspace .dicorre] [--state state.json] [--config config.json]',
    'dicorre download [--study all|uid] [--out download.zip] [--workspace .dicorre] [--state state.json]',
    'dicorre send [--study all|uid] [--workspace .dicorre] [--state state.json] [--config config.json]',
    'dicorre config-validate <config.json>',
    'dicorre config-load <config.json> [--workspace .dicorre]',
    'dicorre config-show [--workspace .dicorre]',
    'dicorre project-create <name> [--workspace .dicorre]',
    'dicorre project-clear [--workspace .dicorre]',
    'dicorre field-set <study-uid> <field> <value> [--workspace .dicorre] [--state state.json]',
    'dicorre field-clear <study-uid> <field> [--workspace .dicorre] [--state state.json]',
  ],
})

export const runCli = async (argv: string[]): Promise<unknown> => {
  const parsed = parseArgs(argv)
  const workspace = asString(parsed.options.workspace)
  const state = asString(parsed.options.state)
  const config = asString(parsed.options.config)
  const concurrency = asNumber(parsed.options.concurrency)

  switch (parsed.command) {
    case 'ingest':
      if (parsed.positionals.length === 0) throw new Error('ingest requires at least one input path')
      return ingest(parsed.positionals, {
        workspace,
        state,
        config,
        converted: parsed.options.converted !== false,
        parseConcurrency: concurrency,
      })
    case 'studies':
      return listStudies({ workspace, state })
    case 'anonymize':
      return anonymize(asStudies(parsed.options.study), { workspace, state, config, concurrency })
    case 'download':
      return download(asStudies(parsed.options.study), { workspace, state, out: asString(parsed.options.out) })
    case 'send':
      return send(asStudies(parsed.options.study), { workspace, state, config, concurrency })
    case 'config-validate':
      if (!parsed.positionals[0]) throw new Error('config-validate requires a config path')
      return validateConfig(parsed.positionals[0], { workspace })
    case 'config-load':
      if (!parsed.positionals[0]) throw new Error('config-load requires a config path')
      return loadConfig(parsed.positionals[0], { workspace })
    case 'config-show':
      return showConfig({ workspace })
    case 'project-create':
      if (!parsed.positionals[0]) throw new Error('project-create requires a project name')
      return createProject(parsed.positionals[0], { workspace })
    case 'project-clear':
      return clearProject({ workspace })
    case 'field-set':
      if (!parsed.positionals[0] || !parsed.positionals[1] || !parsed.positionals[2]) {
        throw new Error('field-set requires a study id, field, and value')
      }
      return setCustomField(parsed.positionals[0], parsed.positionals[1], parsed.positionals[2], { workspace, state })
    case 'field-clear':
      if (!parsed.positionals[0] || !parsed.positionals[1]) {
        throw new Error('field-clear requires a study id and field')
      }
      return clearCustomField(parsed.positionals[0], parsed.positionals[1], { workspace, state })
    case 'help':
    default:
      return help()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
