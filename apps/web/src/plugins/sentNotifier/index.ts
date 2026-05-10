import { Effect } from "effect"
import type { HookPlugin, PluginHooks } from '@/types/plugins'
import type { DicomStudy } from '@/types/dicom'
import { PluginError } from '@/types/effects'
import { ConfigService } from '@/services/config'

export class SentNotifierPlugin implements HookPlugin {
  id = 'sent-notifier'
  name = 'Sent Notifier'
  version = '1.0.0'
  description = 'Notify external server when a study is sent'
  type = 'hook' as const
  enabled = true

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

        const computedHeaders: Record<string, string> = { 'Content-Type': 'application/json' }

        const authHeaderName: string | undefined = pluginSettings.authHeaderName || pluginSettings.apiKeyHeader
        const authHeaderValue: string | undefined = pluginSettings.authHeaderValue || pluginSettings.apiKey
        if (authHeaderName && authHeaderValue) {
          computedHeaders[String(authHeaderName)] = String(authHeaderValue)
        }

        const extraHeaders = pluginSettings.headers
        if (extraHeaders && typeof extraHeaders === 'object') {
          for (const [k, v] of Object.entries(extraHeaders as Record<string, unknown>)) {
            if (k && v != null) {
              computedHeaders[String(k)] = String(v)
            }
          }
        }

        const payload = {
          study_instance_uid: study.studyInstanceUID,
          ...params
        }

        yield* Effect.tryPromise({
          try: async () => {
            console.log("[SENT-NOTIFIER]: Trying to send", payload)
            const resp = await fetch(url, {
              method: 'POST',
              headers: computedHeaders,
              body: JSON.stringify(payload)
            })
            if (!resp.ok) {
              const text = await resp.text().catch(() => '')
              throw new Error(`Notifier failed: ${resp.status} ${resp.statusText} ${text}`)
            }
          },
          catch: (cause) => new PluginError({ message: 'sent-notifier failed', cause, pluginId: 'sent-notifier' })
        })
      })
  }
}

export const sentNotifierPlugin = new SentNotifierPlugin()


