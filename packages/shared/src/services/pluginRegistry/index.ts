import { Effect, Context, Layer } from "effect"
import type { Plugin, FileFormatPlugin, HookPlugin, PluginConfig } from '@dicorre/shared/types/plugins'
import { isFileFormatPlugin, isHookPlugin } from '@dicorre/shared/types/plugins'
import { PluginError, type PluginErrorType } from '@dicorre/shared/types/effects'

export class PluginRegistry extends Context.Tag("PluginRegistry")<
  PluginRegistry,
  {
    readonly registerPlugin: (plugin: Plugin) => Effect.Effect<void, PluginErrorType>
    readonly unregisterPlugin: (pluginId: string) => Effect.Effect<void, PluginErrorType>
    readonly getPlugin: (pluginId: string) => Effect.Effect<Plugin | undefined, never>
    readonly getAllPlugins: () => Effect.Effect<Plugin[], never>
    readonly getFileFormatPlugins: () => Effect.Effect<FileFormatPlugin[], never>
    readonly getHookPlugins: () => Effect.Effect<HookPlugin[], never>
    readonly getPluginForFile: (file: File) => Effect.Effect<FileFormatPlugin | undefined, PluginErrorType>
    readonly getSupportedExtensions: () => Effect.Effect<string[], never>
    readonly getSupportedMimeTypes: () => Effect.Effect<string[], never>
    readonly enablePlugin: (pluginId: string) => Effect.Effect<void, PluginErrorType>
    readonly disablePlugin: (pluginId: string) => Effect.Effect<void, PluginErrorType>
    readonly loadPluginConfig: (config: PluginConfig) => Effect.Effect<void, PluginErrorType>
    readonly getPluginSettings: (pluginId: string) => Effect.Effect<Record<string, any> | undefined, never>
  }
>() { }

export const PluginRegistryLive = Layer.sync(
  PluginRegistry,
  () => {
    const plugins = new Map<string, Plugin>()
    const enabledPlugins = new Set<string>()
    let pluginConfig: PluginConfig = { enabled: [] }

    const registerPlugin = (plugin: Plugin): Effect.Effect<void, PluginErrorType> =>
      Effect.gen(function* () {
        if (plugins.has(plugin.id)) {
          return yield* Effect.fail(new PluginError({
            message: `Plugin with ID '${plugin.id}' is already registered`,
            pluginId: plugin.id
          }))
        }

        plugins.set(plugin.id, plugin)

        // Check if plugin should be enabled based on config
        if (pluginConfig.enabled.includes(plugin.id)) {
          enabledPlugins.add(plugin.id)
          plugin.enabled = true
        } else {
          // Explicitly mark as disabled so filters don't treat undefined as enabled
          plugin.enabled = false
        }
      })

    const unregisterPlugin = (pluginId: string): Effect.Effect<void, PluginErrorType> =>
      Effect.gen(function* () {
        if (!plugins.has(pluginId)) {
          return yield* Effect.fail(new PluginError({
            message: `Plugin with ID '${pluginId}' is not registered`,
            pluginId
          }))
        }

        plugins.delete(pluginId)
        enabledPlugins.delete(pluginId)
      })

    const getPlugin = (pluginId: string): Effect.Effect<Plugin | undefined, never> =>
      Effect.sync(() => plugins.get(pluginId))

    const getAllPlugins = (): Effect.Effect<Plugin[], never> =>
      Effect.sync(() => Array.from(plugins.values()))

    const getFileFormatPlugins = (): Effect.Effect<FileFormatPlugin[], never> =>
      Effect.sync(() => {
        const pluginArray = Array.from(plugins.values())
        return pluginArray.filter(isFileFormatPlugin).filter(p => p.enabled === true)
      })

    const getHookPlugins = (): Effect.Effect<HookPlugin[], never> =>
      Effect.sync(() => {
        const pluginArray = Array.from(plugins.values())
        return pluginArray.filter(isHookPlugin).filter(p => p.enabled === true)
      })

    const getPluginForFile = (file: File): Effect.Effect<FileFormatPlugin | undefined, PluginErrorType> =>
      Effect.gen(function* () {
        const fileFormatPlugins = yield* getFileFormatPlugins()

        // Check by file extension
        const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()

        for (const plugin of fileFormatPlugins) {
          // Check if extension is supported
          if (plugin.supportedExtensions.some(ext => ext.toLowerCase() === fileExtension)) {
            // Verify with canProcess method
            const canProcess = yield* plugin.canProcess(file)
            if (canProcess) {
              return plugin
            }
          }

          // Check by MIME type if available
          if (plugin.supportedMimeTypes && file.type) {
            if (plugin.supportedMimeTypes.includes(file.type)) {
              const canProcess = yield* plugin.canProcess(file)
              if (canProcess) {
                return plugin
              }
            }
          }
        }

        return undefined
      })

    const getSupportedExtensions = (): Effect.Effect<string[], never> =>
      Effect.gen(function* () {
        const fileFormatPlugins = yield* getFileFormatPlugins()
        const allExtensions = fileFormatPlugins.flatMap(plugin => plugin.supportedExtensions)
        // Remove duplicates and sort
        return [...new Set(['.zip', '.rar', '.dcm', '.dicom', ...allExtensions])].sort()
      })

    const getSupportedMimeTypes = (): Effect.Effect<string[], never> =>
      Effect.gen(function* () {
        const fileFormatPlugins = yield* getFileFormatPlugins()
        const allMimeTypes = fileFormatPlugins.flatMap(plugin => plugin.supportedMimeTypes || [])
        // Remove duplicates and sort
        return [...new Set(['application/zip', 'application/vnd.rar', 'application/x-rar-compressed', ...allMimeTypes])].sort()
      })

    const enablePlugin = (pluginId: string): Effect.Effect<void, PluginErrorType> =>
      Effect.gen(function* () {
        const plugin = plugins.get(pluginId)
        if (!plugin) {
          return yield* Effect.fail(new PluginError({
            message: `Plugin with ID '${pluginId}' is not registered`,
            pluginId
          }))
        }

        enabledPlugins.add(pluginId)
        plugin.enabled = true
      })

    const disablePlugin = (pluginId: string): Effect.Effect<void, PluginErrorType> =>
      Effect.gen(function* () {
        const plugin = plugins.get(pluginId)
        if (!plugin) {
          return yield* Effect.fail(new PluginError({
            message: `Plugin with ID '${pluginId}' is not registered`,
            pluginId
          }))
        }

        enabledPlugins.delete(pluginId)
        plugin.enabled = false
      })

    const loadPluginConfig = (config: PluginConfig): Effect.Effect<void, PluginErrorType> =>
      Effect.sync(() => {
        pluginConfig = config

        // Update enabled status for all plugins
        for (const [pluginId, plugin] of plugins.entries()) {
          if (config.enabled.includes(pluginId)) {
            enabledPlugins.add(pluginId)
            plugin.enabled = true
          } else {
            enabledPlugins.delete(pluginId)
            plugin.enabled = false
          }
        }
      })

    const getPluginSettings = (pluginId: string): Effect.Effect<Record<string, any> | undefined, never> =>
      Effect.sync(() => pluginConfig.settings?.[pluginId])

    return {
      registerPlugin,
      unregisterPlugin,
      getPlugin,
      getAllPlugins,
      getFileFormatPlugins,
      getHookPlugins,
      getPluginForFile,
      getSupportedExtensions,
      getSupportedMimeTypes,
      enablePlugin,
      disablePlugin,
      loadPluginConfig,
      getPluginSettings
    } as const
  }
)
