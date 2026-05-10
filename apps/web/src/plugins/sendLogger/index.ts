import { Effect } from "effect"
import type { HookPlugin, PluginHooks } from '@/types/plugins'
import type { DicomStudy } from '@/types/dicom'
import { PluginError } from '@/types/effects'

export class SendLoggerPlugin implements HookPlugin {
  id = 'send-logger'
  name = 'Send Logger'
  version = '1.0.0'
  description = 'Simple test plugin for logging'
  type = 'hook' as const
  enabled = true

  hooks: PluginHooks = {
    afterSend: (study: DicomStudy): Effect.Effect<void, PluginError> =>
      Effect.sync(() => {
        console.log(`[SEND-LOGGER PLUGIN] Study sent ${study.accessionNumber}`)
      }),

    beforeSend: (study: DicomStudy): Effect.Effect<void, PluginError> =>
      Effect.sync(() => {
        console.log(`[SEND-LOGGER PLUGIN] Sending study ${study.accessionNumber}`)
      }),

    onSendError: (study: DicomStudy, _error: Error): Effect.Effect<void, PluginError> =>
      Effect.sync(() => {
        console.error(`[SEND-LOGGER PLUGIN] Send failed ${study.accessionNumber}`)
      })
  }
}

// Export singleton instance
export const sendLoggerPlugin = new SendLoggerPlugin()
