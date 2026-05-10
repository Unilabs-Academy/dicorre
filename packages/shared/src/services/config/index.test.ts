import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { ConfigService, ConfigServiceLive } from './index'
import type { AppConfig, DicomProfileOption } from './schema'
import { CURRENT_CONFIG_VERSION } from './schema'
import { migrateConfig } from './migrations'
import { ConfigPersistence } from './configPersistence'

describe('ConfigService (Effect Service Testing)', () => {
  // Create a test persistence layer that doesn't use localStorage
  const ConfigPersistenceTest = Layer.succeed(
    ConfigPersistence,
    {
      load: Effect.succeed(null),
      save: (_cfg: AppConfig) => Effect.succeed(undefined),
      clear: Effect.succeed(undefined)
    }
  )

  // Combine the layers for testing
  const TestLayers = Layer.provide(ConfigServiceLive, ConfigPersistenceTest)

  // Test the service through Effect.provide pattern
  const runTest = <A, E>(effect: Effect.Effect<A, E, ConfigService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(TestLayers)))

  describe('Configuration validation', () => {
    it('should validate valid configuration successfully', async () => {
      const validConfig: AppConfig = {
        dicomServer: {
          url: 'http://localhost:8042',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          useCustomHandlers: true,
          dateJitterDays: 30,
          preserveTags: [],
          tagsToRemove: [],
          replacements: {}
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(validConfig)
        }))
      ).resolves.not.toThrow()
    })

    it('should reject configuration without DICOM server URL', async () => {
      const invalidConfig: AppConfig = {
        dicomServer: {
          url: '',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          useCustomHandlers: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow('DICOM server URL is required')
    })

    it('should reject configuration with invalid anonymization profile', async () => {
      const invalidConfig: AppConfig = {
        dicomServer: {
          url: 'http://localhost:8042',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['invalid-profile' as DicomProfileOption],
          removePrivateTags: true,
          useCustomHandlers: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow()
    })
  })

  describe('Service operations', () => {
    it('should get server config', async () => {
      const config = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getServerConfig
      }))

      expect(config).toBeDefined()
      expect(config.url).toBeDefined()
      expect(config.description).toBeDefined()
    })

    it('should get anonymization config', async () => {
      const config = await runTest(Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getAnonymizationConfig
      }))

      expect(config).toBeDefined()
      expect(config.profileOptions).toBeDefined()
      expect(Array.isArray(config.profileOptions)).toBe(true)
      expect(config.profileOptions.length).toBeGreaterThan(0)
      expect(config.uidStrategy).toBe('perRun')
    })
  })

  describe('Migrations', () => {
    it('migrates legacy persisted config without version and fills defaults', () => {
      const legacy = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }
      const migrated = migrateConfig(legacy, { source: 'persisted' })
      expect(migrated.version).toBe(CURRENT_CONFIG_VERSION)
      expect(migrated.dicomServer.timeout).toBeDefined()
      expect(Array.isArray(migrated.anonymization.profileOptions)).toBe(true)
    })

    it('preserves user overrides over defaults during persisted migration', () => {
      const legacy = {
        dicomServer: {
          url: 'http://custom',
          timeout: 1234
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: false
        },
        plugins: {
          enabled: ['image-converter']
        }
      }
      const migrated = migrateConfig(legacy, { source: 'persisted' })
      expect(migrated.version).toBe(CURRENT_CONFIG_VERSION)
      expect(migrated.dicomServer.url).toBe('http://custom')
      expect(migrated.dicomServer.timeout).toBe(1234)
      expect(migrated.anonymization.removePrivateTags).toBe(false)
      expect(migrated.plugins?.enabled).toContain('image-converter')
    })

    it('rejects invalid uploaded config without filling defaults', () => {
      const invalidUploaded = {
        dicomServer: { timeout: 30000 },
        anonymization: { profile: 'basic', removePrivateTags: true }
      }
      expect(() => migrateConfig(invalidUploaded, { source: 'uploaded' })).toThrow()
    })
  })

  describe('Error handling', () => {
    it('should handle service errors gracefully', async () => {
      // Basic error handling test - just test basic validation
      const invalidConfig: AppConfig = {
        dicomServer: {
          url: '',
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(
        runTest(Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.validateConfig(invalidConfig)
        }))
      ).rejects.toThrow()
    })
  })
})
