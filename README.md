<img src="./apps/web/public/logo.png" alt="Dicorre Logo" width="250">

# Dicorre - DICOM Anonymizer & Sender

Dicorre is a pnpm monorepo for anonymizing DICOM studies, packaging anonymized output, and sending cases to DICOMweb destinations.

The project now has two app entrypoints:

- `apps/web` (`@dicorre/web`): browser UI for interactive case processing.
- `apps/cli` (`@dicorre/cli`): installable, agent-readable CLI for automated case workflows.

Shared anonymization, DICOM processing, sending, storage contracts, and plugin logic live under `packages/shared` and `packages/plugins`.

Still in beta. Use with caution, especially with real medical data and production DICOM destinations.

## Quick Start

Install dependencies from the repo root:

```bash
pnpm install
```

Start the web app:

```bash
pnpm dev
```

The web app runs at http://localhost:5173.

Run the CLI from the workspace:

```bash
pnpm cli -- discover
pnpm cli -- help ingest
```

## Web App

The web app is a Vue 3 application for interactive workflows:

- Upload DICOM files, ZIP/RAR archives, images, PDFs, and videos.
- Review grouped studies and metadata.
- Apply project configuration and anonymization settings.
- Download anonymized ZIP packages.
- Send anonymized studies to a configured DICOMweb STOW-RS endpoint.
- Use WebMCP agent tools for browser-mediated automation.

Useful commands:

```bash
pnpm --filter @dicorre/web dev
pnpm --filter @dicorre/web build
pnpm --filter @dicorre/web test:unit
pnpm --filter @dicorre/web test:e2e --workers=1
```

## CLI App

The CLI provides the same core workflow without a browser. It is designed for agents and automation: commands return JSON on stdout, write errors to stderr, and expose structured command discovery.

Run locally from the repo:

```bash
pnpm --filter @dicorre/cli cli discover
pnpm --filter @dicorre/cli cli help ingest
```

Build and test the installable package locally:

```bash
pnpm --filter @dicorre/cli build
pnpm --dir apps/cli pack --pack-destination /tmp/dicorre-cli-pack-test
mkdir -p /tmp/dicorre-cli-install-test
cd /tmp/dicorre-cli-install-test
npm init -y
npm install /tmp/dicorre-cli-pack-test/dicorre-cli-0.0.1.tgz
./node_modules/.bin/dicorre discover
```

After publication, expected usage is:

```bash
npx @dicorre/cli discover
pnpm dlx @dicorre/cli help ingest
```

See [CLI documentation](docs/cli.md) for command workflows, options, packaging checks, and agent guidance.

## Development DICOM Server

For local send testing, start Orthanc:

```bash
docker-compose up -d
```

Orthanc is available at http://localhost:8080/app/explorer.html.

## Configuration

The default app config is in `packages/shared/app.config.json`. Project-specific configs can be loaded through the web app or passed to CLI commands with `--config <config.json>`.

See [configuration.md](docs/configuration.md) for schema details and examples.

## Features

- DICOM anonymization with configurable profiles and replacements.
- DICOMweb STOW-RS sending with retry and large-file handling.
- ZIP/RAR and directory ingestion.
- Image, PDF, and video conversion into Secondary Capture DICOM.
- Study grouping, study merge, custom field overrides, and project metadata.
- Receipt verification, send logging, and sent notification plugins.
- Agent-readable CLI discovery and WebMCP browser automation support.

## Architecture

The monorepo is organized around app-specific shells and shared core packages:

- `apps/web`: Vue, Vite, browser storage, UI components, and WebMCP tools.
- `apps/cli`: Node CLI, filesystem workspace storage, JSON persistence, and npm packaging.
- `packages/shared`: Effect services for config, anonymization, DICOM parsing/sending, downloads, study logs, receipt verification, and shared types.
- `packages/plugins`: shared plugin implementations plus web and Node-specific converters.

Core services include:

- `ConfigService`: configuration validation, migration, persistence, and project state.
- `DicomProcessor`: DICOM parsing, validation, metadata extraction, and study grouping.
- `Anonymizer`: DICOM de-identification using `@umessen/dicom-deidentifier`.
- `DicomSender`: DICOMweb STOW-RS client and send result handling.
- `DownloadService`: anonymized ZIP package creation.
- `PluginRegistry`: file-format and hook plugin management.

## Development Commands

From the repo root:

```bash
pnpm type-check
pnpm test:unit
pnpm build
pnpm lint
```

Target a single app or package with `--filter`, for example:

```bash
pnpm --filter @dicorre/cli test:unit
pnpm --filter @dicorre/web build
```
