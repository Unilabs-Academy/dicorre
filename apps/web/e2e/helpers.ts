import { Page } from '@playwright/test'

/**
 * Helper function to upload files using the toolbar button
 * @param page - Playwright page object
 * @param filePaths - Array of file paths or single file path to upload
 */
export async function uploadFiles(page: Page, filePaths: string | string[]) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
  
  // Click the "Add Files" button in the toolbar
  await page.getByTestId('toolbar-add-button').click()
  
  // Set the files in the file input
  await page.getByTestId('toolbar-file-input').setInputFiles(paths)
}

/**
 * Helper function to wait for the app to be ready
 * @param page - Playwright page object
 * @param timeout - Optional timeout in milliseconds
 */
export async function waitForAppReady(page: Page, timeout: number = 5000) {
  // Wait for the toolbar to be visible which indicates app is ready
  await page.getByTestId('app-toolbar').waitFor({ state: 'visible', timeout })
}

export async function waitForProcessingComplete(page: Page, timeout: number = 30000) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="file-processing-progress-card"]').length === 0,
    { timeout }
  )
}

export async function getBadgeCount(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).textContent()
  return parseInt(text?.match(/(\d+)/)?.[1] || '0', 10)
}

export async function waitForAnonymizedCount(page: Page, expected: number, timeout: number = 30000) {
  await page.waitForFunction(
    (target) => {
      const text = document.querySelector('[data-testid="anonymized-count-badge"]')?.textContent || ''
      const count = parseInt(text.match(/(\d+)/)?.[1] || '0', 10)
      return count === target
    },
    expected,
    { timeout }
  )
}

export async function waitForAnonymizedCountGreaterThan(page: Page, minimum: number, timeout: number = 30000) {
  await page.waitForFunction(
    (target) => {
      const text = document.querySelector('[data-testid="anonymized-count-badge"]')?.textContent || ''
      const count = parseInt(text.match(/(\d+)/)?.[1] || '0', 10)
      return count > target
    },
    minimum,
    { timeout }
  )
}
