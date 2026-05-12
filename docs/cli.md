# Dicorre CLI

The Dicorre CLI runs the same core DICOM workflow without a browser: ingest files, group studies, anonymize, download ZIP packages, send to DICOMweb, and manage project/config state.

From the repository, run commands through pnpm:

```bash
pnpm --filter @dicorre/cli cli help
```

Build and test the installable package locally before publishing:

```bash
pnpm --filter @dicorre/cli build
pnpm --dir apps/cli pack --pack-destination /tmp/dicorre-cli-pack-test
mkdir -p /tmp/dicorre-cli-install-test
cd /tmp/dicorre-cli-install-test
npm init -y
npm install /tmp/dicorre-cli-pack-test/dicorre-cli-0.0.1.tgz
./node_modules/.bin/dicorre discover
```

When installed as a binary, the command shape is:

```bash
dicorre help
```

After publication, agents can use the package without cloning the repository:

```bash
npx @dicorre/cli discover
pnpm dlx @dicorre/cli help ingest
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

Use `plugins` when an agent needs to know which optional capabilities are active:

```bash
dicorre plugins
dicorre plugins --config project.config.json
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
- `--socks-proxy <socks5://host:port>`: route CLI network requests through a SOCKS proxy. `DICORRE_SOCKS_PROXY` can be used instead.

## Typical Workflow

```bash
dicorre config-validate project.config.json
dicorre ingest ./case.zip --workspace .dicorre/case-001 --config project.config.json
dicorre studies --workspace .dicorre/case-001
dicorre anonymize --study all --workspace .dicorre/case-001 --config project.config.json
dicorre download --study all --workspace .dicorre/case-001 --out anonymized.zip
dicorre send --study all --workspace .dicorre/case-001 --config project.config.json
```

For a whitelisted SSH host, start a local SOCKS tunnel and run a probe before sending:

```bash
ssh -fN -D 127.0.0.1:1080 -o ExitOnForwardFailure=yes <user>@<ssh-host>
dicorre server-probe --config project.config.json --socks-proxy socks5://127.0.0.1:1080
dicorre send --study all --workspace .dicorre/case-001 --config project.config.json --socks-proxy socks5://127.0.0.1:1080
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

Media conversion is plugin-based. Enabled image, PDF, and video plugins create real Secondary Capture DICOM files using decoded pixels, rendered PDF pages, or sampled video frames. `--no-converted` disables plugin-based media conversion and keeps ingestion to DICOM/archive inputs.

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

### `plugins`

List registered CLI plugins, enabled state, active settings, hook names, supported extensions, supported MIME types, and CLI-specific context.

```bash
dicorre plugins [--workspace <dir>] [--config <config.json>]
```

Output:

```json
{
  "plugins": [
    {
      "id": "image-converter",
      "name": "Image to DICOM Converter",
      "type": "file-format",
      "enabled": true,
      "supportedExtensions": [".jpg", ".jpeg", ".png", ".bmp"],
      "cli": {
        "summary": "Uses sharp to decode image pixels and writes real Secondary Capture DICOM instances.",
        "docs": "docs/cli.md#plugins"
      }
    }
  ],
  "supportedExtensions": [".bmp", ".dcm", ".dicom", ".jpg", ".jpeg", ".mp4", ".pdf", ".png", ".rar", ".webm", ".zip"],
  "supportedMimeTypes": ["application/pdf", "application/zip", "image/jpeg", "image/png", "video/mp4"]
}
```

The CLI loads plugins from the active config's `plugins.enabled` list, matching the web app's plugin IDs:

- `image-converter`: converts JPG/JPEG, PNG, and BMP with `sharp`.
- `pdf-converter`: renders each PDF page with PDF.js and native canvas.
- `video-converter`: samples MP4, WebM, and OGV frames with the packaged ffmpeg binary.
- `send-logger`: exposes `beforeSend`, `afterSend`, and `onSendError` hooks.
- `sent-notifier`: POSTs `study_instance_uid` and project params after successful sends.
- `receipt-verifier`: after a clean send, verifies the study is visible in a configured DICOMweb/QIDO, Orthanc, or PACScenter receipt backend.

Plugin settings come from `plugins.settings.<plugin-id>` in the active config. File-format plugins are used by `ingest`; send hooks are used by `send`. Hook failures are reported to stderr and do not replace the command's JSON stdout.

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
dicorre send [--study <all|uid[,uid]>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--concurrency <number>] [--socks-proxy <url>]
```

