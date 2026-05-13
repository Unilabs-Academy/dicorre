#!/usr/bin/env node
import { webcrypto } from 'node:crypto'
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anonymize,
  clearCustomField,
  clearProject,
  createProject,
  download,
  ingest,
  listStudies,
  listPlugins,
  serverProbe,
  loadConfig,
  send,
  setCustomField,
  showConfig,
  mergeStudies,
  validateConfig,
  verify,
} from './commands'
import { ENV_CA_CERT, ENV_SOCKS_PROXY, withCliNetwork } from './proxy'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}

type ParsedArgs = {
  command: string
  positionals: string[]
  options: Record<string, string | boolean | string[]>
}

type CommandHelp = {
  name: string
  summary: string
  usage: string
  arguments?: Array<{ name: string; description: string; required?: boolean; variadic?: boolean }>
  options?: Array<{ name: string; value?: string; description: string; default?: string; repeatable?: boolean }>
  examples: string[]
  output: string
}

const GLOBAL_OPTIONS = [
  { name: '--workspace', value: '<dir>', description: 'Workspace directory for config, state, and stored files.', default: '.dicorre' },
  { name: '--state', value: '<file>', description: 'State file path. Defaults to <workspace>/state.json where supported.' },
] as const

const CONFIG_OPTION = { name: '--config', value: '<config.json>', description: 'Load this config for the command run.' } as const
const CONCURRENCY_OPTION = { name: '--concurrency', value: '<number>', description: 'Maximum concurrent file operations.', default: '3' } as const
const SOCKS_PROXY_OPTION = {
  name: '--socks-proxy',
  value: '<socks5://host:port>',
  description: `Route CLI network requests through a SOCKS proxy. Defaults to ${ENV_SOCKS_PROXY}.`,
} as const
const CA_CERT_OPTION = {
  name: '--ca-cert',
  value: '<ca.pem>',
  description: `Trust this PEM CA/intermediate bundle for HTTPS requests. Defaults to ${ENV_CA_CERT}.`,
} as const
const QUIET_OPTION = { name: '--quiet', description: 'Suppress operational logs. Final JSON is still returned.' } as const
const LOG_FILE_OPTION = { name: '--log-file', value: '<path>', description: 'Write operational logs to this file instead of stderr.' } as const
const RESULT_JSON_OPTION = { name: '--result-json', value: '<path>', description: 'Write the final structured result JSON to this path.' } as const
const WAIT_OPTION = { name: '--wait', description: 'Poll until verification succeeds or timeout is reached.' } as const
const TIMEOUT_OPTION = { name: '--timeout', value: '<duration>', description: 'Verification timeout, for example 60000, 60s, or 15m.' } as const
const STUDY_OPTION = {
  name: '--study',
  value: '<all|uid[,uid]>',
  description: 'Study selector. Use all, a Study Instance UID, or repeat/comma-separate multiple UIDs.',
  default: 'all',
  repeatable: true,
} as const

