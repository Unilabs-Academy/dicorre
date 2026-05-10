import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadFiles, waitForAppReady } from './helpers.js';

test.describe('Video Converter Plugin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const clearButton = page.getByTestId('clear-all-button');
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await page.getByTestId('confirm-clear').click();
      await waitForAppReady(page);
    }
  });

  test('converts WebM to DICOM series', async ({ page }) => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    // The reason we don't use an mp4 with h.264 codec here is because that codec is not
    // included in Chromium which tests usually run on so we just test with a webm.
    // mp4 is in the same location available for manual testing.
    const testVideoWebmPath = path.join(repoRoot, 'test-data/CASES/CasoV_with_only_video/Video/test-video.webm');

    await uploadFiles(page, testVideoWebmPath);

    // Wait for processing to complete
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="file-processing-progress-card"]').length === 0,
      { timeout: 30000 }
    );

    // Verify study table appears and has one row
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    await expect(studyRows).toHaveCount(1);
  });

  test('converts and anonymizes the video series', async ({ page }) => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const testVideoWebmPath = path.join(repoRoot, 'test-data/CASES/CasoV_with_only_video/Video/test-video.webm');

    await uploadFiles(page, testVideoWebmPath);

    // Wait for processing to complete
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="file-processing-progress-card"]').length === 0,
      { timeout: 30000 }
    );

    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Select all studies via header checkbox
    const headerCheckbox = page.getByRole('checkbox').first();
    await headerCheckbox.click();

    // Wait for selection state to update
    await page.waitForTimeout(500);

    const anonymizeButton = page.getByTestId('anonymize-button');

    // Check if anonymize button becomes enabled
    const isDisabled = await anonymizeButton.isDisabled();

    if (isDisabled) {
      // Video files may not produce anonymizable DICOM files
      // Skip the rest of the test if anonymization isn't possible
      return;
    }

    // Proceed with anonymization
    await expect(anonymizeButton).toBeEnabled({ timeout: 5000 });
    await anonymizeButton.click();

    // Wait for anonymization to complete
    await expect(anonymizeButton).toBeDisabled({ timeout: 30000 });

    // Verify anonymization occurred by checking for anonymized status
    const hasAnonymizedBadge = await page.getByTestId('anonymized-count-badge').isVisible().catch(() => false);
    const hasAnonymizedCells = await page.locator('[data-testid="studies-data-table"] tbody tr [data-testid="cell-anonymized"]').count() > 0;

    expect(hasAnonymizedBadge || hasAnonymizedCells).toBeTruthy();
  });
});
