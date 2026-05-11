import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { validateAppConfig, validateProjectConfig, parseAppConfig, encodeAppConfig } from './schema'
import type { AppConfig, ProjectConfig } from './schema'

describe('Config Schema Validation', () => {
  describe('DicomServerConfig', () => {
    it('should accept valid server config', async () => {
      const config = {
        dicomServer: {
          url: '/api/orthanc/dicom-web',
          headers: { 'X-Custom': 'value' },
          timeout: 30000,
          auth: null,
          description: 'Test server'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result).toBeDefined()
      expect(result.dicomServer.url).toBe('/api/orthanc/dicom-web')
    })

    it('should reject config without server URL', async () => {
      const config = {
        dicomServer: {
          headers: {},
          timeout: 30000
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow()
    })

    it('should reject config with invalid URL format', async () => {
      const config = {
        dicomServer: {
          url: 'invalid-url',
          headers: {}
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/URL must start with \/ or http/)
    })

    it('should reject config with negative timeout', async () => {
      const config = {
        dicomServer: {
          url: '/api/test',
          timeout: -1000
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Timeout must be positive/)
    })

    it('should reject config with timeout exceeding max', async () => {
      const config = {
        dicomServer: {
          url: '/api/test',
          timeout: 700000
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Timeout must not exceed 600000ms/)
    })
  })

  describe('AnonymizationConfig', () => {
    it('should accept valid anonymization config', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['CleanDescOption'],
          removePrivateTags: false,
          dateJitterDays: 30,
          organizationRoot: '1.2.3.4.5',
          replacements: {
            patientName: 'ANONYMOUS',
            patientId: 'ID_{timestamp}'
          },
          preserveTags: ['SOP Class UID', 'SOP Instance UID'],
          tagsToRemove: ['PatientAddress']
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result.anonymization.profileOptions).toEqual(['CleanDescOption'])
      expect(result.anonymization.dateJitterDays).toBe(30)
    })

    it('should reject invalid profile', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['InvalidProfile'],
          removePrivateTags: true
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow()
    })

    it('should reject negative dateJitterDays', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          dateJitterDays: -5
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/dateJitterDays must be >= 0/)
    })

    it('should reject dateJitterDays > 365', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          dateJitterDays: 400
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/dateJitterDays must be <= 365/)
    })

    it('should reject invalid tag format in preserveTags', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          preserveTags: ['00080016', 'SOP Class UID', 'INVALID', '12345'] // Mix of hex, name, and invalid
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Tag must be a valid DICOM tag name/)
    })

    it('should reject invalid organization root', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          organizationRoot: '1.2.abc.4' // Invalid: contains letters
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow(/Organization root must be a valid OID/)
    })

    it('should accept valid uidStrategy', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          uidStrategy: 'deterministic'
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result.anonymization.uidStrategy).toBe('deterministic')
    })

    it('should reject invalid uidStrategy', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          uidStrategy: 'invalid-strategy'
        }
      }

      await expect(Effect.runPromise(validateAppConfig(config))).rejects.toThrow()
    })
  })


  describe('Complete Config', () => {
    it('should accept the default config structure', async () => {
      const defaultConfig = {
        dicomServer: {
          url: '/api/orthanc/dicom-web',
          headers: {},
          timeout: 30000,
          auth: null,
          description: 'Default DICOM server configuration'
        },
        anonymization: {
          profileOptions: ['BasicProfile', 'RetainLongModifDatesOption', 'RetainUIDsOption'],
          removePrivateTags: true,
          useCustomHandlers: true,
          dateJitterDays: 31,
          organizationRoot: '1.2.826.0.1.3680043.8.498',
          replacements: {
            default: 'REMOVED',
            patientName: 'ANONYMOUS',
            accessionNumber: 'ACA{timestamp}',
            patientId: 'PAT{timestamp}',
            patientBirthDate: '19000101',
            institution: 'ANONYMIZED'
          },
          preserveTags: [
            "Instance Number",
            "Modality", 
            "Manufacturer",
            "Referring Physician's Name",
            "Protocol Name"
          ],
          tagsToRemove: [
            'PatientAddress',
            'PatientTelephoneNumber'
          ]
        }
      }

      const result = await Effect.runPromise(validateAppConfig(defaultConfig))
      expect(result).toBeDefined()
      expect(result.dicomServer.url).toBe('/api/orthanc/dicom-web')
      expect(result.anonymization.profileOptions).toEqual(['BasicProfile', 'RetainLongModifDatesOption', 'RetainUIDsOption'])
    })

    it('should handle missing optional fields', async () => {
      const minimalConfig = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      const result = await Effect.runPromise(validateAppConfig(minimalConfig))
      expect(result).toBeDefined()
      expect(result.dicomServer.headers).toBeUndefined()
      expect(result.anonymization.replacements).toBeUndefined()
    })

    it('should accept mixed hex and tag name formats in preserveTags', async () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true,
          preserveTags: ['00080016', 'Modality', '00200013', 'Manufacturer'] // Mix of hex and names
        }
      }

      const result = await Effect.runPromise(validateAppConfig(config))
      expect(result).toBeDefined()
      expect(result.anonymization.preserveTags).toEqual(['00080016', 'Modality', '00200013', 'Manufacturer'])
    })
  })

  describe('parseAppConfig (sync)', () => {
    it('should parse valid config synchronously', () => {
      const config = {
        dicomServer: {
          url: '/api/test'
        },
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      const result = parseAppConfig(config)
      expect(result).toBeDefined()
      expect(result.dicomServer.url).toBe('/api/test')
    })

    it('should throw on invalid config', () => {
      const config = {
        dicomServer: {},
        anonymization: {
          profileOptions: ['BasicProfile'],
          removePrivateTags: true
        }
      }

      expect(() => parseAppConfig(config)).toThrow()
    })
  })

  describe('ProjectConfig validation', () => {
    const mockProjectConfig: ProjectConfig = {
      name: 'Test Project',
      id: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2023-12-01T10:00:00.000Z'
    }

    it('should validate valid ProjectConfig', async () => {
      const result = await Effect.runPromise(validateProjectConfig(mockProjectConfig))
      expect(result).toEqual(mockProjectConfig)
    })

    it('should fail validation for ProjectConfig missing name', async () => {
      const invalidProject = { ...mockProjectConfig }
      delete (invalidProject as any).name
      await expect(Effect.runPromise(validateProjectConfig(invalidProject))).rejects.toThrow(/is missing/)
    })

    it('should fail validation for invalid UUID', async () => {
      const invalidProject = { ...mockProjectConfig, id: 'invalid-uuid' }
      await expect(Effect.runPromise(validateProjectConfig(invalidProject))).rejects.toThrow()
    })

    it('should fail validation for invalid date', async () => {
      const invalidProject = { ...mockProjectConfig, createdAt: 'invalid-date' }
      await expect(Effect.runPromise(validateProjectConfig(invalidProject))).rejects.toThrow()
    })
  })

  describe('Config serialization/deserialization', () => {
    const mockAppConfig: AppConfig = {
      dicomServer: {
        url: '/api/orthanc/dicom-web',
        headers: {},
        timeout: 30000,
        auth: null,
        description: 'Test server'
      },
      anonymization: {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        uidStrategy: 'perRun',
        useCustomHandlers: true,
        dateJitterDays: 31,
        organizationRoot: '1.2.826.0.1.3680043.8.498',
        replacements: { default: 'REMOVED' }
      },
      project: {
        name: 'Test Project',
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2023-12-01T10:00:00.000Z'
      }
    }

    it('should encode and parse AppConfig correctly', () => {
      const encoded = encodeAppConfig(mockAppConfig)
      const parsed = parseAppConfig(encoded)
      expect(parsed).toEqual(mockAppConfig)
    })

    it('should handle AppConfig without project', async () => {
      const configWithoutProject = { ...mockAppConfig }
      delete configWithoutProject.project
      const encoded = encodeAppConfig(configWithoutProject)
      const parsed = parseAppConfig(encoded)
      expect(parsed).toEqual(configWithoutProject)
    })

    it('should survive JSON.stringify/parse roundtrip', async () => {
      // Simulate what happens in URL sharing
      const jsonString = JSON.stringify(mockAppConfig)
      const parsed = JSON.parse(jsonString)
      const result = await Effect.runPromise(validateAppConfig(parsed))
      expect(result).toEqual(mockAppConfig)
    })

    it('should extract project from AppConfig for validation', async () => {
      // Test the scenario that fails in e2e test
      const fullConfig = JSON.parse(JSON.stringify(mockAppConfig))
      
      // This should fail - we're validating full config as ProjectConfig
      await expect(Effect.runPromise(validateProjectConfig(fullConfig))).rejects.toThrow(/is missing/)
      
      // This should succeed - validating just the project part
      const projectResult = await Effect.runPromise(validateProjectConfig(fullConfig.project))
      expect(projectResult).toEqual(mockAppConfig.project)
    })
  })

  describe('URL config sharing scenario', () => {
    it('should handle loading full config from URL correctly', async () => {
      // This simulates the complete config sharing via URL
      const testConfig = {
        dicomServer: {
          url: "/api/orthanc/dicom-web",
          headers: {},
          timeout: 30000,
          auth: null,
          description: "Test server"
        },
        anonymization: {
          profileOptions: ["BasicProfile"],
          removePrivateTags: true,
          uidStrategy: "perRun",
          useCustomHandlers: true,
          dateJitterDays: 31,
          organizationRoot: "1.2.826.0.1.3680043.8.498",
          replacements: { default: "REMOVED" }
        },
        project: {
          name: "URL Test Project",
          id: "550e8400-e29b-41d4-a716-446655440000",
          createdAt: new Date().toISOString()
        }
      }

      // Base64 encoding like the sharing feature does
      const jsonString = JSON.stringify(testConfig)
      const base64 = Buffer.from(jsonString).toString('base64')
      const urlSafeBase64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      
      // Decode like loadConfigFromUrl does
      const paddedBase64 = urlSafeBase64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (urlSafeBase64.length % 4)) % 4)
      const decodedJsonString = atob(paddedBase64)
      const decodedConfig = JSON.parse(decodedJsonString)

      // This should be valid as a complete AppConfig (not just a project)
      const appConfigResult = await Effect.runPromise(validateAppConfig(decodedConfig))
      expect(appConfigResult).toBeDefined()
      expect(appConfigResult.project?.name).toBe("URL Test Project")
      expect(appConfigResult.dicomServer.url).toBe("/api/orthanc/dicom-web")
      expect(appConfigResult.anonymization.profileOptions).toEqual(["BasicProfile"])
    })

    it('should handle config without project correctly', async () => {
      // Test sharing config without a project
      const configWithoutProject = {
        dicomServer: {
          url: "/api/custom/dicom-web",
          headers: {},
          timeout: 45000,
          auth: null,
          description: "Custom server"
        },
        anonymization: {
          profileOptions: ["BasicProfile", "RetainUIDsOption"],
          removePrivateTags: false,
          organizationRoot: "1.2.3.4.5"
        }
      }

      const result = await Effect.runPromise(validateAppConfig(configWithoutProject))
      expect(result).toBeDefined()
      expect(result.project).toBeUndefined()
      expect(result.dicomServer.url).toBe("/api/custom/dicom-web")
    })
  })
})
