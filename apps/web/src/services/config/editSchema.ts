import type { DicomProfileOption } from './schema'

export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'record'
  | 'array'
  | 'readonly'

export interface FieldSchema {
  type: FieldType
  label: string
  description?: string
  placeholder?: string
  required?: boolean
  min?: number
  max?: number
  options?: Array<{ value: string; label: string }>
  itemType?: FieldType // For arrays
  valueType?: FieldType // For records
  editable?: boolean // Default true
  pattern?: string // For validation
  patternMessage?: string
}

export interface ConfigEditSchema {
  [key: string]: FieldSchema | ConfigEditSchema
}

// Define the profile options with descriptions
const profileOptions: Array<{ value: DicomProfileOption; label: string; description: string }> = [
  {
    value: 'BasicProfile',
    label: 'Basic Profile',
    description: 'Default anonymization profile - removes most identifying information'
  },
  {
    value: 'RetainLongModifDatesOption',
    label: 'Retain Long Modified Dates',
    description: 'Keep long-format modification dates'
  },
  {
    value: 'RetainLongFullDatesOption',
    label: 'Retain Long Full Dates',
    description: 'Keep full-format dates'
  },
  {
    value: 'RetainUIDsOption',
    label: 'Retain UIDs',
    description: 'Preserve unique identifiers (useful for maintaining relationships)'
  },
  {
    value: 'CleanGraphOption',
    label: 'Clean Graph',
    description: 'Remove burned-in annotations from images'
  },
  {
    value: 'RetainPatientCharsOption',
    label: 'Retain Patient Characteristics',
    description: 'Keep patient age, sex, and other characteristics'
  },
  {
    value: 'RetainSafePrivateOption',
    label: 'Retain Safe Private',
    description: 'Keep private tags deemed safe'
  },
  {
    value: 'CleanDescOption',
    label: 'Clean Descriptions',
    description: 'Remove descriptive text fields'
  },
  {
    value: 'RetainDeviceIdentOption',
    label: 'Retain Device Identity',
    description: 'Keep device and equipment identifiers'
  },
  {
    value: 'RetainInstIdentOption',
    label: 'Retain Institution Identity',
    description: 'Keep institution names and identifiers'
  },
  {
    value: 'CleanStructContOption',
    label: 'Clean Structured Content',
    description: 'Remove structured report content'
  }
]

export const appConfigEditSchema: ConfigEditSchema = {
  project: {
    name: {
      type: 'text',
      label: 'Project Name',
      description: 'Human-readable project name',
      placeholder: 'Untitled',
      required: true
    },
    id: {
      type: 'readonly',
      label: 'Project ID',
      description: 'Auto-generated UUID v4'
    },
    createdAt: {
      type: 'readonly',
      label: 'Created At',
      description: 'ISO timestamp when the project was created'
    }
    // Note: project plugin settings are intentionally omitted. Use top-level `plugins` below.
  },
  dicomServer: {
    url: {
      type: 'text',
      label: 'Server URL',
      description: 'DICOM server endpoint (must start with / or http)',
      placeholder: '/api/orthanc/dicom-web',
      required: true,
      pattern: '^(/|http)',
      patternMessage: 'URL must start with / or http'
    },
    headers: {
      type: 'record',
      label: 'Headers',
      description: 'Additional HTTP headers to include with DICOM requests',
      valueType: 'text'
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Request timeout in milliseconds',
      placeholder: '30000',
      min: 1000,
      max: 600000
    },
    testConnectionPath: {
      type: 'text',
      label: 'Test Connection Path',
      description: 'Relative path appended to the base URL when testing connectivity',
      placeholder: '/studies'
    },
    auth: {
      type: {
        type: 'select',
        label: 'Authentication Type',
        description: 'Type of authentication to use',
        options: [
          { value: 'none', label: 'None' },
          { value: 'basic', label: 'Basic Auth' },
          { value: 'bearer', label: 'Bearer Token' }
        ]
      },
      credentials: {
        type: 'text',
        label: 'Credentials',
        description: 'Authentication credentials (username:password for basic, token for bearer)',
        placeholder: 'Enter credentials'
      }
    },
    description: {
      type: 'text',
      label: 'Description',
      description: 'Optional description of this server',
      placeholder: 'Production PACS server'
    }
  },
  anonymization: {
    profileOptions: {
      type: 'multiselect',
      label: 'Anonymization Profiles',
      description: 'Select one or more DICOM anonymization profiles',
      required: true,
      options: profileOptions.map(p => ({ value: p.value, label: `${p.label} - ${p.description}` }))
    },
    removePrivateTags: {
      type: 'boolean',
      label: 'Remove Private Tags',
      description: 'Remove all private DICOM tags during anonymization'
    },
    useCustomHandlers: {
      type: 'boolean',
      label: 'Use Custom Handlers',
      description: 'Enable custom anonymization handlers for specific tags'
    },
    uidStrategy: {
      type: 'select',
      label: 'UID Strategy',
      description: 'Choose whether core UIDs are stable or regenerated for each anonymization run',
      options: [
        { value: 'perRun', label: 'Per Run (new UIDs each run)' },
        { value: 'deterministic', label: 'Deterministic (stable mapping)' }
      ]
    },
    dateJitterDays: {
      type: 'number',
      label: 'Date Jitter (days)',
      description: 'Random date shift range for temporal anonymization',
      min: 0,
      max: 365,
      placeholder: '31'
    },
    organizationRoot: {
      type: 'text',
      label: 'Organization Root OID',
      description: 'Organization root OID for generating new UIDs',
      placeholder: '1.2.826.0.1.3680043.8.498',
      pattern: '^[0-9.]+$',
      patternMessage: 'Must be a valid OID (digits and dots only)'
    },
    replacements: {
      type: 'record',
      label: 'Tag Replacements',
      description: 'Custom replacement values for specific tags. Use {random} for random values.',
      valueType: 'text'
    },
    preserveTags: {
      type: 'array',
      label: 'Preserve Tags',
      description: 'List of DICOM tags to preserve during anonymization',
      itemType: 'text'
    },
    tagsToRemove: {
      type: 'array',
      label: 'Tags to Remove',
      description: 'Additional tags to remove (supports patterns like "startswith:", "contains:")',
      itemType: 'text'
    }
  },
  plugins: {
    enabled: {
      type: 'multiselect',
      label: 'Enabled Plugins',
      description: 'Select which plugins to enable',
      options: [
        { value: 'image-converter', label: 'Image Converter' },
        { value: 'pdf-converter', label: 'PDF Converter' },
        { value: 'video-converter', label: 'Video Converter' },
        { value: 'send-logger', label: 'Send Logger' },
        { value: 'sent-notifier', label: 'Sent Notifier' }
      ]
    },
    settings: {
      type: 'record',
      label: 'Plugin Settings',
      description: 'Configuration for individual plugins',
      valueType: 'text',
      editable: false // Plugin settings are complex, might need special handling
    }
  }
}

// Helper to check if a field should be shown based on other values
export function shouldShowField(fieldPath: string, config: any): boolean {
  // Show auth.credentials only if auth.type is not 'none'
  if (fieldPath === 'dicomServer.auth.credentials') {
    return config?.dicomServer?.auth?.type && config.dicomServer.auth.type !== 'none'
  }

  return true
}

// Helper to get default values
export function getDefaultValue(fieldSchema: FieldSchema): any {
  switch (fieldSchema.type) {
    case 'boolean':
      return false
    case 'number':
      return fieldSchema.min || 0
    case 'array':
      return []
    case 'record':
      return {}
    case 'multiselect':
      return []
    default:
      return ''
  }
}
