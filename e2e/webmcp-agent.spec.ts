import { test, expect } from '@playwright/test'

test.describe('WebMCP agent mode', () => {
  const appUrl = 'http://127.0.0.1:5173/?agent=1'

  test('reports unavailable when the browser has no WebMCP API', async ({ page }) => {
    await page.goto(appUrl)

    const hasModelContext = await page.evaluate(() => 'modelContext' in navigator)
    test.skip(hasModelContext, 'Browser has native WebMCP; unavailable-path test does not apply')

    const status = page.getByTestId('webmcp-agent-status')
    await expect(status).toBeVisible()
    await expect(status).toContainText('WebMCP is not available')
  })

  test('registers and executes get_status through the WebMCP API shape', async ({ page }) => {
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

    await page.goto(appUrl)

    const status = page.getByTestId('webmcp-agent-status')
    await expect(status).toContainText('ratatoskr.get_status')

    const result = await page.evaluate(async () => {
      const tools = (window as any).__webMcpTestTools as Map<string, any>
      const tool = tools.get('ratatoskr.get_status')
      if (!tool) return { found: false }
      return { found: true, output: await tool.execute({}) }
    })

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

    expect(result.toolNames).toContain('ratatoskr.get_status')
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
