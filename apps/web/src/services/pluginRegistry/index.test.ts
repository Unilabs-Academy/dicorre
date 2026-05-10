import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { PluginRegistry, PluginRegistryLive } from './index'
import { imageConverterPlugin } from '@/plugins/imageConverter'
import { sendLoggerPlugin } from '@/plugins/sendLogger'
import type { PluginConfig } from '@dicorre/shared/types/plugins'

// Helper function to initialize plugins for testing
// Note: Not all plugins can run in Node.js context (e.g., PDF converter requires browser DOM APIs)
// This helper only loads plugins that are compatible with the Node.js test environment
const initializePluginsForTesting = () =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistry

    // Default config for testing
    const config: PluginConfig = {
      enabled: ['image-converter', 'send-logger']
    }

    // Load configuration
    yield* registry.loadPluginConfig(config)

    // Register only Node.js-compatible plugins
    yield* registry.registerPlugin(imageConverterPlugin).pipe(
      Effect.catchAll(() => Effect.succeed(undefined))
    )
    yield* registry.registerPlugin(sendLoggerPlugin).pipe(
      Effect.catchAll(() => Effect.succeed(undefined))
    )

    // Return registered plugins
    return yield* registry.getAllPlugins()
  })

describe('PluginRegistry Service', () => {
  const runTest = <A, E>(effect: Effect.Effect<A, E, PluginRegistry>) =>
    Effect.runPromise(effect.pipe(Effect.provide(PluginRegistryLive)))

  describe('Plugin Registration', () => {
    it('should register plugins', async () => {
      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry

        // Register plugins
        yield* registry.registerPlugin(imageConverterPlugin)
        yield* registry.registerPlugin(sendLoggerPlugin)

        // Get all plugins
        const plugins = yield* registry.getAllPlugins()
        return plugins
      }))

      expect(result).toHaveLength(2)
      expect(result.map(p => p.id)).toContain('image-converter')
      expect(result.map(p => p.id)).toContain('send-logger')
    })

    it('should get plugins by type', async () => {
      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry

        // Try to register plugins (may already be registered)
        yield* registry.registerPlugin(imageConverterPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
        yield* registry.registerPlugin(sendLoggerPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )

        // Ensure plugins are enabled for type queries
        yield* registry.loadPluginConfig({ enabled: ['image-converter', 'send-logger'] })

        // Get plugins by type
        const fileFormatPlugins = yield* registry.getFileFormatPlugins()
        const hookPlugins = yield* registry.getHookPlugins()

        return { fileFormatPlugins, hookPlugins }
      }))

      expect(result.fileFormatPlugins.length).toBeGreaterThanOrEqual(1)
      expect(result.fileFormatPlugins.some(p => p.id === 'image-converter')).toBe(true)

      expect(result.hookPlugins.length).toBeGreaterThanOrEqual(1)
      expect(result.hookPlugins.some(p => p.id === 'send-logger')).toBe(true)
    })

    it('should find plugin for supported files', async () => {
      const jpgFile = new File(['fake jpg data'], 'test.jpg', { type: 'image/jpeg' })
      const dcmFile = new File(['fake dcm data'], 'test.dcm')

      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry

        // Try to register image converter plugin (may already be registered)
        yield* registry.registerPlugin(imageConverterPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )

        // Enable the image converter plugin for file detection
        yield* registry.loadPluginConfig({ enabled: ['image-converter'] })

        // Test file detection
        const jpgPlugin = yield* registry.getPluginForFile(jpgFile)
        const dcmPlugin = yield* registry.getPluginForFile(dcmFile)

        return { jpgPlugin, dcmPlugin }
      }))

      expect(result.jpgPlugin?.id).toBe('image-converter')
      expect(result.dcmPlugin).toBeUndefined() // No plugin should handle DCM files
    })

    it('should include built-in archive formats in supported metadata', async () => {
      const result = await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry
        const extensions = yield* registry.getSupportedExtensions()
        const mimeTypes = yield* registry.getSupportedMimeTypes()

        return { extensions, mimeTypes }
      }))

      expect(result.extensions).toEqual(expect.arrayContaining(['.zip', '.rar', '.dcm', '.dicom']))
      expect(result.mimeTypes).toEqual(expect.arrayContaining([
        'application/zip',
        'application/vnd.rar',
        'application/x-rar-compressed',
      ]))
    })
  })

  describe('Plugin Configuration', () => {
    it('should load plugin configuration', async () => {
      const config = {
        enabled: ['image-converter'],
        settings: {
          'image-converter': {
            defaultModality: 'CT'
          }
        }
      }

      await runTest(Effect.gen(function* () {
        const registry = yield* PluginRegistry

        // Try to register plugin first (may already be registered)
        yield* registry.registerPlugin(imageConverterPlugin).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )

        // Load configuration
        yield* registry.loadPluginConfig(config)

        // Plugin should be enabled
        const plugins = yield* registry.getFileFormatPlugins()
        expect(plugins[0].enabled).toBe(true)
      }))
    })
  })

  describe('Plugin Loading', () => {
    it('should initialize plugins with default config', async () => {
      const result = await runTest(Effect.gen(function* () {
        // Initialize plugins for testing
        const plugins = yield* initializePluginsForTesting()
        return plugins
      }))

      expect(result).toHaveLength(2)
      expect(result.map(p => p.id)).toContain('image-converter')
      expect(result.map(p => p.id)).toContain('send-logger')
    })
  })
})
