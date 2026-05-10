import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadFiles, waitForAppReady } from './helpers';

test.describe('PDF Converter Plugin', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and wait for it to be ready
    await page.goto('/');
    
    // Wait for app to be ready
    await waitForAppReady(page);
    
    // If there's already data, clear it
    const clearButton = page.getByTestId('clear-all-button');
    if (await clearButton.isVisible()) {
      await clearButton.click();
      // Handle the confirmation dialog
      await page.getByTestId('confirm-clear').click();
      // Wait for drop zone to reappear after clearing
      await waitForAppReady(page);
    }
  });

  test('converts PDF to DICOM file', async ({ page }) => {

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await uploadFiles(page, testPdfPath);

    // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    );

    // Check if files were processed - wait for files count badge to appear
    await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 5000 });
    const filesCountBadge = page.getByTestId('files-count-badge');
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(3);

    // Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that 1 study appears in the table (PDF converted to single study)
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    await expect(studyRows).toHaveCount(1);
  });

  test('converts PDF and anonymizes the series', async ({ page }) => {

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await uploadFiles(page, testPdfPath);

    // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    );

    // Verify studies table appears and select all studies
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Select all studies by clicking the header checkbox
    const headerCheckbox = page.getByRole('checkbox').first();
    await headerCheckbox.click();

    // Verify anonymize button shows correct count
    const anonymizeButton = page.getByTestId('anonymize-button');
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    const studiesCount = await studyRows.count();

    await expect(anonymizeButton).toContainText('Anonymize', { timeout: 5000 });
    await expect(anonymizeButton).toBeEnabled();

    // Click anonymize button
    await anonymizeButton.click();

    // Wait for anonymization to complete
    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

    // After anonymization, studies are deselected. Wait for UI update then re-select
    await page.waitForTimeout(500);
    await headerCheckbox.click();

    // Verify files were anonymized
    const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
    const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');

    expect(anonymizedCount).toBe(3); // All converted PDF pages should be anonymized
  });
});
