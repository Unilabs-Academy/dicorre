import { Effect } from 'effect'
import { ConfigService } from '@dicorre/shared/services/config'
import { ReceiptVerificationService, type ReceiptVerificationSettings } from '@dicorre/shared/services/receiptVerification'
import { StudyLogger } from '@dicorre/shared/services/studyLogger'
import type { DicomStudy } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'
import type { HookPlugin, PluginHooks } from '@dicorre/shared/types/plugins'

const pluginId = 'receipt-verifier'

const redactSettings = (settings: ReceiptVerificationSettings) => ({
  provider: settings.provider,
  url: settings.url,
  archive: settings.archive,
  headerNames: settings.headers ? Object.keys(settings.headers) : [],
  authType: settings.auth?.type,
  authPresent: !!settings.auth?.credentials,
  pollIntervalMs: settings.pollIntervalMs,
  timeoutMs: settings.timeoutMs,
  requireInstanceCountMatch: settings.requireInstanceCountMatch,
})

const buildSettings = (appConfig: any): ReceiptVerificationSettings | undefined => {
  const pluginSettings = appConfig.plugins?.settings?.[pluginId] || {}
  if (pluginSettings.enabled === false) return undefined
  const provider = pluginSettings.provider || 'dicomweb-qido'
  const url = pluginSettings.url || (provider === 'dicomweb-qido' || provider === 'orthanc-dicomweb'
    ? appConfig.dicomServer?.url
    : undefined)
  if (!url) return undefined

  return {
    provider,
    url,
    archive: Number.isFinite(Number(pluginSettings.archive)) ? Number(pluginSettings.archive) : undefined,
    headers: pluginSettings.headers || appConfig.dicomServer?.headers || {},
    auth: pluginSettings.auth ?? appConfig.dicomServer?.auth ?? null,
    pollIntervalMs: Number.isFinite(Number(pluginSettings.pollIntervalMs)) ? Number(pluginSettings.pollIntervalMs) : undefined,
    timeoutMs: Number.isFinite(Number(pluginSettings.timeoutMs)) ? Number(pluginSettings.timeoutMs) : undefined,
    requireInstanceCountMatch: pluginSettings.requireInstanceCountMatch === true,
  }
}

export class ReceiptVerifierPlugin implements HookPlugin {
  id = pluginId
  name = 'Receipt Verifier'
  version = '1.0.0'
  description = 'Verify sent studies are visible in a configured receipt backend'
  type = 'hook' as const
  enabled = true
  cli = {
    summary: 'Checks that a successfully sent study is visible in PACScenter or a DICOMweb QIDO endpoint.',
    docs: 'docs/cli.md#verify',
    notes: ['Uses plugins.settings.receipt-verifier from the active config.'],
  }

  hooks: PluginHooks = {
    afterSend: (study: DicomStudy) =>
      Effect.gen(function* () {
        const configService = yield* ConfigService
        const receiptVerification = yield* ReceiptVerificationService
        const logger = yield* StudyLogger
        const appConfig = yield* configService.getCurrentConfig
        const settings = buildSettings(appConfig)
        if (!settings) return

        yield* logger.append(study.id, {
          ts: Date.now(),
          level: 'info',
          message: 'Receipt verification started',
          details: redactSettings(settings),
        })

        const record = yield* receiptVerification.verifyStudy(study, settings, {
          wait: true,
          nextCommand: `dicorre verify --study ${study.studyInstanceUID}`,
        })

        yield* logger.append(study.id, {
          ts: Date.now(),
          level: record.state === 'verified' ? 'info' : record.state === 'waiting' ? 'warn' : 'error',
          message: `Receipt verification ${record.state}`,
          details: {
            attempts: record.attempts,
            checkedAt: record.checkedAt,
            deadlineAt: record.deadlineAt,
            message: record.message,
            backend: record.backend,
          },
        })
      }).pipe(
        Effect.mapError((cause) => new PluginError({ message: 'receipt-verifier failed', cause, pluginId })),
      ),
  }
}

export const receiptVerifierPlugin = new ReceiptVerifierPlugin()