const COMMANDS: CommandHelp[] = [
  {
    name: 'help',
    summary: 'Return structured CLI help as JSON.',
    usage: 'dicorre help [command]',
    arguments: [{ name: 'command', description: 'Optional command name for command-specific help.' }],
    options: [{ name: '--help', description: 'Show help. Also works as dicorre <command> --help.' }],
    examples: ['dicorre help', 'dicorre help ingest', 'dicorre ingest --help'],
    output: 'A JSON document containing command usage, options, examples, and output descriptions.',
  },
  {
    name: 'discover',
    summary: 'Return the full agent-readable command catalog as JSON.',
    usage: 'dicorre discover',
    examples: ['dicorre discover'],
    output: 'Same schema as dicorre help, intended for agents to inspect available commands.',
  },
  {
    name: 'ingest',
    summary: 'Read DICOM, ZIP/RAR archives, directories, and supported media inputs into CLI state.',
    usage: 'dicorre ingest <paths...> [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>] [--no-converted]',
    arguments: [{ name: 'paths', description: 'Input files or directories to read.', required: true, variadic: true }],
    options: [
      ...GLOBAL_OPTIONS,
      CONFIG_OPTION,
      CONCURRENCY_OPTION,
      { name: '--no-converted', description: 'Skip plugin-based conversion for JPG, PNG, BMP, PDF, MP4, WebM, and OGV inputs.' },
    ],
    examples: [
      'dicorre ingest case.zip --workspace .dicorre/case-001',
      'dicorre ingest ./cases ./extra.dcm --concurrency 6',
      'dicorre ingest report.pdf image.png --no-converted',
    ],
    output: 'JSON summary with filesRead, filesParsed, studies, and statePath.',
  },
  {
    name: 'plugins',
    summary: 'List active CLI plugins, settings, hooks, and supported input types.',
    usage: 'dicorre plugins [--workspace <dir>] [--config <config.json>]',
    options: [GLOBAL_OPTIONS[0], CONFIG_OPTION],
    examples: ['dicorre plugins', 'dicorre plugins --config project.config.json'],
    output: 'JSON catalog of registered CLI plugins with enabled state, settings, CLI context, hooks, and supported extensions.',
  },
  {
    name: 'studies',
    summary: 'List studies currently stored in CLI state.',
    usage: 'dicorre studies [--workspace <dir>] [--state <file>]',
    options: [...GLOBAL_OPTIONS],
    examples: ['dicorre studies --workspace .dicorre/case-001'],
    output: 'JSON array of studies with id, studyInstanceUID, patientId, assignedPatientId, and files.',
  },
  {
    name: 'anonymize',
    summary: 'Anonymize selected studies and update CLI state.',
    usage: 'dicorre anonymize [--study <all|uid[,uid]>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>]',
    options: [STUDY_OPTION, ...GLOBAL_OPTIONS, CONFIG_OPTION, CONCURRENCY_OPTION],
    examples: [
      'dicorre anonymize --study all --workspace .dicorre/case-001',
      'dicorre anonymize --study 1.2.840.example --config project.config.json',
    ],
    output: 'JSON summary with studies, files, and statePath.',
  },
  {
    name: 'download',
    summary: 'Package selected studies into one or more ZIP files.',
    usage: 'dicorre download [--study <all|uid[,uid]>] [--out <download.zip>] [--workspace <dir>] [--state <file>]',
    options: [
      STUDY_OPTION,
      { name: '--out', value: '<download.zip>', description: 'Output ZIP path.', default: '<workspace>/download.zip' },
      ...GLOBAL_OPTIONS,
    ],
    examples: ['dicorre download --study all --out anonymized.zip'],
    output: 'JSON summary with studies and generated files.',
  },
  {
    name: 'send',
    summary: 'Send selected studies to the configured DICOMweb STOW-RS endpoint.',
    usage: 'dicorre send [--study <all|uid[,uid]>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>] [--socks-proxy <url>] [--ca-cert <ca.pem>] [--quiet] [--log-file <path>] [--result-json <path>]',
    options: [STUDY_OPTION, ...GLOBAL_OPTIONS, CONFIG_OPTION, CONCURRENCY_OPTION, SOCKS_PROXY_OPTION, CA_CERT_OPTION, QUIET_OPTION, LOG_FILE_OPTION, RESULT_JSON_OPTION],
    examples: [
      'dicorre send --study all --config orthanc.config.json --workspace .dicorre/case-001',
      'dicorre send --study all --config orthanc.config.json --socks-proxy socks5://127.0.0.1:1080',
    ],
    output: 'JSON summary with aggregate send counts, failedFiles, warnings, plugin hook results, and receipt verification records when available.',
  },
  {
    name: 'server-probe',
    summary: 'Check the configured DICOMweb endpoint without sending DICOM files.',
    usage: 'dicorre server-probe [--workspace <dir>] [--config <config.json>] [--socks-proxy <url>] [--ca-cert <ca.pem>] [--quiet] [--log-file <path>] [--result-json <path>]',
    options: [GLOBAL_OPTIONS[0], CONFIG_OPTION, SOCKS_PROXY_OPTION, CA_CERT_OPTION, QUIET_OPTION, LOG_FILE_OPTION, RESULT_JSON_OPTION],
    examples: [
      'dicorre server-probe --config orthanc.config.json',
      'dicorre server-probe --config orthanc.config.json --socks-proxy socks5://127.0.0.1:1080',
    ],
    output: 'JSON summary with URL, HTTP status, duration, and sanitized reachability/failure fields.',
  },
  {
    name: 'verify',
    summary: 'Verify selected sent studies are visible in the configured receipt backend without resending.',
    usage: 'dicorre verify [--study <all|uid[,uid]>] [--wait] [--timeout <duration>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--socks-proxy <url>] [--ca-cert <ca.pem>] [--quiet] [--log-file <path>] [--result-json <path>]',
    options: [STUDY_OPTION, WAIT_OPTION, TIMEOUT_OPTION, ...GLOBAL_OPTIONS, CONFIG_OPTION, SOCKS_PROXY_OPTION, CA_CERT_OPTION, QUIET_OPTION, LOG_FILE_OPTION, RESULT_JSON_OPTION],
    examples: [
      'dicorre verify --study all --workspace .dicorre/case-001',
      'dicorre verify --study 1.2.840.example --wait --timeout 15m --config project.config.json',
      'dicorre verify --study all --config project.config.json --socks-proxy socks5://127.0.0.1:1080',
    ],
    output: 'JSON summary with per-study receipt verification records.',
  },
  {
    name: 'config-validate',
    summary: 'Validate a config JSON file without loading it into workspace state.',
    usage: 'dicorre config-validate <config.json> [--workspace <dir>]',
    arguments: [{ name: 'config.json', description: 'Config file to validate.', required: true }],
    options: [GLOBAL_OPTIONS[0]],
    examples: ['dicorre config-validate project.config.json'],
    output: 'JSON { "valid": true } on success; exits non-zero on invalid config.',
  },
  {
    name: 'config-load',
    summary: 'Validate and persist a config JSON file into the workspace.',
    usage: 'dicorre config-load <config.json> [--workspace <dir>]',
    arguments: [{ name: 'config.json', description: 'Config file to load.', required: true }],
    options: [GLOBAL_OPTIONS[0]],
    examples: ['dicorre config-load project.config.json --workspace .dicorre/case-001'],
    output: 'JSON object containing the current config after loading.',
  },
  {
    name: 'config-show',
    summary: 'Print the current workspace config.',
    usage: 'dicorre config-show [--workspace <dir>]',
    options: [GLOBAL_OPTIONS[0]],
    examples: ['dicorre config-show --workspace .dicorre/case-001'],
    output: 'JSON object containing the current config.',
  },
  {
    name: 'project-create',
    summary: 'Create or replace the active project metadata in workspace config.',
    usage: 'dicorre project-create <name> [--workspace <dir>]',
    arguments: [{ name: 'name', description: 'Project name.', required: true }],
    options: [GLOBAL_OPTIONS[0]],
    examples: ['dicorre project-create "Academy Batch 42" --workspace .dicorre/case-001'],
    output: 'JSON object containing project id, name, and createdAt.',
  },
  {
    name: 'project-clear',
    summary: 'Clear active project metadata from workspace config.',
    usage: 'dicorre project-clear [--workspace <dir>]',
    options: [GLOBAL_OPTIONS[0]],
    examples: ['dicorre project-clear --workspace .dicorre/case-001'],
    output: 'JSON object with project omitted.',
  },
  {
    name: 'field-set',
    summary: 'Set a custom DICOM field override for one study in CLI state.',
    usage: 'dicorre field-set <study-uid> <field> <value> [--workspace <dir>] [--state <file>]',
    arguments: [
      { name: 'study-uid', description: 'Study id or Study Instance UID.', required: true },
      { name: 'field', description: 'Field name, for example Study Description.', required: true },
      { name: 'value', description: 'Replacement value.', required: true },
    ],
    options: [...GLOBAL_OPTIONS],
    examples: ['dicorre field-set 1.2.840.example "Study Description" "Training Case"'],
    output: 'JSON summary with studyId, field, value, and statePath.',
  },
  {
    name: 'field-clear',
    summary: 'Remove a custom DICOM field override from one study.',
    usage: 'dicorre field-clear <study-uid> <field> [--workspace <dir>] [--state <file>]',
    arguments: [
      { name: 'study-uid', description: 'Study id or Study Instance UID.', required: true },
      { name: 'field', description: 'Field name to clear.', required: true },
    ],
    options: [...GLOBAL_OPTIONS],
    examples: ['dicorre field-clear 1.2.840.example "Study Description"'],
    output: 'JSON summary with studyId, field, and statePath.',
  },
  {
    name: 'study-merge',
    summary: 'Merge two or more studies in CLI state into the first selected study.',
    usage: 'dicorre study-merge <study-uid> <study-uid> [...study-uid] [--workspace <dir>] [--state <file>]',
    arguments: [{ name: 'study-uid', description: 'Study id or Study Instance UID. At least two are required.', required: true, variadic: true }],
    options: [...GLOBAL_OPTIONS],
    examples: ['dicorre study-merge 1.2.840.first 1.2.840.second --workspace .dicorre/case-001'],
    output: 'JSON summary with merged count, resulting studyId, and statePath.',
  },
]

