<img src="./public/logo.png" alt="Dicorre Logo" width="250">

# Dicorre - DICOM Anonymizer & Sender

🚨 **Still in beta - use with caution**

A browser-based tool for anonymizing DICOM files and sending them to radiology destinations via DICOMweb.

Developed by Unilabs Academy to facilitate anonymisation and uploading of cases at https://academy.unilabs.com

## Quick Start

### 1. Start the Development Server

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The application will be available at: http://localhost:5173

### 2. [OPTIONAL] Start the development DICOM Server (Orthanc)

```bash
# Start Orthanc DICOM server
docker-compose up -d
```
Access Orthanc web interface at: http://localhost:8080/app/explorer.html

### 3. Testing

```bash
# Unit tests
pnpm test:unit

#E2E tests
pnpm test:e2e --workers=1
```

### 4. Configuration

See app.config.json

### 5. CLI

The CLI exposes agent-readable JSON help:

```bash
pnpm --filter @dicorre/cli cli discover
pnpm --filter @dicorre/cli cli help ingest
```

See [CLI documentation](docs/cli.md) for workflows, commands, options, and examples.

## Features

- **DICOM Anonymization**: Remove patient identifiable information from DICOM files
- **DICOMweb Sending**: Send anonymized files to PACS/radiology destinations via STOW-RS
- **Batch Processing**: Process multiple files and ZIP archives
- **Plugin Architecture**: Extensible system for format converters and custom processing
- **Session Persistence**: Automatic save/restore of anonymization progress
- **Configuration Management**: Save and share project configurations

## Architecture

### Core Services

- **FileHandler**: ZIP extraction, file validation, and grouping by study/series
- **DicomProcessor**: DICOM parsing with dcmjs, metadata extraction
- **Anonymizer**: DICOM de-identification with configurable profiles (@umessen/dicom-deidentifier)
- **DicomSender**: DICOMweb STOW-RS client for sending to PACS
- **OpfsStorage**: Browser-based file storage using Origin Private File System
- **SessionPersistence**: Automatic save/restore of session state
- **ConfigService**: Configuration service with persistance
- **DownloadService**: Export anonymized files as ZIP
- **PluginRegistry**: Plugin management system

### Plugins

- **ImageConverter**: Convert JPEG/PNG images to DICOM images
- **PdfConverter**: Convert PDF documents to DICOM series
- **SentNotifier**: Configurable notifier for external system upon hook triggers
- **SendLogger**: Log all transmitted DICOM files for audit (Example plugin)

### Tech Stack

- **Frontend**: Vue 3 + TypeScript + Effect + Vite
- **Anonymization**: @umessen/dicom-deidentifier
- **DICOM Processing**: dcmjs
- **DICOM Sending**: dicomweb-client
- **File Handling**: JSZip

## Development Commands

```bash
# Type checking
pnpm type-check

# Linting
pnpm lint

# Build for production
pnpm build
```
