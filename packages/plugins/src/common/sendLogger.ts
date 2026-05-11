import { Effect } from 'effect'
import type { HookPlugin, PluginHooks } from '@dicorre/shared/types/plugins'
import type { DicomStudy } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'

export class SendLoggerPlugin implements HookPlugin {
  id = 'send-logger'
  name = 'Send Logger'
  version = '1.0.0'
  description = 'Log send lifecycle hook activity'
  type = 'hook' as const
  enabled = true
  cli = {
    summary: 'Logs beforeSend, afterSend, and onSendError hook activity to stdout/stderr.',
    docs: 'docs/cli.md#plugins',
  }

  hooks: PluginHooks = {
    beforeSend: (study: DicomStudy): Effect.Effect<void, PluginError> =>
      Effect.sync(() => {
        console.log(`[SEND-LOGGER PLUGIN] Sending study ${study.accessionNumber}`)
      }),

    afterSend: (study: DicomStudy): Effect.Effect<void, PluginError> =>
      Effect.sync(() => {
        console.log(`[SEND-LOGGER PLUGIN] Study sent ${study.accessionNumber}`)
      }),

    onSendError: (study: DicomStudy, _error: Error): Effect.Effect<void, PluginError> =>
      Effect.sync(() => {
        console.error(`[SEND-LOGGER PLUGIN] Send failed ${study.accessionNumber}`)
      }),
  }
}

export const sendLoggerPlugin = new SendLoggerPlugin()
