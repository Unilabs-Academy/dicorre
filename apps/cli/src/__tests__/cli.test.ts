import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

const makeDicomWebServer = async () => {
  let posts = 0
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/dicom-web/studies') {
      posts++
      req.resume()
      res.writeHead(200, { 'content-type': 'application/dicom+json' })
      res.end('{}')
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server')
  return {
    url: `http://127.0.0.1:${address.port}/dicom-web`,
    get posts() {
      return posts
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
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

    const server = await makeDicomWebServer()
    const configPath = path.join(workspace, 'config-for-send.json')
    const config = JSON.parse(await readFile(path.join(repoRoot, 'packages', 'shared', 'app.config.json'), 'utf8'))
    config.dicomServer = {
      ...config.dicomServer,
      url: server.url,
      timeout: 5000,
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

    try {
      const send = await runCli([
        'send',
        '--workspace',
        workspace,
        '--study',
        'all',
        '--config',
        configPath,
      ]) as { succeeded: number; failed: number; skipped: number }

      expect(send).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 })
      expect(server.posts).toBe(1)
    } finally {
      await server.close()
    }

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

  it('persists project config and study custom fields', async () => {
    const workspace = await makeWorkspace()

    await runCli([
      'ingest',
      fixture('IM-0001-0001.dcm'),
      '--workspace',
      workspace,
    ])
    const studies = await runCli(['studies', '--workspace', workspace]) as Array<{ studyInstanceUID: string }>
    const studyId = studies[0].studyInstanceUID

    const project = await runCli([
      'project-create',
      'Agent Batch',
      '--workspace',
      workspace,
    ]) as { project: { name: string } }
    expect(project.project.name).toBe('Agent Batch')

    const config = await runCli(['config-show', '--workspace', workspace]) as { config: { project?: { name: string } } }
    expect(config.config.project?.name).toBe('Agent Batch')

    const field = await runCli([
      'field-set',
      studyId,
      'Study Description',
      'CLI Override',
      '--workspace',
      workspace,
    ]) as { field: string; value: string }
    expect(field).toMatchObject({ field: 'Study Description', value: 'CLI Override' })

    const state = JSON.parse(await readFile(path.join(workspace, 'state.json'), 'utf8'))
    expect(state.studies[0].customFields['Study Description']).toBe('CLI Override')
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

    const studies = await runCli(['studies', '--workspace', workspace]) as Array<{ studyInstanceUID: string }>
    const merged = await runCli([
      'study-merge',
      studies[0].studyInstanceUID,
      studies[1].studyInstanceUID,
      '--workspace',
      workspace,
    ]) as { merged: number }
    expect(merged.merged).toBe(2)

    const afterMerge = await runCli(['studies', '--workspace', workspace]) as Array<{ files: number }>
    expect(afterMerge).toHaveLength(1)
    expect(afterMerge[0].files).toBe(2)
  })
})
