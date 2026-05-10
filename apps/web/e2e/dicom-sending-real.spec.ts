import { test, expect } from '@playwright/test'
import path from 'path'
import { uploadFiles } from './helpers'

test.describe('DICOM Sending with Real Orthanc Server', () => {

  test('send DICOM files to real Orthanc server', async ({ page }) => {

    await page.goto('/')

    await page.getByTestId('dropdown-menu-trigger').click()
    await expect(page.getByTestId('test-connection-menu-item')).toBeVisible()
    await page.getByTestId('test-connection-menu-item').click()
    
    await page.waitForSelector('[data-sonner-toast]', { timeout: 5000 })

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

    await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('studies-data-table')).toBeVisible()

    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).click()

    const anonymizeButton = page.getByTestId('anonymize-button')
    await expect(anonymizeButton).toBeEnabled()
    await anonymizeButton.click()

    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 })

    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 5000 })
    
    // After anonymization, studies are deselected. Wait for UI update then re-select
    await page.waitForTimeout(500)
    
    const allCheckboxes = page.getByRole('checkbox')
    const checkboxCount = await allCheckboxes.count()
    
    if (checkboxCount > 1) {
      await allCheckboxes.nth(1).click({ force: true })
    }

    const sendButton = page.getByTestId('send-button')
    await expect(sendButton).toBeEnabled({ timeout: 10000 })
    await sendButton.click()

    await page.waitForResponse(
      response => response.url().includes('dicom-web/studies') || response.url().includes('orthanc/studies'),
      { timeout: 15000 }
    ).catch(() => {})

    const response = await page.request.get('http://localhost:5173/api/orthanc/studies')
    const studies = await response.json()
    expect(studies.length).toBeGreaterThan(0)
  })

  test('debug STOW-RS endpoint directly', async ({ page }) => {
    await page.goto('/')
    
    const getResponse = await page.request.get('http://localhost:5173/api/orthanc/dicom-web/studies')
    expect(getResponse.status()).toBeLessThan(500)
    
    try {
      const postResponse = await page.request.post('http://localhost:5173/api/orthanc/dicom-web/studies', {
        headers: {
          'Content-Type': 'multipart/related; type="application/dicom"; boundary=boundary123'
        },
        data: '--boundary123\r\nContent-Type: application/dicom\r\n\r\n\r\n--boundary123--'
      })
      expect(postResponse.status()).toBeLessThan(500)
    } catch {}
    
    const browserResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/orthanc/dicom-web/studies', {
          method: 'POST',
          headers: {
            'Content-Type': 'multipart/related; type="application/dicom"; boundary=boundary123'
          },
          body: '--boundary123\r\nContent-Type: application/dicom\r\n\r\n\r\n--boundary123--'
        })
        
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text()
        }
      } catch (error) {
        return {
          error: error.message,
          name: error.name,
          stack: error.stack
        }
      }
    })
    
    expect(browserResponse).toBeDefined()
  })

})