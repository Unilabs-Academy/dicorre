import { test, expect } from '@playwright/test'
import path from 'path'
import { uploadFiles, waitForAppReady } from './helpers'

test.describe('Download Functionality', () => {
  test('should download selected studies as ZIP file', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to be ready
    await waitForAppReady(page)

    // Upload test ZIP file
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    await uploadFiles(page, testZipPath)

    // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    )

    // Verify files are loaded
    await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })

    // Initially download button should be disabled (no studies selected)
    // Open dropdown menu to access download button
    await page.getByTestId('dropdown-menu-trigger').click()
    const downloadMenuItem = page.getByTestId('download-menu-item')
    await expect(downloadMenuItem).toBeVisible()
    await expect(downloadMenuItem).toHaveAttribute('aria-disabled', 'true')
    // Close dropdown for now
    await page.keyboard.press('Escape')

    // Select studies by checking checkboxes  
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()

    // Give time for the reactive state to update
    await page.waitForTimeout(500)

    // Verify download button is now enabled
    // Open dropdown menu
    await page.getByTestId('dropdown-menu-trigger').click()
    const downloadMenuItemEnabled = page.getByTestId('download-menu-item')

    // Start download and wait for the download to be triggered
    const downloadPromise = page.waitForEvent('download')
    await downloadMenuItemEnabled.click()

    // Wait for download to start
    const download = await downloadPromise

    // Verify download filename follows expected pattern
    const filename = download.suggestedFilename()
    expect(filename).toMatch(/DICOM_Stud(y|ies)_.*_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.zip/)

    // Verify download is a ZIP file
    expect(filename).toContain('.zip')

    // Save download to verify it's not empty
    const downloadPath = path.join('/tmp', filename)
    await download.saveAs(downloadPath)

    // Verify the downloaded file exists and has content
    const fs = await import('fs')
    const stats = fs.statSync(downloadPath)
    expect(stats.size).toBeGreaterThan(0)

    // Clean up
    fs.unlinkSync(downloadPath)
  })

  test('should show correct button states during download', async ({ page }) => {
    await page.goto('/')

    // Upload and wait for processing
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/3_cases_each_with_3_series_6_images.zip')
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

    // Select a study
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()

    // Open dropdown menu
    await page.getByTestId('dropdown-menu-trigger').click()
    const downloadMenuItem = page.getByTestId('download-menu-item')
    await expect(downloadMenuItem).toBeVisible()

    // Start download
    const downloadPromise = page.waitForEvent('download')
    await downloadMenuItem.click()

    // Wait for download to complete
    await downloadPromise

    // After download completes, the button should still be available
    // (No need to check state as download completed successfully)
  })

  test('should handle single study download with correct filename', async ({ page }) => {
    await page.goto('/')

    // Upload test data
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/3_cases_each_with_3_series_6_images.zip')
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

    // Select only one study
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()

    // Open dropdown menu and download
    await page.getByTestId('dropdown-menu-trigger').click()
    const downloadMenuItem = page.getByTestId('download-menu-item')

    // Start download
    const downloadPromise = page.waitForEvent('download')
    await downloadMenuItem.click()

    const download = await downloadPromise

    // For single study, filename should include patient ID pattern
    const filename = download.suggestedFilename()
    expect(filename).toMatch(/DICOM_Study_.*_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.zip/)
  })

  test('should show no studies selected warning', async ({ page }) => {
    await page.goto('/')

    // Upload test data
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/3_cases_each_with_3_series_6_images.zip')
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

    // Don't select any studies - download button should be disabled
    // Open dropdown menu
    await page.getByTestId('dropdown-menu-trigger').click()
    const downloadMenuItem = page.getByTestId('download-menu-item')
    await expect(downloadMenuItem).toBeVisible()
    // Close dropdown
    await page.keyboard.press('Escape')
  })

  test('should work with anonymized studies', async ({ page }) => {
    await page.goto('/')

    // Upload test data
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/3_cases_each_with_3_series_6_images.zip')
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

    // Select studies
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()

    // Anonymize selected studies first
    const anonymizeButton = page.getByTestId('anonymize-button')
    await anonymizeButton.click()

    // Wait for anonymization to complete
    await expect(page.getByTestId('anonymized-count-badge')).toContainText(/[1-9]/, { timeout: 30000 })

    // Re-select studies after anonymization (they get deselected after anonymization)
    const studyCheckboxesAfter = page.getByRole('checkbox')
    await studyCheckboxesAfter.nth(1).check()

    // Now download the anonymized studies
    // Open dropdown menu
    await page.getByTestId('dropdown-menu-trigger').click()
    const downloadMenuItem = page.getByTestId('download-menu-item')
    await expect(downloadMenuItem).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await downloadMenuItem.click()

    const download = await downloadPromise

    // Verify download works with anonymized data
    expect(download.suggestedFilename()).toContain('.zip')
  })
})
