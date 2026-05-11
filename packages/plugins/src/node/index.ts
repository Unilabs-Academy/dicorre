import { Effect } from 'effect'
import { PluginRegistry } from '@dicorre/shared/services/pluginRegistry'
import type { Plugin, PluginConfig } from '@dicorre/shared/types/plugins'
import { sendLoggerPlugin } from '../common/sendLogger'
import { receiptVerifierPlugin } from '../common/receiptVerifier'
import { sentNotifierPlugin } from '../common/sentNotifier'
import { nodeImageConverterPlugin } from './imageConverter'
import { nodePdfConverterPlugin } from './pdfConverter'
import { nodeVideoConverterPlugin } from './videoConverter'

export const nodePlugins: Plugin[] = [
  nodeImageConverterPlugin,
  nodePdfConverterPlugin,
  nodeVideoConverterPlugin,
  sendLoggerPlugin,
  receiptVerifierPlugin,
  sentNotifierPlugin,
]

export const loadNodePlugins = (config?: PluginConfig) =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    if (config) yield* registry.loadPluginConfig(config)
    for (const plugin of nodePlugins) {
      yield* registry.registerPlugin(plugin).pipe(
        Effect.catchAll((error) => Effect.succeed(console.error(`Failed to register plugin ${plugin.id}:`, error))),
      )
    }
    return yield* registry.getAllPlugins()
  })

export {
  nodeImageConverterPlugin,
  nodePdfConverterPlugin,
  nodeVideoConverterPlugin,
  sendLoggerPlugin,
  receiptVerifierPlugin,
  sentNotifierPlugin,
}
