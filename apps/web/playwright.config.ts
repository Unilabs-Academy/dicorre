import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const WEBMCP_CHROME_FLAGS = ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport']
const webMcpChromeExecutablePath = process.env.WEBMCP_CHROME_EXECUTABLE_PATH

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: 5000,
  },
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Keep e2e serial because the app persists session state per origin (localStorage + OPFS). */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'line',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.CI ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Only on CI systems run the tests headless */
    headless: true,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: WEBMCP_CHROME_FLAGS,
        },
      },
    },
    ...(webMcpChromeExecutablePath
      ? [{
          name: 'webmcp-chrome',
          testMatch: /webmcp-agent\.spec\.ts/,
          use: {
            ...devices['Desktop Chrome'],
            headless: false,
            launchOptions: {
              executablePath: webMcpChromeExecutablePath,
              args: WEBMCP_CHROME_FLAGS,
            },
          },
        }]
      : []),
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //   },
    // },
    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //   },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //   },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: {
    //     ...devices['iPhone 12'],
    //   },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: {
    //     channel: 'msedge',
    //   },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: {
    //     channel: 'chrome',
    //   },
    // },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir: 'test-results/',

  /* Run your local dev server before starting the tests */
  webServer: {
    /**
     * Use the dev server by default for faster feedback loop.
     * Use the preview server on CI for more realistic testing.
     * Playwright will re-use the local server if there is already a dev-server running.
     */
    command: process.env.CI ? 'pnpm preview --host 127.0.0.1' : 'pnpm dev --host 127.0.0.1',
    url: process.env.CI ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
