import { Effect, Layer, Stream } from 'effect'
import { ConfigService } from '../config'
import type { AppConfig } from '../config/schema'

export const TestConfigLayer = Layer.succeed(
  ConfigService,
  ConfigService.of({
    getServerConfig: Effect.succeed({
      url: 'http://localhost:8042',
      description: 'Test server',
    }),
    getAnonymizationConfig: Effect.succeed({
      profileOptions: ['BasicProfile'],
      removePrivateTags: true,
      useCustomHandlers: true,
      uidStrategy: 'perRun',
      dateJitterDays: 31,
      organizationRoot: '1.2.826.0.1.3680043.8.498',
      preserveTags: ['Instance Number', 'Modality', 'Manufacturer', 'Protocol Name'],
      tagsToRemove: [
        'startswith:IssueDate',
        'contains:Trial',
        'startswith:PatientTelephoneNumber',
      ],
      replacements: {
        default: 'REMOVED',
        'Accession Number': 'ACA{random}',
        'Patient ID': 'PAT{random}',
      },
    }),
    validateConfig: (config: unknown) => Effect.succeed(config as AppConfig),
    loadConfig: (_configData: unknown) => Effect.succeed(undefined),
    getCurrentConfig: Effect.succeed({
      dicomServer: {
        url: 'http://localhost:8042',
        description: 'Test server',
      },
      anonymization: {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        useCustomHandlers: true,
        uidStrategy: 'perRun',
        dateJitterDays: 31,
        organizationRoot: '1.2.826.0.1.3680043.8.498',
        preserveTags: ['Instance Number', 'Modality', 'Manufacturer', 'Protocol Name'],
        tagsToRemove: [
          'startswith:IssueDate',
          'contains:Trial',
          'startswith:PatientTelephoneNumber',
        ],
        replacements: {
          default: 'REMOVED',
          'Accession Number': 'ACA{random}',
          'Patient ID': 'PAT{random}',
        },
      },
    }),
    getCurrentProject: Effect.succeed(undefined),
    createProject: (name: string) =>
      Effect.succeed({
        name,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    updateProject: (_project) => Effect.succeed(undefined),
    clearProject: Effect.succeed(undefined),
    configChanges: Stream.empty,
  }),
)
