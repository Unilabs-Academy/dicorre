import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../index'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const fixture = (...parts: string[]) => path.join(repoRoot, 'test-data', ...parts)

const workspaces: string[] = []

const makeWorkspace = async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'dicorre-cli-test-'))
  workspaces.push(workspace)
  return workspace
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe('dicorre CLI', () => {
  it('ingests, anonymizes, and packages a DICOM study without browser APIs', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      fixture('IM-0001-0001.dcm'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBe(1)
    expect(ingest.studies).toBe(1)

    const anonymized = await runCli([
      'anonymize',
      '--workspace',
      workspace,
      '--study',
      'all',
    ]) as { files: number; studies: number }

    expect(anonymized.files).toBe(1)
    expect(anonymized.studies).toBe(1)

    const out = path.join(workspace, 'download.zip')
    const downloaded = await runCli([
      'download',
      '--workspace',
      workspace,
      '--study',
      'all',
      '--out',
      out,
    ]) as { files: string[] }

    expect(downloaded.files).toEqual([out])
    expect((await stat(out)).size).toBeGreaterThan(0)

    const state = JSON.parse(await readFile(path.join(workspace, 'state.json'), 'utf8'))
    expect(state.files[0].anonymized).toBe(true)
    expect(state.studies[0].patientId).not.toBe('PAT001')
  })

  it('ingests a ZIP archive and lists grouped studies', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      fixture('CASES', 'mixed_sip_minimal.zip'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBeGreaterThan(0)
    expect(ingest.studies).toBeGreaterThan(0)

    const studies = await runCli(['studies', '--workspace', workspace]) as Array<{ files: number }>
    expect(studies.length).toBe(ingest.studies)
    expect(studies.reduce((sum, study) => sum + study.files, 0)).toBe(ingest.filesParsed)
  })

  it('accepts web-supported media inputs through Node conversion path', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      fixture('CASES', 'Caso3_with_pdf_and_images', 'PACIENTE 4 EGC BI MX IC.jpg'),
      fixture('CASES', 'Caso3_with_pdf_and_images', 'ecg.pdf'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBe(2)
    expect(ingest.studies).toBe(2)
  })
})
