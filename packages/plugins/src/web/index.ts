import { Effect } from 'effect'
import { PluginRegistry } from '@dicorre/shared/services/pluginRegistry'
import type { Plugin, PluginConfig } from '@dicorre/shared/types/plugins'
import { sendLoggerPlugin } from '../common/sendLogger'
import { receiptVerifierPlugin } from '../common/receiptVerifier'
import { sentNotifierPlugin } from '../common/sentNotifier'
import { imageConverterPlugin } from './imageConverter'
import { pdfConverterPlugin } from './pdfConverter'
import { videoConverterPlugin } from './videoConverter'

export const webPlugins: Plugin[] = [
  imageConverterPlugin,
  pdfConverterPlugin,
  videoConverterPlugin,
  sendLoggerPlugin,
  receiptVerifierPlugin,
  sentNotifierPlugin,
]

export const loadWebPlugins = (config?: PluginConfig) =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    if (config) yield* registry.loadPluginConfig(config)
    for (const plugin of webPlugins) {
      yield* registry.registerPlugin(plugin).pipe(
        Effect.catchAll((error) => Effect.succeed(console.error(`Failed to register plugin ${plugin.id}:`, error))),
      )
    }
    return yield* registry.getAllPlugins()
  })

export {
  imageConverterPlugin,
  pdfConverterPlugin,
  videoConverterPlugin,
  sendLoggerPlugin,
  receiptVerifierPlugin,
  sentNotifierPlugin,
}
