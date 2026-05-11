# Configuration Guide

This document describes all configuration options available in the DICOM anonymization and sending tool.

## Table of Contents

- [Overview](#overview)
- [DICOM Server Configuration](#dicom-server-configuration)
- [Anonymization Configuration](#anonymization-configuration)
  - [Profile Options](#profile-options)
  - [Other Settings](#other-settings)
- [Plugin Configuration](#plugin-configuration)
- [Configuration File Format](#configuration-file-format)

## Overview

The application uses a JSON configuration file (`app.config.json`) to define DICOM server connections, anonymization settings, and plugin configurations. The configuration system validates all settings against DICOM standards and best practices.

## DICOM Server Configuration

### `dicomServer`

Configures the target DICOM server for sending anonymized files.

```json
{
  "dicomServer": {
    "url": "/api/orthanc/dicom-web",
    "headers": {},
    "timeout": 30000,
    "auth": null,
    "description": "Orthanc DICOM-Web server configuration"
  }
}
```

**Fields:**
- `url` (required): Server URL. Must start with `/` (relative) or `http` (absolute)
- `headers` (optional): Additional HTTP headers to send with requests
- `timeout` (optional): Request timeout in milliseconds (1-600000ms, default: 30000)
- `auth` (optional): Authentication configuration (`null`, `"basic"`, or `"bearer"`)
- `description` (optional): Human-readable description of the server

## Anonymization Configuration

### `anonymization`

Controls how DICOM files are de-identified before sending.

```json
{
  "anonymization": {
    "profileOptions": ["BasicProfile"],
    "removePrivateTags": true,
    "useCustomHandlers": true,
    "dateJitterDays": 31,
    "organizationRoot": "1.2.826.0.1.3680043.8.498",
    "replacements": {
      "default": "REMOVED",
      "patientName": "ANONYMOUS",
      "patientId": "PAT{timestamp}",
      "accessionNumber": "ACA{timestamp}",
      "patientBirthDate": "19000101",
      "institution": "ANONYMIZED"
    },
    "preserveTags": ["00080016", "00080018"],
    "tagsToRemove": ["PatientAddress", "ReferringPhysicianName"],
    "customReplacements": {}
  }
}
```

### Profile Options

The `profileOptions` field accepts an array of DICOM standard profile options. These options are based on **DICOM PS 3.15 Part 15 Annex E** - the official standard for medical image de-identification.

> **Reference**: [DICOM PS 3.15 - Security and System Management Profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_e.html)

#### Available Profile Options

##### `BasicProfile` (Always Required)
The foundational de-identification profile that removes most identifying information.

- **Purpose**: Provides conservative de-identification for clinical trials, teaching files, and publications
- **Action**: Removes patient demographics, personnel identities, organization information, UIDs, dates/times, and private attributes
- **Note**: Does not address information "burned in" to pixel data unless additional options are specified
- **Reference**: [Basic Application Level Confidentiality Profile](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.2.html)

##### `RetainLongModifDatesOption`
Preserves temporal relationships between studies while modifying actual dates.

- **Purpose**: Maintains longitudinal study relationships for research while protecting privacy
- **Action**: Shifts all dates/times by a consistent offset, preserving relative timing
- **Use Case**: Multi-visit studies, follow-up imaging, treatment monitoring
- **Privacy Impact**: Low - actual dates are modified but relationships preserved
- **Reference**: [Retain Longitudinal Temporal Information](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `RetainLongFullDatesOption`
Preserves original dates and times without modification.

- **Purpose**: Maintains exact temporal information for studies requiring precise timing
- **Action**: Keeps original dates and times unchanged
- **Use Case**: Research requiring exact timing, regulatory submissions
- **Privacy Impact**: Higher - original dates may aid re-identification
- **Reference**: [Retain Longitudinal Temporal Information](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `RetainUIDsOption`
Preserves DICOM Unique Identifiers for maintaining object relationships.

- **Purpose**: Maintains relationships between related DICOM objects and studies
- **Action**: Keeps Study, Series, and SOP Instance UIDs unchanged
- **Use Case**: Multi-object studies, complex image sets, research databases
- **Privacy Impact**: Medium - UIDs may help link anonymized data
- **Reference**: [Retain UIDs Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `CleanGraphOption`
Removes or cleans graphical annotations that may contain identifying information.

- **Purpose**: Addresses text or graphics overlaid on images that might contain PHI
- **Action**: Removes or cleans graphic overlays and annotations
- **Use Case**: Images with burned-in text, annotations, or graphic overlays
- **Privacy Impact**: Reduces risk from visual identifiers in image data
- **Reference**: [Clean Graphics Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `RetainPatientCharsOption`
Preserves patient demographic characteristics needed for research.

- **Purpose**: Retains age, sex, and other characteristics for clinical research
- **Action**: Keeps demographic fields that don't directly identify individuals
- **Use Case**: Population studies, demographic analysis, clinical trials
- **Privacy Impact**: Low - general characteristics without direct identifiers
- **Reference**: [Retain Patient Characteristics](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `RetainSafePrivateOption`
Preserves private DICOM tags known to be safe (non-identifying).

- **Purpose**: Keeps vendor-specific tags that don't contain PHI
- **Action**: Retains private tags identified as safe through analysis
- **Use Case**: Preserving vendor-specific technical parameters
- **Privacy Impact**: Low - only for pre-validated safe private tags
- **Reference**: [Retain Safe Private Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `CleanDescOption`
Cleans descriptive text fields instead of removing them entirely.

- **Purpose**: Preserves clinical descriptions while removing identifying details
- **Action**: Modifies text fields to remove names and identifiers
- **Use Case**: Maintaining clinical context while protecting privacy
- **Privacy Impact**: Medium - requires careful cleaning of text content
- **Reference**: [Clean Descriptors Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `RetainDeviceIdentOption`
Preserves imaging device and scanner identification information.

- **Purpose**: Maintains equipment information for technical analysis
- **Action**: Keeps manufacturer, model, and device serial numbers
- **Use Case**: Multi-site studies, equipment validation, technical research
- **Privacy Impact**: Low - device information rarely identifies patients
- **Reference**: [Retain Device Identity Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `RetainInstIdentOption`
Preserves institution and facility identification.

- **Purpose**: Maintains institutional information for multi-site studies
- **Action**: Keeps institution names and identifiers
- **Use Case**: Multi-center trials, institutional analysis
- **Privacy Impact**: Medium - institutional data may narrow identification
- **Reference**: [Retain Institution Identity Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

##### `CleanStructContOption`
Cleans structured content that may contain identifying information.

- **Purpose**: Addresses structured reports and documents embedded in DICOM
- **Action**: Cleans structured content fields of identifying information
- **Use Case**: DICOM-SR (Structured Reports), embedded documents
- **Privacy Impact**: Medium - depends on content of structured data
- **Reference**: [Clean Structured Content Option](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)

#### Profile Option Combinations

Profile options can be combined to achieve specific de-identification goals:

**Conservative (Maximum Privacy)**:
```json
"profileOptions": ["BasicProfile"]
```

**Research-Friendly**:
```json
"profileOptions": ["BasicProfile", "RetainLongModifDatesOption", "RetainUIDsOption", "RetainDeviceIdentOption"]
```

**Multi-Center Study**:
```json
"profileOptions": ["BasicProfile", "RetainLongModifDatesOption", "RetainUIDsOption", "RetainInstIdentOption", "RetainDeviceIdentOption"]
```

### Other Settings

#### `removePrivateTags` (boolean)
Controls whether private DICOM tags are removed.
- `true`: Remove all private tags (recommended for maximum privacy)
- `false`: Preserve private tags (may contain vendor-specific PHI)

#### `dateJitterDays` (number, 0-365)
Number of days to randomly shift dates when using temporal modification options.
- Adds randomness to date shifting for additional privacy protection
- Only effective with `RetainLongModifDatesOption`

#### `organizationRoot` (string)
Organization Identifier (OID) root for generating new UIDs.
- Must be a valid OID format (digits and dots)
- Used when creating replacement UIDs

#### `replacements` (object)
Default replacement values for various DICOM fields.
- `default`: Default replacement for any cleaned field
- `patientName`: Replacement for patient name fields
- `patientId`: Template for patient ID (supports `{timestamp}` placeholder)
- `accessionNumber`: Template for accession numbers
- `patientBirthDate`: Replacement birth date
- `institution`: Replacement institution name

#### `preserveTags` (array)
List of DICOM tags to always preserve (in 8-character hex format).
- Example: `["00080016", "00080018"]` preserves SOP Class UID and SOP Instance UID
- Takes precedence over profile option removal rules

#### `tagsToRemove` (array)  
List of specific DICOM tags to always remove.
- Can use tag names, prefixes (`startswith:`), or patterns (`contains:`)
- Takes precedence over profile option retention rules

#### `customReplacements` (object)
Custom replacement values for specific DICOM tags.
- Key: DICOM tag or tag name
- Value: Replacement value

## Plugin Configuration

### `plugins`

Configures optional plugins for file format conversion, logging, notifications, and receipt verification.

```json
{
  "plugins": {
    "enabled": ["image-converter", "pdf-converter", "send-logger"],
    "settings": {
      "image-converter": {
        "defaultModality": "OT",
        "defaultSeriesDescription": "Converted Image"
      },
      "pdf-converter": {
        "defaultModality": "DOC", 
        "defaultSeriesDescription": "PDF Conversion"
      },
      "send-logger": {
        "logLevel": "detailed"
      },
      "receipt-verifier": {
        "provider": "dicomweb-qido",
        "url": "http://127.0.0.1:8080/dicom-web",
        "archive": 1,
        "headers": {},
        "auth": null,
        "pollIntervalMs": 10000,
        "timeoutMs": 60000,
        "requireInstanceCountMatch": true
      }
    }
  }
}
```

`receipt-verifier` is disabled unless its plugin ID is included in `plugins.enabled`. Supported providers:

- `dicomweb-qido`: generic QIDO-RS study search. It queries by Study Instance UID first, then accession/patient fallback.
- `orthanc-dicomweb`: alias for `dicomweb-qido` with Orthanc-style DICOMweb configuration.
- `pacscenter`: PACScenter study search API plus optional detail lookup for image counts.

Secret-bearing `headers` and `auth` values can be used for verification requests; UI and log summaries should only display header names or auth presence.

## Configuration File Format

The complete configuration file structure:

```json
{
  "dicomServer": {
    "url": "string (required)",
    "headers": "object (optional)",
    "timeout": "number (optional)",
    "auth": "object|null (optional)",
    "description": "string (optional)"
  },
  "anonymization": {
    "profileOptions": "array<DicomProfileOption> (required)",
    "removePrivateTags": "boolean (required)",
    "useCustomHandlers": "boolean (optional)",
    "dateJitterDays": "number 0-365 (optional)",
    "organizationRoot": "string OID format (optional)",
    "replacements": "object (optional)",
    "preserveTags": "array<string> (optional)",
    "tagsToRemove": "array<string> (optional)",
    "customReplacements": "object (optional)",
    "tagDescriptions": "object (optional)"
  },
  "plugins": {
    "enabled": "array<string> (optional)",
    "settings": "object (optional)"
  }
}
```

## Important Notes

### Privacy and Compliance

- **De-identification ≠ Anonymization**: DICOM de-identification reduces but does not eliminate re-identification risk
- **Regulatory Compliance**: Consult legal and compliance teams for HIPAA, GDPR, and other regulations
- **Risk Assessment**: Evaluate re-identification risk based on your specific use case and data environment

### Best Practices

1. **Start Conservative**: Begin with `BasicProfile` only and add options as needed
2. **Document Choices**: Document which profile options are used and why
3. **Test Thoroughly**: Validate de-identification results before production use
4. **Regular Review**: Periodically review and update configuration as requirements change

### References

- [DICOM PS 3.15 - Security and System Management Profiles](https://dicom.nema.org/medical/dicom/current/output/html/part15.html)
- [Basic Application Level Confidentiality Profile](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.2.html)
- [Confidentiality Profile Options](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_e.3.html)
- [DICOM Standard Overview](https://www.dicomstandard.org/current)
