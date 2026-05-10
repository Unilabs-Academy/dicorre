import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadFiles, waitForAppReady } from './helpers';

test('uploads single case zip file and checks correct grouping', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  const testZipPath = path.join(process.cwd(), '../../test-data/CASES/1_case_3_series_6_images.zip');
  await uploadFiles(page, testZipPath);

  // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
      return cards.length === 0;
    },
    { timeout: 15000 }
  );

  const filesCountBadge = page.getByTestId('files-count-badge');
  await expect(filesCountBadge).toBeVisible();
  
  const filesCountText = await filesCountBadge.textContent();
  const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(fileCount).toBeGreaterThan(0);

  const anonymizedCountBeforeText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCountBefore = parseInt(anonymizedCountBeforeText?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCountBefore).toBe(0);

  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

  const studyCheckboxes = page.getByRole('checkbox');
  await studyCheckboxes.nth(1).click();

  const anonymizeButton = page.getByTestId('anonymize-button');
  await expect(anonymizeButton).toContainText('Anonymize', { timeout: 5000 });
  await expect(anonymizeButton).toBeEnabled();

  await anonymizeButton.click();
  
  await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

  // After anonymization, studies are deselected. Wait for UI update then re-select
  await page.waitForTimeout(500);
  await studyCheckboxes.nth(1).click();

  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  
  const currentFilesCountText = await page.getByTestId('files-count-badge').textContent();
  const currentFileCount = parseInt(currentFilesCountText?.match(/(\d+)/)?.[1] || '0');
  
  expect(anonymizedCount).toBe(currentFileCount);

  // Check that there's exactly 1 study in the table
  const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
  await expect(studyRows).toHaveCount(1);
});
