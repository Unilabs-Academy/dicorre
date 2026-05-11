import { Effect } from 'effect'
import { ConfigService } from '@dicorre/shared/services/config'
import type { DicomStudy } from '@dicorre/shared/types/dicom'
import type { HookPlugin, PluginHooks } from '@dicorre/shared/types/plugins'
import { PluginError } from '@dicorre/shared/types/effects'

export class SentNotifierPlugin implements HookPlugin {
  id = 'sent-notifier'
  name = 'Sent Notifier'
  version = '1.0.0'
  description = 'Notify an external server after a study is sent'
  type = 'hook' as const
  enabled = true
  cli = {
    summary: 'POSTs the sent study_instance_uid and configured project params after a successful send.',
    docs: 'docs/cli.md#plugins',
    notes: ['Uses plugins.settings.sent-notifier from the active config.'],
  }

  hooks: PluginHooks = {
    afterSend: (study: DicomStudy) =>
      Effect.gen(function* () {
        const configService = yield* ConfigService
        const appConfig = yield* configService.getCurrentConfig
        const project = yield* configService.getCurrentProject

        const pluginSettings = (appConfig.plugins as any)?.settings?.['sent-notifier'] || {}
        const url: string | undefined = pluginSettings.url
        if (!url) return

        const params: Record<string, unknown> =
          ((project as any)?.plugins?.settings?.['sent-notifier']?.params as Record<string, unknown>) || {}

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const authHeaderName: string | undefined = pluginSettings.authHeaderName || pluginSettings.apiKeyHeader
        const authHeaderValue: string | undefined = pluginSettings.authHeaderValue || pluginSettings.apiKey
        if (authHeaderName && authHeaderValue) headers[String(authHeaderName)] = String(authHeaderValue)

        const extraHeaders = pluginSettings.headers
        if (extraHeaders && typeof extraHeaders === 'object') {
          for (const [key, value] of Object.entries(extraHeaders as Record<string, unknown>)) {
            if (key && value != null) headers[String(key)] = String(value)
          }
        }

        const payload = {
          study_instance_uid: study.studyInstanceUID,
          ...params,
        }

        yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
            })
            if (!response.ok) {
              const text = await response.text().catch(() => '')
              throw new Error(`Notifier failed: ${response.status} ${response.statusText} ${text}`)
            }
          },
          catch: (cause) => new PluginError({ message: 'sent-notifier failed', cause, pluginId: 'sent-notifier' }),
        })
      }),
  }
}

export const sentNotifierPlugin = new SentNotifierPlugin()
