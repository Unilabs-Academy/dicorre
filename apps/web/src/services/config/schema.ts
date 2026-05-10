import { Schema } from "effect"
import { isValidTagName, isValidTagHex } from '@/utils/dicom-tag-dictionary'

const DicomServerAuthSchema = Schema.Struct({
  type: Schema.Literal("basic", "bearer"),
  credentials: Schema.String
})

export const DicomServerConfigSchema = Schema.Struct({
  url: Schema.String.pipe(
    Schema.minLength(1, { message: () => "DICOM server URL is required" }),
    Schema.filter((url) => url.startsWith("/") || url.startsWith("http"), {
      message: () => "URL must start with / or http"
    })
  ),
  headers: Schema.optional(Schema.Any),
  timeout: Schema.optional(Schema.Number.pipe(
    Schema.greaterThan(0, { message: () => "Timeout must be positive" }),
    Schema.lessThanOrEqualTo(600000, { message: () => "Timeout must not exceed 600000ms (10 minutes)" })
  )),
  auth: Schema.optional(Schema.NullOr(DicomServerAuthSchema)),
  description: Schema.optional(Schema.String),
  testConnectionPath: Schema.optional(Schema.String)
}).pipe(
  Schema.annotations({
    identifier: "DicomServerConfig",
    description: "DICOM server configuration"
  })
)

// DICOM Profile Options Schema - based on @umessen/dicom-deidentifier standard
const DicomProfileOptionSchema = Schema.Literal(
  "BasicProfile",
  "RetainLongModifDatesOption",
  "RetainLongFullDatesOption",
  "RetainUIDsOption",
  "CleanGraphOption",
  "RetainPatientCharsOption",
  "RetainSafePrivateOption",
  "CleanDescOption",
  "RetainDeviceIdentOption",
  "RetainInstIdentOption",
  "CleanStructContOption"
)

export type DicomProfileOption = Schema.Schema.Type<typeof DicomProfileOptionSchema>

const AnonymizationProfileOptionsSchema = Schema.Array(DicomProfileOptionSchema).pipe(
  Schema.minItems(1, { message: () => "At least one profile option is required" }),
  Schema.annotations({
    description: "Array of DICOM standard profile options. BasicProfile is always available as fallback."
  })
)

const ReplacementsSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String
}).pipe(
  Schema.annotations({
    description: "Replacement values for DICOM tags. Keys can be tag names (e.g., 'Patient Name') or the special key 'default'. Values can use {random} placeholder for 7-character uppercase ASCII strings."
  })
)

const UidStrategySchema = Schema.Literal(
  "perRun",
  "deterministic"
)

export const AnonymizationConfigSchema = Schema.Struct({
  removePrivateTags: Schema.Boolean,
  profileOptions: AnonymizationProfileOptionsSchema,
  replacements: Schema.optional(ReplacementsSchema),
  preserveTags: Schema.optional(Schema.Array(Schema.String.pipe(
    Schema.filter((tag) => {
      // Accept either valid tag names or hex values
      return isValidTagName(tag) || isValidTagHex(tag)
    }, {
      message: () => "Tag must be a valid DICOM tag name (e.g., 'Modality') or 8 hex characters (e.g., 00080016)"
    })
  ))),
  tagsToRemove: Schema.optional(Schema.Array(Schema.String)),
  dateJitterDays: Schema.optional(Schema.Number.pipe(
    Schema.greaterThanOrEqualTo(0, { message: () => "dateJitterDays must be >= 0" }),
    Schema.lessThanOrEqualTo(365, { message: () => "dateJitterDays must be <= 365" })
  )),
  useCustomHandlers: Schema.optional(Schema.Boolean),
  uidStrategy: Schema.optional(UidStrategySchema),
  organizationRoot: Schema.optional(Schema.String.pipe(
    Schema.filter((oid) => /^[0-9.]+$/.test(oid), {
      message: () => "Organization root must be a valid OID (digits and dots only)"
    })
  ))
})

// Project configuration schema
export const ProjectConfigSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Project name is required" }),
    Schema.maxLength(100, { message: () => "Project name must be 100 characters or less" })
  ),
  id: Schema.String.pipe(
    Schema.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id), {
      message: () => "Project ID must be a valid UUID v4"
    })
  ),
  createdAt: Schema.String.pipe(
    Schema.filter((date) => !isNaN(Date.parse(date)), {
      message: () => "createdAt must be a valid ISO date string"
    })
  ),
  plugins: Schema.optional(
    Schema.Struct({
      settings: Schema.optional(Schema.Record({
        key: Schema.String,
        value: Schema.Any
      }))
    })
  )
}).pipe(
  Schema.annotations({
    identifier: "ProjectConfig",
    description: "Project configuration for sharing settings"
  })
)

// Plugin configuration schemas
const PluginSettingsSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Any
}).pipe(
  Schema.annotations({
    description: "Settings for individual plugins"
  })
)

const PluginsConfigSchema = Schema.Struct({
  enabled: Schema.Array(Schema.String).pipe(
    Schema.annotations({
      description: "List of enabled plugin IDs"
    })
  ),
  settings: Schema.optional(PluginSettingsSchema)
}).pipe(
  Schema.annotations({
    identifier: "PluginsConfig",
    description: "Plugin configuration including enabled plugins and their settings"
  })
)

export const CURRENT_CONFIG_VERSION = 1 as const

export const AppConfigSchema = Schema.Struct({
  // Version is optional to allow loading legacy configs; migration will enforce current version.
  version: Schema.optional(Schema.Number),
  dicomServer: DicomServerConfigSchema,
  anonymization: AnonymizationConfigSchema,
  project: Schema.optional(ProjectConfigSchema),
  plugins: Schema.optional(PluginsConfigSchema)
})

// Type extraction
export type AppConfig = Schema.Schema.Type<typeof AppConfigSchema>
export type AppConfigInput = Schema.Schema.Encoded<typeof AppConfigSchema>
export type AnonymizationConfig = Schema.Schema.Type<typeof AnonymizationConfigSchema>
export type UidStrategy = Schema.Schema.Type<typeof UidStrategySchema>
export type DicomServerConfig = Schema.Schema.Type<typeof DicomServerConfigSchema>
export type ProjectConfig = Schema.Schema.Type<typeof ProjectConfigSchema>
export type PluginsConfig = Schema.Schema.Type<typeof PluginsConfigSchema>

// Validation functions
export const validateAppConfig = (input: unknown) =>
  Schema.decodeUnknown(AppConfigSchema)(input)

export const validateProjectConfig = (input: unknown) =>
  Schema.decodeUnknown(ProjectConfigSchema)(input)

// Parse function that throws on error (for simpler integration)
export const parseAppConfig = Schema.decodeUnknownSync(AppConfigSchema)

// Encode function to convert back to JSON-safe format
export const encodeAppConfig = Schema.encodeSync(AppConfigSchema)
