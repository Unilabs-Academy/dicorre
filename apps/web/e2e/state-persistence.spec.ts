import { test, expect } from '@playwright/test'
import path from 'path'
import { uploadFiles } from './helpers'

test('persists uploaded files and UI state across page reload', async ({ page }) => {
  await page.goto('/')

  const testZipPath = path.join(process.cwd(), '../../test-data/CASES/1_case_3_series_6_images.zip')
  await uploadFiles(page, testZipPath)

  // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
      return cards.length === 0;
    },
    { timeout: 15000 }
  )
  
  await expect(page.getByTestId('app-toolbar')).toBeVisible({ timeout: 15000 })

  const filesCountText = await page.getByTestId('files-count-badge').textContent()
  const initialFileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0')
  expect(initialFileCount).toBe(6)

  await page.reload()

  await expect(page.getByTestId('app-toolbar')).toBeVisible({ timeout: 15000 })
  
  await page.waitForFunction(
    (expectedCount) => {
      const badge = document.querySelector('[data-testid="files-count-badge"]')
      if (!badge || !badge.textContent) return false
      const count = parseInt(badge.textContent.match(/(\d+)/)?.[1] || '0')
      return count === expectedCount
    },
    initialFileCount,
    { timeout: 10000 }
  )

  const filesCountTextAfter = await page.getByTestId('files-count-badge').textContent()
  const fileCountAfter = parseInt(filesCountTextAfter?.match(/(\d+)/)?.[1] || '0')
  expect(fileCountAfter).toBe(initialFileCount)

  // Studies count badge removed from UI, verify table has studies instead
  await expect(page.getByTestId('studies-data-table')).toBeVisible()
  const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr')
  await expect(studyRows).toHaveCount(1)
})