const parseArgs = (argv: string[]): ParsedArgs => {
  const [command = 'help', ...rest] = argv
  const positionals: string[] = []
  const options: Record<string, string | boolean | string[]> = {}

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '-h') {
      options.help = true
      continue
    }
    if (arg.startsWith('--no-')) {
      options[arg.slice(5)] = false
      continue
    }
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

const commandByName = (name: string): CommandHelp | undefined =>
  COMMANDS.find((command) => command.name === name)

const help = (commandName?: string): Record<string, unknown> => {
  if (commandName) {
    const command = commandByName(commandName)
    return command
      ? { command, docs: 'docs/cli.md' }
      : { error: `Unknown command: ${commandName}`, ...help() }
  }

  return {
    name: 'dicorre',
    description: 'CLI for ingesting, anonymizing, packaging, sending, and managing DICOM case workspaces.',
    docs: 'docs/cli.md',
    defaultWorkspace: '.dicorre',
    defaultState: '<workspace>/state.json',
    usage: COMMANDS.map((command) => command.usage),
    commands: COMMANDS,
  }
}

const writeResultJson = async (resultJson: string | undefined, result: unknown): Promise<void> => {
  if (!resultJson) return
  const out = path.resolve(resultJson)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`)
}

const runCliCommand = async (parsed: ParsedArgs): Promise<unknown> => {
  const workspace = asString(parsed.options.workspace)
  const state = asString(parsed.options.state)
  const config = asString(parsed.options.config)
  const concurrency = asNumber(parsed.options.concurrency)
  const socksProxy = asString(parsed.options['socks-proxy'])
  const caCert = asString(parsed.options['ca-cert'])

  return withCliNetwork({ socksProxy, caCert }, async () => {
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
      case 'plugins':
        return listPlugins({ workspace, config })
      case 'anonymize':
        return anonymize(asStudies(parsed.options.study), { workspace, state, config, concurrency })
      case 'download':
        return download(asStudies(parsed.options.study), { workspace, state, out: asString(parsed.options.out) })
      case 'send':
        return send(asStudies(parsed.options.study), { workspace, state, config, concurrency })
      case 'server-probe':
        return serverProbe({ workspace, config })
      case 'verify':
        return verify(asStudies(parsed.options.study), {
          workspace,
          state,
          config,
          wait: parsed.options.wait === true,
          timeout: asString(parsed.options.timeout),
        })
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
      case 'study-merge':
        return mergeStudies(parsed.positionals, { workspace, state })
      default:
        return help()
    }
  })
}

export const runCli = async (argv: string[]): Promise<unknown> => {
  const parsed = parseArgs(argv)
  let result: unknown
  if (parsed.command === '--help' || parsed.command === '-h') {
    result = help()
  } else if (parsed.command === 'help') {
    result = help(parsed.positionals[0])
  } else if (parsed.command === 'discover') {
    result = help()
  } else if (parsed.options.help === true) {
    result = help(parsed.command)
  } else {
    result = await runCliCommand(parsed)
  }
  await writeResultJson(asString(parsed.options['result-json']), result)
  return result
}

const isCliEntrypoint = (): boolean => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (isCliEntrypoint()) {
  const parsed = parseArgs(process.argv.slice(2))
  const originalLog = console.log
  const originalError = console.error
  const quiet = parsed.options.quiet === true
  const logFile = asString(parsed.options['log-file'])
  const writeOperationalLog = (...args: unknown[]) => {
    if (quiet) return
    const line = `${args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')}\n`
    if (logFile) {
      const out = path.resolve(logFile)
      mkdirSync(path.dirname(out), { recursive: true })
      appendFileSync(out, line)
    } else {
      process.stderr.write(line)
    }
  }
  console.log = (...args: unknown[]) => writeOperationalLog(...args)
  console.error = (...args: unknown[]) => writeOperationalLog(...args)

  runCli(process.argv.slice(2))
    .then((result) => {
      console.log = originalLog
      console.error = originalError
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    })
    .catch((error) => {
      console.log = originalLog
      console.error = originalError
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
