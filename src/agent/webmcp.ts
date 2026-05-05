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

const GET_STATUS_TOOL_NAME = 'ratatoskr.get_status'

export function registerRatatoskrWebMcpTools(options: {
  enabled: boolean
  getStatus: () => RatatoskrAgentStatus
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
    modelContext.registerTool(
      {
        name: GET_STATUS_TOOL_NAME,
        title: 'Get Ratatoskr Status',
        description:
          'Read the current Ratatoskr case-processing status, including readiness, active operations, file counts, and errors.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: false,
        },
        execute: async () => options.getStatus(),
      },
      { signal: controller.signal },
    )

    return {
      state: { kind: 'registered', toolNames: [GET_STATUS_TOOL_NAME] },
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
