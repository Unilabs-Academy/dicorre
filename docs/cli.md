# Dicorre CLI

The Dicorre CLI runs the same core DICOM workflow without a browser: ingest files, group studies, anonymize, download ZIP packages, send to DICOMweb, and manage project/config state.

From the repository, run commands through pnpm:

```bash
pnpm --filter @dicorre/cli cli help
```

When installed as a binary, the command shape is:

```bash
dicorre help
```

All CLI commands print JSON to stdout. Failed commands write an error message to stderr and exit non-zero.

## Agent Discovery

Agents should inspect the command catalog before choosing commands:

```bash
dicorre discover
dicorre help
dicorre help ingest
dicorre ingest --help
```

`help` and `discover` return structured JSON with:

- `docs`: this document path.
- `usage`: runnable command forms.
- `commands`: command names, summaries, arguments, options, examples, and output descriptions.

Top-level `--help` also returns the full catalog:

```bash
dicorre --help
```

Per-command `--help` returns only that command's entry and does not execute the command:

```bash
dicorre send --help
```

## Workspace Model

Most commands operate on a workspace. By default the workspace is `.dicorre`, and the state file is `<workspace>/state.json`.

Use a dedicated workspace per case or batch:

```bash
dicorre ingest case.zip --workspace .dicorre/case-001
dicorre studies --workspace .dicorre/case-001
```

Common options:

- `--workspace <dir>`: workspace directory for config, state, and stored files.
- `--state <file>`: override state file path for commands that read or write state.
- `--config <config.json>`: load a config for that command run.
- `--concurrency <number>`: maximum concurrent file operations where supported.
- `--study <all|uid[,uid]>`: select studies for commands that operate on studies. It defaults to `all`.

## Typical Workflow

```bash
dicorre config-validate project.config.json
dicorre ingest ./case.zip --workspace .dicorre/case-001 --config project.config.json
dicorre studies --workspace .dicorre/case-001
dicorre anonymize --study all --workspace .dicorre/case-001 --config project.config.json
dicorre download --study all --workspace .dicorre/case-001 --out anonymized.zip
dicorre send --study all --workspace .dicorre/case-001 --config project.config.json
```

## Commands

### `help`

Return structured CLI help as JSON.

```bash
dicorre help [command]
dicorre <command> --help
```

Examples:

```bash
dicorre help
dicorre help ingest
dicorre ingest --help
```

### `discover`

Return the full command catalog as JSON. This is equivalent to top-level `help` and is named for automation.

```bash
dicorre discover
```

### `ingest`

Read DICOM files, directories, ZIP/RAR archives, and supported media inputs into CLI state.

```bash
dicorre ingest <paths...> [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>] [--no-converted]
```

Supported direct inputs include DICOM files, ZIP, RAR, directories, JPG/JPEG, PNG, BMP, PDF, MP4, WebM, and OGV. ZIP/RAR archives are filtered so non-DICOM files and pseudo-DICOM entries without required identity tags are skipped.

`--no-converted` disables Node-side placeholder conversion for media formats and keeps ingestion to DICOM/archive inputs.

Output:

```json
{
  "filesRead": 2,
  "filesParsed": 2,
  "studies": 1,
  "statePath": "/abs/path/.dicorre/state.json"
}
```

### `studies`

List studies currently stored in CLI state.

```bash
dicorre studies [--workspace <dir>] [--state <file>]
```

Output is an array. Use `studyInstanceUID` or `id` values with study-selection commands.

### `anonymize`

Anonymize selected studies and update CLI state.

```bash
dicorre anonymize [--study <all|uid[,uid]>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>]
```

Output:

```json
{
  "studies": 1,
  "files": 2,
  "statePath": "/abs/path/.dicorre/state.json"
}
```

### `download`

Package selected studies into one or more ZIP files.

```bash
dicorre download [--study <all|uid[,uid]>] [--out <download.zip>] [--workspace <dir>] [--state <file>]
```

If multiple packages are produced, numbered suffixes are added to the requested output path.

### `send`

Send selected studies to the configured DICOMweb STOW-RS endpoint.

```bash
dicorre send [--study <all|uid[,uid]>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>]
```

The DICOMweb endpoint comes from the active config's `dicomServer.url`.

Output:

```json
{
  "studies": 1,
  "succeeded": 2,
  "failed": 0,
  "skipped": 0
}
```

### `config-validate`

Validate a config JSON file without loading it into workspace state.

```bash
dicorre config-validate <config.json> [--workspace <dir>]
```

Successful output:

```json
{ "valid": true }
```

### `config-load`

Validate and persist a config JSON file into the workspace.

```bash
dicorre config-load <config.json> [--workspace <dir>]
```

### `config-show`

Print the current workspace config.

```bash
dicorre config-show [--workspace <dir>]
```

### `project-create`

Create or replace active project metadata in workspace config.

```bash
dicorre project-create <name> [--workspace <dir>]
```

### `project-clear`

Clear active project metadata from workspace config.

```bash
dicorre project-clear [--workspace <dir>]
```

### `field-set`

Set a custom DICOM field override for one study in CLI state. Overrides are applied on anonymization.

```bash
dicorre field-set <study-uid> <field> <value> [--workspace <dir>] [--state <file>]
```

Example:

```bash
dicorre field-set 1.2.840.example "Study Description" "Training Case"
```

### `field-clear`

Remove a custom DICOM field override from one study.

```bash
dicorre field-clear <study-uid> <field> [--workspace <dir>] [--state <file>]
```

### `study-merge`

Merge two or more studies in CLI state into the first selected study.

```bash
dicorre study-merge <study-uid> <study-uid> [...study-uid] [--workspace <dir>] [--state <file>]
```

Use this when separate inputs should be treated as a single study for downstream anonymization, download, or sending.

## Config Notes

The default config lives at `packages/shared/app.config.json`. See [configuration.md](configuration.md) for the full config schema and examples.

For sending, set `dicomServer.url` to the DICOMweb base URL, for example:

```json
{
  "dicomServer": {
    "url": "http://127.0.0.1:8080/dicom-web",
    "timeout": 30000
  }
}
```

## Agent Checklist

1. Run `dicorre discover` to inspect commands and examples.
2. Pick or create a dedicated `--workspace`.
3. Validate config with `config-validate` before using it.
4. Run `ingest`, then `studies` to get study IDs.
5. Use `anonymize`, `download`, and `send` with `--study all` or explicit study UIDs.
6. Read JSON outputs instead of scraping logs.
