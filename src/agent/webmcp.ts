export type WebMcpRegistrationState =
  | { kind: 'disabled' }
  | { kind: 'registered'; toolNames: string[] }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }

export interface RatatoskrAgentStatus {
  ok: boolean
  status: 'ready' | 'busy' | 'not-ready'
  agentMode: boolean
  configReady: boolean
  restoring: boolean
  idle: boolean
  counts: {
    studies: number
    files: number
    anonymizedFiles: number
    sentFiles: number
    selectedStudies: number
  }
  activeOperations: {
    fileProcessing: number
    anonymization: number
    sending: number
  }
  errors: string[]
}

export interface RatatoskrAgentTools {
  getStatus: () => RatatoskrAgentStatus
  prepareCaseUpload: () => unknown
  getUploadStatus: () => unknown
  processUploadedCases: (input: Record<string, unknown>) => Promise<unknown>
  listStudies: () => unknown
  selectStudies: (input: Record<string, unknown>) => unknown
  anonymizeSelected: (input: Record<string, unknown>) => Promise<unknown>
  sendSelected: (input: Record<string, unknown>) => Promise<unknown>
  getLogs: (input: Record<string, unknown>) => Promise<unknown>
  waitForIdle: (input: Record<string, unknown>) => Promise<unknown>
  clearAll: (input: Record<string, unknown>) => Promise<unknown>
}

interface WebMcpTool {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    untrustedContentHint?: boolean
  }
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

interface WebMcpModelContext {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void
}

declare global {
  interface Navigator {
    modelContext?: WebMcpModelContext
  }
}

const noInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

const waitInputSchema = {
  type: 'object',
  properties: {
    wait: { type: 'boolean' },
    timeoutMs: { type: 'number', minimum: 1 },
  },
  additionalProperties: false,
} as const

const registeredToolDefinitions = (tools: RatatoskrAgentTools): WebMcpTool[] => [
  {
    name: 'ratatoskr.get_status',
    title: 'Get Ratatoskr Status',
    description:
      'Read current Ratatoskr readiness, idle state, active operations, file counts, selected studies, and errors.',
    inputSchema: noInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => tools.getStatus(),
  },
  {
    name: 'ratatoskr.prepare_case_upload',
    title: 'Prepare Case Upload',
    description:
      'Prepare the app for browser-mediated case upload and return the file input selector an external local agent should attach files to.',
    inputSchema: noInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async () => tools.prepareCaseUpload(),
  },
  {
    name: 'ratatoskr.get_upload_status',
    title: 'Get Upload Status',
    description: 'Read current upload and parsing task status for files attached through the app file input.',
    inputSchema: noInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => tools.getUploadStatus(),
  },
  {
    name: 'ratatoskr.process_uploaded_cases',
    title: 'Process Uploaded Cases',
    description:
      'Wait for already-attached case files to finish parsing and grouping. File attachment itself must be done by the local browser agent.',
    inputSchema: waitInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => tools.processUploadedCases(input),
  },
  {
    name: 'ratatoskr.list_studies',
    title: 'List Studies',
    description: 'List studies currently loaded in the app with counts and send/anonymization state.',
    inputSchema: noInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => tools.listStudies(),
  },
  {
    name: 'ratatoskr.select_studies',
    title: 'Select Studies',
    description: 'Select loaded studies by mode or Study Instance UID. Clears previous selection first.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['all'] },
        studyInstanceUIDs: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => tools.selectStudies(input),
  },
  {
    name: 'ratatoskr.anonymize_selected',
    title: 'Anonymize Selected Studies',
    description: 'Start anonymizing selected studies, optionally waiting until all active operations are idle.',
    inputSchema: waitInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => tools.anonymizeSelected(input),
  },
  {
    name: 'ratatoskr.send_selected',
    title: 'Send Selected Studies',
    description:
      'Send selected studies through the configured DICOMweb destination. Explicit confirmation flags are required for non-anonymized or already-sent studies.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmNonAnonymized: { type: 'boolean' },
        confirmResend: { type: 'boolean' },
        wait: { type: 'boolean' },
        timeoutMs: { type: 'number', minimum: 1 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => tools.sendSelected(input),
  },
  {
    name: 'ratatoskr.get_logs',
    title: 'Get Study Logs',
    description: 'Return study logs for all studies or a specific study id / Study Instance UID.',
    inputSchema: {
      type: 'object',
      properties: {
        studyId: { type: 'string' },
        studyInstanceUID: { type: 'string' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: (input) => tools.getLogs(input),
  },
  {
    name: 'ratatoskr.wait_for_idle',
    title: 'Wait For Idle',
    description: 'Wait until file parsing, anonymization, sending, and session restore are inactive.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', minimum: 1 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: (input) => tools.waitForIdle(input),
  },
  {
    name: 'ratatoskr.clear_all',
    title: 'Clear All Cases',
    description: 'Clear loaded studies, selected rows, progress state, session state, and OPFS-backed file state.',
    inputSchema: waitInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => tools.clearAll(input),
  },
]

export function registerRatatoskrWebMcpTools(options: {
  enabled: boolean
  tools: RatatoskrAgentTools
}): { state: WebMcpRegistrationState; dispose: () => void } {
  if (!options.enabled) {
    return { state: { kind: 'disabled' }, dispose: () => {} }
  }

  const modelContext = navigator.modelContext
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return {
      state: {
        kind: 'unavailable',
        message: 'WebMCP is not available in this browser. Open this page in a WebMCP-capable Chrome build with the required flags.',
      },
      dispose: () => {},
    }
  }

  const controller = new AbortController()

  try {
    const toolDefinitions = registeredToolDefinitions(options.tools)
    for (const tool of toolDefinitions) {
      modelContext.registerTool(tool, { signal: controller.signal })
    }

    return {
      state: { kind: 'registered', toolNames: toolDefinitions.map((tool) => tool.name) },
      dispose: () => controller.abort(),
    }
  } catch (error) {
    return {
      state: {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
      dispose: () => controller.abort(),
    }
  }
}
