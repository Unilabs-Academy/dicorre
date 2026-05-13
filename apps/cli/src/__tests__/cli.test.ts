import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
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

const makeDicomWebServer = async (options: {
  readonly stowStatus?: number
  readonly notifierStatus?: number
  readonly qidoStatus?: number
  readonly hangProbe?: boolean
} = {}) => {
  let posts = 0
  let notifications = 0
  let qidoSearches = 0
  const server = createServer((req, res) => {
    if (options.hangProbe && req.method === 'GET' && req.url?.startsWith('/dicom-web/studies')) {
      return
    }
    if (req.method === 'POST' && req.url === '/dicom-web/studies') {
      posts++
      req.resume()
      res.writeHead(options.stowStatus ?? 200, { 'content-type': 'application/dicom+json' })
      res.end('{}')
      return
    }
    if (req.method === 'POST' && req.url === '/sent') {
      notifications++
      req.resume()
      res.writeHead(options.notifierStatus ?? 204)
      res.end()
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/dicom-web/studies')) {
      qidoSearches++
      if (options.qidoStatus && options.qidoStatus !== 200) {
        res.writeHead(options.qidoStatus, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'test failure' }))
        return
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      const studyInstanceUID = url.searchParams.get('StudyInstanceUID') || '1.2.3.test'
      res.writeHead(200, { 'content-type': 'application/dicom+json' })
      res.end(JSON.stringify([{
        '0020000D': { vr: 'UI', Value: [studyInstanceUID] },
        '00080061': { vr: 'CS', Value: ['MR'] },
        '00201208': { vr: 'IS', Value: ['1'] },
      }]))
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
    get qidoSearches() {
      return qidoSearches
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

const runCliProcess = (args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(path.join(repoRoot, 'apps', 'cli', 'node_modules', '.bin', 'tsx'), [
      'src/index.ts',
      ...args,
    ], { cwd: path.join(repoRoot, 'apps', 'cli') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })

const ingestAndAnonymizeOne = async (workspace: string) => {
  await runCli([
    'ingest',
    fixture('IM-0001-0001.dcm'),
    '--workspace',
    workspace,
  ])
  await runCli([
    'anonymize',
    '--workspace',
    workspace,
    '--study',
    'all',
  ])
}

const makeSocksProxy = async () => {
  let connects = 0
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    let buffer = Buffer.alloc(0)
    let stage: 'greeting' | 'connect' | 'proxy' = 'greeting'

    socket.on('close', () => sockets.delete(socket))
    socket.on('data', (chunk) => {
      if (stage === 'proxy') return
      buffer = Buffer.concat([buffer, chunk])

      if (stage === 'greeting') {
        if (buffer.length < 2) return
        const methodCount = buffer[1] ?? 0
        const greetingLength = 2 + methodCount
        if (buffer.length < greetingLength) return
        socket.write(Buffer.from([0x05, 0x00]))
        buffer = buffer.subarray(greetingLength)
        stage = 'connect'
      }

      if (stage === 'connect') {
        if (buffer.length < 5) return
        const atyp = buffer[3]
        let offset = 4
        let host = ''
        if (atyp === 0x01) {
          if (buffer.length < offset + 4 + 2) return
          host = Array.from(buffer.subarray(offset, offset + 4)).join('.')
          offset += 4
        } else if (atyp === 0x03) {
          const length = buffer[offset]
          if (length === undefined || buffer.length < offset + 1 + length + 2) return
          offset += 1
          host = buffer.subarray(offset, offset + length).toString('utf8')
          offset += length
        } else if (atyp === 0x04) {
          if (buffer.length < offset + 16 + 2) return
          host = buffer.subarray(offset, offset + 16).toString('hex').match(/.{1,4}/gu)?.join(':') ?? ''
          offset += 16
        } else {
          socket.destroy()
          return
        }

        const port = buffer.readUInt16BE(offset)
        const remainder = buffer.subarray(offset + 2)
        connects++
        stage = 'proxy'

        const upstream = net.connect(port, host, () => {
          sockets.add(upstream)
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
          if (remainder.length > 0) upstream.write(remainder)
          socket.pipe(upstream)
          upstream.pipe(socket)
        })
        upstream.on('close', () => sockets.delete(upstream))
        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind SOCKS proxy')
  return {
    url: `socks5://127.0.0.1:${address.port}`,
    get connects() {
      return connects
    },
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) socket.destroy()
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

    const sendHelp = await runCli(['send', '--help']) as {
      command: { options: Array<{ name: string }> }
    }
    const sendOptions = sendHelp.command.options.map((option) => option.name)
    expect(sendOptions).toContain('--ca-cert')
    expect(sendOptions).toContain('--quiet')
    expect(sendOptions).toContain('--log-file')
    expect(sendOptions).toContain('--result-json')
    expect(sendOptions).not.toContain('--tls-insecure')

    const discover = await runCli(['discover']) as { commands: Array<{ name: string; options?: Array<{ name: string }> }> }
    expect(discover.commands).toHaveLength(help.commands.length)
    const probe = discover.commands.find((command) => command.name === 'server-probe')
    expect(probe?.options?.map((option) => option.name)).toContain('--ca-cert')
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
    config.plugins.enabled = [...new Set([...config.plugins.enabled, 'receipt-verifier'])]
    config.plugins.settings['receipt-verifier'] = {
      provider: 'dicomweb-qido',
      url: server.url,
      pollIntervalMs: 1,
      timeoutMs: 1,
      requireInstanceCountMatch: true,
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
      ]) as {
        succeeded: number
        failed: number
        skipped: number
        verification?: Array<{ state: string; nextCommand?: string }>
      }

      expect(send).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 })
      expect(send.verification?.[0]).toMatchObject({ state: 'verified' })
      expect(send.verification?.[0]?.nextCommand).toBeUndefined()
      expect(server.posts).toBe(1)
      expect(server.notifications).toBe(1)
      expect(server.qidoSearches).toBe(1)

      const verify = await runCli([
        'verify',
        '--workspace',
        workspace,
        '--study',
        'all',
        '--config',
        configPath,
      ]) as { verification: Array<{ state: string; nextCommand?: string }> }

      expect(verify.verification[0]).toMatchObject({ state: 'verified' })
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

  it('ingests DICOM files recursively from a folder without requiring an archive', async () => {
    const workspace = await makeWorkspace()
    const caseDir = path.join(workspace, 'case-folder')
    const seriesA = path.join(caseDir, 'series-a')
    const seriesB = path.join(caseDir, 'nested', 'series-b')
    await mkdir(seriesA, { recursive: true })
    await mkdir(seriesB, { recursive: true })
    await copyFile(fixture('IM-0001-0001.dcm'), path.join(seriesA, 'IM-0001-0001.dcm'))
    await copyFile(fixture('IM-0001-0001.dcm'), path.join(seriesB, 'IM-0001-0002.dcm'))

    const ingest = await runCli([
      'ingest',
      caseDir,
      '--workspace',
      workspace,
    ]) as { filesRead: number; filesParsed: number; studies: number }

    expect(ingest.filesRead).toBe(2)
    expect(ingest.filesParsed).toBe(2)
    expect(ingest.studies).toBe(1)

    const studies = await runCli(['studies', '--workspace', workspace]) as Array<{ files: number }>
    expect(studies).toHaveLength(1)
    expect(studies[0].files).toBe(2)
  })

  it('probes and sends DICOM files through a SOCKS proxy', async () => {
    const workspace = await makeWorkspace()

    const ingest = await runCli([
      'ingest',
      fixture('IM-0001-0001.dcm'),
      '--workspace',
      workspace,
    ]) as { filesParsed: number; studies: number }

    expect(ingest).toMatchObject({ filesParsed: 1, studies: 1 })

    const anonymized = await runCli([
      'anonymize',
      '--workspace',
      workspace,
      '--study',
      'all',
    ]) as { files: number; studies: number }

    expect(anonymized).toMatchObject({ files: 1, studies: 1 })

    const server = await makeDicomWebServer()
    const proxy = await makeSocksProxy()
    const configPath = path.join(workspace, 'config-for-socks-send.json')
    const caPath = path.join(workspace, 'test-ca.pem')
    const config = JSON.parse(await readFile(path.join(repoRoot, 'packages', 'shared', 'app.config.json'), 'utf8'))
    config.dicomServer = {
      ...config.dicomServer,
      url: server.url,
      timeout: 5000,
    }
    config.plugins.settings['sent-notifier'].url = server.sentUrl
    config.plugins.settings['sent-notifier'].authHeaderValue = 'test-key'
    config.plugins.enabled = [...new Set([...config.plugins.enabled, 'receipt-verifier'])]
    config.plugins.settings['receipt-verifier'] = {
      provider: 'dicomweb-qido',
      url: server.url,
      pollIntervalMs: 1,
      timeoutMs: 1,
      requireInstanceCountMatch: true,
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await writeFile(caPath, 'not a real ca but valid enough for http endpoints\n')

    try {
      const probe = await runCli([
        'server-probe',
        '--config',
        configPath,
        '--workspace',
        workspace,
        '--socks-proxy',
        proxy.url,
        '--ca-cert',
        caPath,
      ]) as { ok: boolean; reachable: boolean; status: number; durationMs: number }

      expect(probe).toMatchObject({ ok: true, reachable: true, status: 200 })
      expect(probe.durationMs).toBeGreaterThanOrEqual(0)

      const send = await runCli([
        'send',
        '--workspace',
        workspace,
        '--study',
        'all',
        '--config',
        configPath,
        '--socks-proxy',
        proxy.url,
        '--ca-cert',
        caPath,
      ]) as {
        succeeded: number
        failed: number
        skipped: number
        verification?: Array<{ state: string }>
      }

      expect(send).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 })
      expect(send.verification?.[0]).toMatchObject({ state: 'verified' })
      expect(server.posts).toBe(1)
      expect(server.notifications).toBe(1)
      expect(server.qidoSearches).toBe(2)
      expect(proxy.connects).toBeGreaterThan(0)
    } finally {
      await proxy.close()
      await server.close()
    }
  })

  it('validates CA certificate paths before network commands', async () => {
    const workspace = await makeWorkspace()
    const configPath = path.join(repoRoot, 'packages', 'shared', 'app.config.json')

    await expect(runCli([
      'server-probe',
      '--workspace',
      workspace,
      '--config',
      configPath,
      '--ca-cert',
      path.join(workspace, 'missing-ca.pem'),
    ])).rejects.toThrow(/Unable to read CA certificate bundle/)
  })

  it('returns structured timeout metadata for server probes', async () => {
    const workspace = await makeWorkspace()
    const server = await makeDicomWebServer({ hangProbe: true })
    const configPath = path.join(workspace, 'config-for-timeout-probe.json')
    const config = JSON.parse(await readFile(path.join(repoRoot, 'packages', 'shared', 'app.config.json'), 'utf8'))
    config.dicomServer = {
      ...config.dicomServer,
      url: server.url,
      timeout: 25,
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

    try {
      const probe = await runCli([
        'server-probe',
        '--workspace',
        workspace,
        '--config',
        configPath,
      ]) as { ok: boolean; reachable: boolean; durationMs: number; failureKind: string; message: string }

      expect(probe.ok).toBe(false)
      expect(probe.reachable).toBe(false)
      expect(probe.failureKind).toBe('timeout')
      expect(probe.durationMs).toBeGreaterThanOrEqual(0)
      expect(probe.message).toBeTruthy()
    } finally {
      await server.close()
    }
  })

  it('includes sanitized per-file failures in send output', async () => {
    const workspace = await makeWorkspace()
    await ingestAndAnonymizeOne(workspace)

    const server = await makeDicomWebServer({ stowStatus: 400 })
    const configPath = path.join(workspace, 'config-for-failing-send.json')
    const config = JSON.parse(await readFile(path.join(repoRoot, 'packages', 'shared', 'app.config.json'), 'utf8'))
    config.dicomServer = {
      ...config.dicomServer,
      url: server.url,
      timeout: 5000,
    }
    config.plugins.enabled = []
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
      ]) as {
        succeeded: number
        failed: number
        skipped: number
        failedFiles: Array<{ id: string; fileName: string; failureKind: string; httpStatus?: number; attempts: number; message: string }>
      }

      expect(send).toMatchObject({ succeeded: 0, failed: 1, skipped: 0 })
      expect(send.failedFiles).toHaveLength(1)
      expect(send.failedFiles[0]).toMatchObject({
        failureKind: 'http',
        httpStatus: 400,
      })
      expect(send.failedFiles[0].id).toBeTruthy()
      expect(send.failedFiles[0].fileName).toBeTruthy()
      expect(send.failedFiles[0].attempts).toBeGreaterThan(0)
      expect(send.failedFiles[0].message).not.toContain(server.url)
    } finally {
      await server.close()
    }
  })

  it('separates plugin and receipt failures from DICOM send counts', async () => {
    const workspace = await makeWorkspace()
    await ingestAndAnonymizeOne(workspace)

    const server = await makeDicomWebServer({ notifierStatus: 403, qidoStatus: 403 })
    const configPath = path.join(workspace, 'config-for-plugin-failures.json')
    const config = JSON.parse(await readFile(path.join(repoRoot, 'packages', 'shared', 'app.config.json'), 'utf8'))
    config.dicomServer = {
      ...config.dicomServer,
      url: server.url,
      timeout: 5000,
    }
    config.plugins.settings['sent-notifier'].url = server.sentUrl
    config.plugins.settings['sent-notifier'].authHeaderValue = 'test-key'
    config.plugins.enabled = [...new Set([...config.plugins.enabled, 'sent-notifier', 'receipt-verifier'])]
    config.plugins.settings['receipt-verifier'] = {
      provider: 'dicomweb-qido',
      url: server.url,
      pollIntervalMs: 1,
      timeoutMs: 1,
      requireInstanceCountMatch: true,
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
      ]) as {
        succeeded: number
        failed: number
        skipped: number
        plugins: Array<{ pluginId: string; hook: string; status: string; message?: string }>
        verification?: Array<{ state: string; message?: string }>
      }

      expect(send).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 })
      expect(send.plugins).toEqual(expect.arrayContaining([
        expect.objectContaining({ pluginId: 'sent-notifier', hook: 'afterSend', status: 'failed' }),
        expect.objectContaining({ pluginId: 'receipt-verifier', hook: 'afterSend', status: 'success' }),
      ]))
      expect(send.plugins.find((plugin) => plugin.pluginId === 'sent-notifier')?.message).toContain('sent-notifier failed')
      expect(send.verification?.[0]).toMatchObject({ state: 'error' })
      expect(send.verification?.[0]?.message).toContain('403')
    } finally {
      await server.close()
    }
  })

  it('writes final JSON to result files and keeps quiet CLI stdout parseable', async () => {
    const workspace = await makeWorkspace()
    const resultPath = path.join(workspace, 'result.json')
    const logPath = path.join(workspace, 'ops.log')

    const result = await runCli([
      'help',
      '--result-json',
      resultPath,
    ]) as { name: string }
    expect(result.name).toBe('dicorre')
    expect(JSON.parse(await readFile(resultPath, 'utf8')).name).toBe('dicorre')

    const processResult = await runCliProcess([
      'help',
      '--quiet',
      '--log-file',
      logPath,
    ])
    expect(processResult.code).toBe(0)
    expect(processResult.stderr).toBe('')
    expect(JSON.parse(processResult.stdout).name).toBe('dicorre')
    await expect(stat(logPath)).rejects.toThrow()
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
