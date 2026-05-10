import { test, expect } from '@playwright/test'
import path from 'path'
import { uploadFiles } from './helpers'

test.describe('DICOM Sending E2E Tests', () => {

  test('complete workflow: upload, anonymize, and send', async ({ page }) => {
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

    await expect(page.getByTestId('files-count-badge')).toBeVisible()
    await expect(page.getByTestId('studies-data-table')).toBeVisible()

    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).click()

    const anonymizeButton = page.getByTestId('anonymize-button')
    await expect(anonymizeButton).toBeEnabled()
    await anonymizeButton.click()

    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 })
    
    // After anonymization, studies are deselected. Wait for UI update then re-select
    await page.waitForTimeout(500)
    await studyCheckboxes.nth(1).click()

    let requestCount = 0
    await page.route('**/studies**', async route => {
      requestCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      })
    })

    const sendButton = page.getByTestId('send-button')
    await expect(sendButton).toBeEnabled({ timeout: 10000 })
    await sendButton.click()

    await page.waitForTimeout(3000)
    expect(requestCount).toBeGreaterThan(0)
  })

  test('handles server errors gracefully', async ({ page }) => {
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
    
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })

    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).click()

    const anonymizeButton = page.getByTestId('anonymize-button')
    await anonymizeButton.click()
    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 })

    // After anonymization, studies are deselected. Wait for UI update then re-select
    await page.waitForTimeout(500)
    await studyCheckboxes.nth(1).click()

    await page.route('**/studies**', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server unavailable' })
      })
    })

    const sendButton = page.getByTestId('send-button')
    const isEnabled = await sendButton.isEnabled()

    if (isEnabled) {
      await sendButton.click()
    }

    await expect(page.getByTestId('studies-data-table')).toBeVisible()
  })

  test('connection test works', async ({ page }) => {
    await page.goto('/')

    await page.route('**/studies', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/dicom+json',
        body: JSON.stringify([])
      })
    })

    await page.getByTestId('dropdown-menu-trigger').click()
    await page.getByTestId('test-connection-menu-item').click()
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5000 })
  })

})
