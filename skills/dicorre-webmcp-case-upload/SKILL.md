---
name: dicorre-webmcp-case-upload
description: Use this skill when an agent needs to upload, anonymize, send, monitor, or batch-process medical case files through the public Dicorre web app using its WebMCP agent tools. Applies when working with local ZIP/DICOM case folders and the app at https://dicorre.tmcacademy.xyz/.
---

# Dicorre WebMCP Case Upload

Use the public Dicorre app:

```text
https://dicorre.tmcacademy.xyz/?agent=1
```

Do not default to localhost for real uploads. Localhost is only for developing the app.

## Requirements

- Use the public Dicorre app in agent mode: `https://dicorre.tmcacademy.xyz/?agent=1`.
- Use a dedicated WebMCP-capable Chrome process. Do not use the default attached browser unless it already exposes `navigator.modelContext`.
- Do not use installed stable Chrome 147; it has been observed to report WebMCP unavailable.
- Prefer Chrome for Testing / Chrome Canary 149+ launched by the agent.
- Use headful mode. WebMCP was verified in Chrome 149 headful; headless did not expose `navigator.modelContext`.
- If `navigator.modelContext` / WebMCP tools are unavailable, stop and report diagnostics. Do not fall back to clicking the UI unless the user explicitly asks.
- The local agent is responsible for enumerating local case files and attaching them to the browser file input. WebMCP tools cannot read arbitrary local filesystem paths from inside the page.

## Browser Setup

Install or locate Chrome for Testing / Canary 149+:

```bash
pnpm dlx @puppeteer/browsers install chrome@canary \
  --path ~/.cache/dicorre-webmcp-browsers \
  --format '{{path}}'
```

Use the printed executable path as `chromePath`.

Launch with Playwright:

```ts
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: false,
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport'],
})
```

If using Puppeteer, discover tools through WebMCP after navigation:

```ts
const tools = page.webmcp.tools()
```

Console verification:

```js
navigator.modelContext
await navigator.modelContextTesting.listTools()
```

Expected: the WebMCP tool list contains `ratatoskr.get_status`.

If WebMCP is unavailable, report:

- browser executable path
- browser version
- whether `navigator.modelContext` exists
- whether `navigator.modelContextTesting` exists
- exact launch flags used

## Private Config Setup

Read the production config from a local private JSON file supplied by the user or operator. The repo must not contain real upload keys, DICOM server credentials, or secret-bearing config URLs.

The config file contains confidential upload settings. Never print the config JSON, raw auth values, API keys, DICOM server credentials, or full tool inputs/outputs that contain those values.

After WebMCP tool discovery:

1. Parse the private JSON file locally.
2. Call `ratatoskr.load_config({ "config": config })`.
3. Call `ratatoskr.get_config_summary()` and verify the destination URL, header names, auth type, and secret-presence flags are correct. This summary is redacted and should not include secret values.
4. Call `ratatoskr.test_connection()` and continue only when it returns `ok: true`.

Do not use a `project` URL that embeds confidential settings except as a temporary manual recovery path. URL query params can appear in history, logs, and referrers before the app removes them.

## Core Loop

Process one case or small case batch at a time. Do not attach a 100GB collection all at once.

1. Launch your own browser process with the Chrome 149+ executable and WebMCP flags above, then open `https://dicorre.tmcacademy.xyz/?agent=1`.
2. Verify at least one Dicorre WebMCP tool exists, specifically `ratatoskr.get_status`. Only after this should you attach local files to `[data-testid="toolbar-file-input"]`.
3. Load and verify the private config with `ratatoskr.load_config`, `ratatoskr.get_config_summary`, and `ratatoskr.test_connection`.
4. Call `ratatoskr.get_status`; continue only when `configReady` is true and there are no errors.
5. For each local case:
   - Call `ratatoskr.clear_all({ "wait": true })` before starting unless intentionally continuing an existing in-page session.
   - Call `ratatoskr.prepare_case_upload()`.
   - Attach the local ZIP/DICOM file(s) to the returned `fileInputSelector`, normally `[data-testid="toolbar-file-input"]`, using your browser automation file-upload primitive.
   - Call `ratatoskr.process_uploaded_cases({ "wait": true, "timeoutMs": 300000 })`.
   - Call `ratatoskr.list_studies()` and verify studies/files were discovered.
   - Call `ratatoskr.select_studies({ "mode": "all" })`, unless the user provided a narrower selection rule.
   - Call `ratatoskr.anonymize_selected({ "wait": true, "timeoutMs": 900000 })`.
   - Call `ratatoskr.list_studies()` again and verify every intended file is anonymized.
   - Call `ratatoskr.send_selected({ "confirmNonAnonymized": false, "confirmResend": false, "wait": true, "timeoutMs": 900000 })`.
   - Call `ratatoskr.get_logs({})` and save the returned logs or a concise summary to the local run manifest.
   - Call `ratatoskr.clear_all({ "wait": true })` after recording the result.

## Tool Notes

- `ratatoskr.load_config` accepts a full app config object from the local private JSON file and returns only a redacted summary.
- `ratatoskr.get_config_summary` returns DICOM destination settings, header names, auth type, plugin settings, and secret-present flags without secret values.
- `ratatoskr.test_connection` checks the configured DICOMweb destination and returns redacted diagnostics.
- `ratatoskr.prepare_case_upload` returns the upload selector and accepted formats. It does not upload files by itself.
- `ratatoskr.process_uploaded_cases` waits for parsing and study grouping after files have been attached.
- `ratatoskr.list_studies` returns study UID, accession, patient ID, assigned patient ID, file counts, anonymized counts, sent counts, and failure hints.
- `ratatoskr.select_studies` supports `{ "mode": "all" }` or `{ "studyInstanceUIDs": [...] }`.
- `ratatoskr.send_selected` intentionally refuses unsafe sends unless explicit confirmation flags are true.
- `ratatoskr.wait_for_idle` is useful between steps if the browser automation layer is uncertain whether the app has settled.
- `ratatoskr.clear_all` clears loaded studies, progress state, session state, and browser-backed file state.

## Safety Rules

- Never send non-anonymized files unless the user explicitly instructs you to do so. Keep `confirmNonAnonymized: false` by default.
- Never resend already-sent studies unless the user explicitly instructs you to do so. Keep `confirmResend: false` by default.
- Do not expose raw DICOM bytes, patient identifiers, auth headers, or full metadata dumps in chat output.
- Do not expose private config JSON, API keys, auth credentials, or secret-bearing URL parameters in chat output or manifests.
- Keep durable local records in a manifest, not in the conversation. A JSONL manifest is usually best.
- Do not continue with UI clicking unless explicitly authorized.
- Do not upload cases if config loading, config summary verification, or connection testing fails.
- If anonymization, sending, or clearing times out, record the case as failed or partial and continue only if the user requested best-effort batch processing.

## Manifest Fields

For each case, record at least:

```json
{
  "casePath": "/local/path/to/case.zip",
  "startedAt": "ISO timestamp",
  "finishedAt": "ISO timestamp",
  "status": "success | partial | failed | skipped",
  "studyCount": 0,
  "fileCount": 0,
  "anonymizedCount": 0,
  "sentCount": 0,
  "errors": [],
  "logSummary": []
}
```

Use the manifest for resume/skip decisions. Before retrying a case, inspect the prior manifest status and only skip entries that were clearly successful.
