import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('WebMCP agent mode', () => {
  const appUrl = 'http://127.0.0.1:5173/?agent=1'
  const expectedToolNames = [
    'ratatoskr.get_status',
    'ratatoskr.load_config',
    'ratatoskr.get_config_summary',
    'ratatoskr.prepare_case_upload',
    'ratatoskr.get_upload_status',
    'ratatoskr.process_uploaded_cases',
    'ratatoskr.list_studies',
    'ratatoskr.select_studies',
    'ratatoskr.anonymize_selected',
    'ratatoskr.send_selected',
    'ratatoskr.get_logs',
    'ratatoskr.wait_for_idle',
    'ratatoskr.clear_all',
  ]
  const privateHeaderValue = 'PRIVATE_UPLOAD_KEY_FOR_REDACTION_TEST'
  const validAgentConfig = {
    version: 1,
    dicomServer: {
      url: '/api/test-dicom',
      headers: {
        'x-api-key': privateHeaderValue,
      },
      timeout: 45000,
      testConnectionPath: '/studies',
      auth: {
        type: 'bearer',
        credentials: 'PRIVATE_BEARER_TOKEN_FOR_REDACTION_TEST',
      },
      description: 'Agent test DICOM-Web server',
    },
    anonymization: {
      profileOptions: ['BasicProfile', 'RetainLongModifDatesOption'],
      removePrivateTags: true,
      useCustomHandlers: true,
      dateJitterDays: 31,
      organizationRoot: '1.2.826.0.1.3680043.8.498',
      replacements: {
        default: 'REMOVED',
        'Patient ID': 'PAT{random}',
      },
    },
    plugins: {
      enabled: ['sent-notifier'],
      settings: {
        'sent-notifier': {
          url: 'https://example.test/sent',
          authHeaderName: 'x-api-key',
          authHeaderValue: 'PRIVATE_NOTIFIER_KEY_FOR_REDACTION_TEST',
          headers: {
            'x-extra': 'PRIVATE_EXTRA_HEADER_FOR_REDACTION_TEST',
          },
        },
      },
    },
  }

  async function installWebMcpShim(page: any) {
    await page.addInitScript(() => {
      const tools = new Map<string, any>()
      Object.defineProperty(window, '__webMcpTestTools', {
        value: tools,
        configurable: true,
      })
      Object.defineProperty(navigator, 'modelContext', {
        configurable: true,
        value: {
          registerTool(tool: any, options?: { signal?: AbortSignal }) {
            tools.set(tool.name, tool)
            options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true })
          },
        },
      })
    })
  }

  async function executeShimTool(page: any, name: string, input: Record<string, unknown> = {}) {
    return await page.evaluate(
      async ({ name, input }) => {
        const tools = (window as any).__webMcpTestTools as Map<string, any>
        const tool = tools.get(name)
        if (!tool) return { found: false }
        return { found: true, output: await tool.execute(input) }
      },
      { name, input },
    )
  }

  test('reports unavailable when the browser has no WebMCP API', async ({ page }) => {
    await page.goto(appUrl)

    const hasModelContext = await page.evaluate(() => 'modelContext' in navigator)
    test.skip(hasModelContext, 'Browser has native WebMCP; unavailable-path test does not apply')

    const status = page.getByTestId('webmcp-agent-status')
    await expect(status).toBeVisible()
    await expect(status).toContainText('WebMCP is not available')
  })

  test('registers and executes get_status through the WebMCP API shape', async ({ page }) => {
    await installWebMcpShim(page)

    await page.goto(appUrl)

    const status = page.getByTestId('webmcp-agent-status')
    await expect(status).toContainText('ratatoskr.get_status')

    const toolNames = await page.evaluate(() => Array.from((window as any).__webMcpTestTools.keys()))
    expect(toolNames).toEqual(expectedToolNames)

    const result = await executeShimTool(page, 'ratatoskr.get_status')

    expect(result.found).toBe(true)
    expect(result.output).toMatchObject({
      ok: true,
      status: 'ready',
      agentMode: true,
      configReady: true,
      idle: true,
      counts: {
        studies: 0,
        files: 0,
        anonymizedFiles: 0,
        sentFiles: 0,
        selectedStudies: 0,
      },
      activeOperations: {
        fileProcessing: 0,
        anonymization: 0,
        sending: 0,
      },
      errors: [],
    })
  })

  test('loads private config and returns redacted summary', async ({ page }) => {
    await installWebMcpShim(page)
    await page.goto(appUrl)

    const loaded = await executeShimTool(page, 'ratatoskr.load_config', {
      config: validAgentConfig,
    })
    expect(loaded.found).toBe(true)
    expect(loaded.output).toMatchObject({
      ok: true,
      dicomServer: {
        url: '/api/test-dicom',
        timeout: 45000,
        testConnectionPath: '/studies',
        headers: {
          names: ['x-api-key'],
          valuePresentByName: { 'x-api-key': true },
        },
        auth: {
          type: 'bearer',
          credentialsPresent: true,
        },
      },
      plugins: {
        enabled: ['sent-notifier'],
        sentNotifier: {
          url: 'https://example.test/sent',
          authHeaderName: 'x-api-key',
          authHeaderValuePresent: true,
          headers: {
            names: ['x-extra'],
            valuePresentByName: { 'x-extra': true },
          },
        },
      },
    })

    const summary = await executeShimTool(page, 'ratatoskr.get_config_summary')
    expect(summary.found).toBe(true)
    expect(summary.output).toMatchObject(loaded.output)
    expect(JSON.stringify(summary.output)).not.toContain(privateHeaderValue)
    expect(JSON.stringify(summary.output)).not.toContain('PRIVATE_BEARER_TOKEN_FOR_REDACTION_TEST')
    expect(JSON.stringify(summary.output)).not.toContain('PRIVATE_NOTIFIER_KEY_FOR_REDACTION_TEST')
    expect(JSON.stringify(summary.output)).not.toContain('PRIVATE_EXTRA_HEADER_FOR_REDACTION_TEST')
  })

  test('rejects invalid config through the WebMCP config loader', async ({ page }) => {
    await installWebMcpShim(page)
    await page.goto(appUrl)

    const before = await executeShimTool(page, 'ratatoskr.get_config_summary')
    const invalid = await executeShimTool(page, 'ratatoskr.load_config', {
      config: {
        dicomServer: { timeout: 30000 },
        anonymization: { profile: 'basic', removePrivateTags: true },
      },
    })
    const after = await executeShimTool(page, 'ratatoskr.get_config_summary')

    expect(invalid.found).toBe(true)
    expect(invalid.output).toMatchObject({
      ok: false,
      status: 'invalid-config',
    })
    expect(after.output).toMatchObject(before.output)
  })

  test('coordinates upload, listing, selection, and clearing through WebMCP tools', async ({ page }) => {
    await installWebMcpShim(page)
    await page.goto(appUrl)

    const loaded = await executeShimTool(page, 'ratatoskr.load_config', {
      config: validAgentConfig,
    })
    expect(loaded.found).toBe(true)
    expect(loaded.output.ok).toBe(true)

    const prepare = await executeShimTool(page, 'ratatoskr.prepare_case_upload')
    expect(prepare.found).toBe(true)
    expect(prepare.output).toMatchObject({
      ok: true,
      fileInputSelector: '[data-testid="toolbar-file-input"]',
    })

    const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
    await page.locator(prepare.output.fileInputSelector).setInputFiles(testZipPath)

    const processed = await executeShimTool(page, 'ratatoskr.process_uploaded_cases', {
      wait: true,
      timeoutMs: 30000,
    })
    expect(processed.found).toBe(true)
    expect(processed.output.uploadStatus.counts.files).toBeGreaterThan(0)
    expect(processed.output.uploadStatus.counts.studies).toBeGreaterThan(0)

    const list = await executeShimTool(page, 'ratatoskr.list_studies')
    expect(list.found).toBe(true)
    expect(list.output.counts.studies).toBeGreaterThan(0)

    const selected = await executeShimTool(page, 'ratatoskr.select_studies', { mode: 'all' })
    expect(selected.found).toBe(true)
    expect(selected.output.ok).toBe(true)
    expect(selected.output.selectedCount).toBe(list.output.counts.studies)

    const cleared = await executeShimTool(page, 'ratatoskr.clear_all', { wait: true, timeoutMs: 30000 })
    expect(cleared.found).toBe(true)
    expect(cleared.output.appStatus.counts.files).toBe(0)
    expect(cleared.output.appStatus.counts.studies).toBe(0)
  })

  test('registers and executes get_status through native WebMCP testing API', async ({ page }) => {
    await page.goto(appUrl)

    const hasNativeTestingApi = await page.evaluate(() => {
      const testing = (navigator as any).modelContextTesting
      return typeof testing?.listTools === 'function' && typeof testing?.executeTool === 'function'
    })
    test.skip(!hasNativeTestingApi, 'Native WebMCP testing API is not available in this browser')

    const status = page.getByTestId('webmcp-agent-status')
    await expect(status).toContainText('ratatoskr.get_status')

    const result = await page.evaluate(async () => {
      const testing = (navigator as any).modelContextTesting
      const tools = await testing.listTools()
      const rawOutput = await testing.executeTool('ratatoskr.get_status', '{}')
      return {
        toolNames: tools.map((tool: { name: string }) => tool.name),
        output: JSON.parse(rawOutput),
      }
    })

    expect([...result.toolNames].sort()).toEqual([...expectedToolNames].sort())
    expect(result.output).toMatchObject({
      ok: true,
      status: 'ready',
      agentMode: true,
      configReady: true,
      idle: true,
      counts: {
        studies: 0,
        files: 0,
        anonymizedFiles: 0,
        sentFiles: 0,
        selectedStudies: 0,
      },
      activeOperations: {
        fileProcessing: 0,
        anonymization: 0,
        sending: 0,
      },
      errors: [],
    })
  })
})