The DICOMweb endpoint comes from the active config's `dicomServer.url`.

Enabled send-hook plugins run around each selected study. The CLI supports the same send hook points as the web app: `beforeSend`, `afterSend`, and `onSendError`.

Use `--socks-proxy socks5://127.0.0.1:1080` or `DICORRE_SOCKS_PROXY=socks5://127.0.0.1:1080` to send through an SSH dynamic forward.

Output:

```json
{
  "studies": 1,
  "succeeded": 2,
  "failed": 0,
  "skipped": 0,
  "verification": [
    {
      "studyInstanceUID": "1.2.840.example",
      "state": "verified",
      "attempts": 1,
      "checkedAt": "2026-05-11T10:00:00.000Z"
    }
  ]
}
```

When `receipt-verifier` is enabled, DICOM send success remains the command success condition. Verification failures, timeouts, or pending states are returned in the `verification` block and do not make a successful send exit as failed.

### `server-probe`

Check the configured DICOMweb endpoint without sending files.

```bash
dicorre server-probe [--workspace <dir>] [--config <config.json>] [--socks-proxy <url>]
```

The command performs a GET against `dicomServer.url + testConnectionPath`, defaulting to `/studies`, and returns JSON with `ok`, `reachable`, and HTTP status fields.

Example:

```bash
dicorre server-probe --config orthanc.config.json --socks-proxy socks5://127.0.0.1:1080
```

### `verify`

Re-check selected studies against the configured receipt backend without resending files.

```bash
dicorre verify [--study <all|uid[,uid]>] [--wait] [--timeout <duration>] [--workspace <dir>] [--state <file>] [--config <config.json>] [--socks-proxy <url>]
```

Use `--wait` to poll until the study is found or the timeout is reached. Durations accept milliseconds, `s`, or `m`, for example `60000`, `60s`, or `15m`.

Pending or timeout records include a `nextCommand` that can be run later:

```json
{
  "studies": 1,
  "verification": [
    {
      "studyInstanceUID": "1.2.840.example",
      "state": "timeout",
      "nextCommand": "dicorre verify --study 1.2.840.example --workspace .dicorre/case-001 --config project.config.json"
    }
  ]
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

The built-in default config is bundled with the CLI. Use `config-show` to inspect the active workspace config, or pass a project config with `--config <config.json>`. See [configuration.md](configuration.md) for the full config schema and examples.

Plugin enablement lives in the same config:

```json
{
  "plugins": {
    "enabled": ["image-converter", "pdf-converter", "video-converter", "send-logger"],
    "settings": {
      "video-converter": {
        "intervalMs": 1000,
        "maxFrames": 500,
        "outputMaxWidth": 1920,
        "outputMaxHeight": 1080
      },
      "receipt-verifier": {
        "provider": "dicomweb-qido",
        "url": "http://127.0.0.1:8080/dicom-web",
        "pollIntervalMs": 10000,
        "timeoutMs": 60000,
        "requireInstanceCountMatch": true
      }
    }
  }
}
```

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
2. Run `dicorre plugins` with the intended config to inspect enabled plugins and conversion support.
3. Pick or create a dedicated `--workspace`.
4. Validate config with `config-validate` before using it.
5. Run `ingest`, then `studies` to get study IDs.
6. Use `anonymize`, `download`, and `send` with `--study all` or explicit study UIDs.
7. Read JSON outputs instead of scraping logs.
