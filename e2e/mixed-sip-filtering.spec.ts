import { test, expect } from '@playwright/test'
import path from 'path'
import { uploadFiles, waitForAppReady } from './helpers'

test('filters mixed SIP archives before anonymization', async ({ page }) => {
  await page.goto('/')
  await waitForAppReady(page)

  const testZipPath = path.join(process.cwd(), 'test-data/CASES/mixed_sip_minimal.zip')
  await uploadFiles(page, testZipPath)

  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="file-processing-progress-card"]').length === 0,
    { timeout: 15000 },
  )

  await expect(page.getByTestId('files-count-badge')).toHaveText('Files: 2')
  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })

  const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr')
  await expect(studyRows).toHaveCount(1)
  await expect(page.getByTestId('anonymized-count-badge')).toHaveText('Anonymized: 0')

  await page.getByRole('checkbox').nth(1).click()

  const anonymizeButton = page.getByTestId('anonymize-button')
  await expect(anonymizeButton).toBeEnabled()
  await anonymizeButton.click()
  await expect(anonymizeButton).toBeDisabled({ timeout: 15000 })

  await expect(page.getByTestId('anonymized-count-badge')).toHaveText('Anonymized: 2', {
    timeout: 30000,
  })
  await expect(
    page.locator('[data-testid="studies-data-table"] tbody tr [data-testid="cell-anonymized"]').first(),
  ).toHaveText('Anonymized')
})
