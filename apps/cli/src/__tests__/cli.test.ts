import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../index'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const fixture = (...parts: string[]) => path.join(repoRoot, 'test-data', ...parts)
const webFixture = (...parts: string[]) => path.join(repoRoot, 'apps', 'web', ...parts)

const workspaces: string[] = []

const makeWorkspace = async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'dicorre-cli-test-'))
  workspaces.push(workspace)
  return workspace
}

const makeDicomWebServer = async () => {
  let posts = 0
  let notifications = 0
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/dicom-web/studies') {
      posts++
      req.resume()
      res.writeHead(200, { 'content-type': 'application/dicom+json' })
      res.end('{}')
      return
    }
    if (req.method === 'POST' && req.url === '/sent') {
      notifications++
      req.resume()
      res.writeHead(204)
      res.end()
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
    sentUrl: `http://127.0.0.1:${address.port}/sent`,
    get posts() {
      return posts
    },
    get notifications() {
      return notifications
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
  it('exposes structured help and per-command discoverability for agents', async () => {
    const help = await runCli(['help']) as {
      docs: string
      commands: Array<{ name: string; usage: string; examples: string[] }>
      usage: string[]
    }

    expect(help.docs).toBe('docs/cli.md')
    expect(help.commands.map((command) => command.name)).toContain('ingest')
    expect(help.commands.map((command) => command.name)).toContain('send')
    expect(help.commands.map((command) => command.name)).toContain('plugins')
    expect(help.usage.some((usage) => usage.includes('dicorre ingest'))).toBe(true)

    const ingestHelp = await runCli(['ingest', '--help']) as {
      command: { name: string; usage: string; options: Array<{ name: string }> }
    }
    expect(ingestHelp.command.name).toBe('ingest')
    expect(ingestHelp.command.usage).toContain('--no-converted')
    expect(ingestHelp.command.options.map((option) => option.name)).toContain('--concurrency')

    const discover = await runCli(['discover']) as { commands: Array<{ name: string }> }
    expect(discover.commands).toHaveLength(help.commands.length)
  })

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
    config.plugins.settings['sent-notifier'].url = server.sentUrl
    config.plugins.settings['sent-notifier'].authHeaderValue = 'test-key'
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
      expect(server.notifications).toBe(1)
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

  it('filters mixed SIP ZIP archives before listing grouped studies', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      fixture('CASES', 'mixed_sip_minimal.zip'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBe(2)
    expect(ingest.studies).toBe(1)

    const studies = await runCli(['studies', '--workspace', workspace]) as Array<{ files: number }>
    expect(studies.length).toBe(ingest.studies)
    expect(studies.reduce((sum, study) => sum + study.files, 0)).toBe(ingest.filesParsed)
  })

  it('filters mixed SIP RAR archives before anonymization', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      fixture('CASES', 'mixed_sip_minimal.rar'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBe(2)
    expect(ingest.studies).toBe(1)

    const anonymized = await runCli([
      'anonymize',
      '--workspace',
      workspace,
      '--study',
      'all',
    ]) as { files: number; studies: number }

    expect(anonymized.files).toBe(2)
    expect(anonymized.studies).toBe(1)
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

  it('lists enabled CLI plugins and their agent-facing context', async () => {
    const workspace = await makeWorkspace()

    const plugins = await runCli([
      'plugins',
      '--workspace',
      workspace,
    ]) as {
      plugins: Array<{ id: string; enabled: boolean; cli?: { summary: string }; supportedExtensions?: string[]; hooks?: string[] }>
      supportedExtensions: string[]
    }

    const image = plugins.plugins.find((plugin) => plugin.id === 'image-converter')
    expect(image).toMatchObject({ enabled: true })
    expect(image?.supportedExtensions).toContain('.jpg')
    expect(image?.cli?.summary).toContain('sharp')
    expect(plugins.supportedExtensions).toContain('.pdf')

    const notifier = plugins.plugins.find((plugin) => plugin.id === 'sent-notifier')
    expect(notifier?.hooks).toContain('afterSend')
  })

  it('accepts web-supported media inputs through Node plugin conversion path', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      webFixture('src/plugins/imageConverter/test-data/red-square.jpg'),
      webFixture('src/plugins/imageConverter/test-data/purple-square.png'),
      webFixture('src/plugins/pdfConverter/test-data/test-document.pdf'),
      webFixture('src/plugins/videoConverter/test-data/test-video.mp4'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBeGreaterThan(4)
    expect(ingest.studies).toBe(4)

    const studies = await runCli(['studies', '--workspace', workspace]) as Array<{ studyInstanceUID: string }>
    const merged = await runCli([
      'study-merge',
      ...studies.map((study) => study.studyInstanceUID),
      '--workspace',
      workspace,
    ]) as { merged: number }
    expect(merged.merged).toBe(4)

    const afterMerge = await runCli(['studies', '--workspace', workspace]) as Array<{ files: number }>
    expect(afterMerge).toHaveLength(1)
    expect(afterMerge[0].files).toBe(ingest.filesParsed)
  })

  it('honors --no-converted for plugin-backed media files', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      webFixture('src/plugins/imageConverter/test-data/red-square.jpg'),
      '--workspace',
      workspace,
      '--no-converted',
    ]) as { filesParsed: number; studies: number }

    expect(ingest.filesParsed).toBe(0)
    expect(ingest.studies).toBe(0)
  })

  it('validates config files and rejects invalid config', async () => {
    const workspace = await makeWorkspace()
    const configPath = path.join(repoRoot, 'packages', 'shared', 'app.config.json')

    const valid = await runCli([
      'config-validate',
      configPath,
      '--workspace',
      workspace,
    ]) as { valid: true }
    expect(valid.valid).toBe(true)

    const invalidConfigPath = path.join(workspace, 'invalid-config.json')
    await writeFile(invalidConfigPath, JSON.stringify({
      dicomServer: { timeout: 30000 },
      anonymization: { profile: 'basic', removePrivateTags: true },
    }))

    await expect(runCli([
      'config-validate',
      invalidConfigPath,
      '--workspace',
      workspace,
    ])).rejects.toThrow()
  })
})
