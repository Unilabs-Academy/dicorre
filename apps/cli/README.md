# Dicorre CLI

Agent-readable CLI for ingesting, anonymizing, packaging, sending, and managing DICOM case workspaces.

## Install

```bash
npm install -g @dicorre/cli
dicorre discover
```

For one-off agent use after publication:

```bash
npx @dicorre/cli discover
pnpm dlx @dicorre/cli help ingest
```

## Local Package Test

From the repository:

```bash
pnpm --filter @dicorre/cli build
pnpm --dir apps/cli pack --pack-destination /tmp/dicorre-cli-pack-test
```

Install the generated tarball in a temporary project and run:

```bash
dicorre discover
dicorre help ingest
```

All normal command output is JSON on stdout. Errors are written to stderr and exit non-zero.

## Agent Workflow

Agents should call `dicorre discover` first, then use a dedicated workspace per case or batch:

```bash
dicorre ingest ./case.zip --workspace .dicorre/case-001 --config project.config.json
dicorre studies --workspace .dicorre/case-001
dicorre anonymize --study all --workspace .dicorre/case-001 --config project.config.json
dicorre download --study all --workspace .dicorre/case-001 --out anonymized.zip
```
