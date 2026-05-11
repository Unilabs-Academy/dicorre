import { test, expect } from '@playwright/test';
import path from 'path';
import {
  getBadgeCount,
  uploadFiles,
  waitForAnonymizedCount,
  waitForAppReady,
  waitForProcessingComplete,
} from './helpers';

test('uploads single case zip file and checks correct grouping', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  const testZipPath = path.join(process.cwd(), '../../test-data/CASES/1_case_3_series_6_images.zip');
  await uploadFiles(page, testZipPath);

  // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
  await waitForProcessingComplete(page);

  const filesCountBadge = page.getByTestId('files-count-badge');
  await expect(filesCountBadge).toBeVisible();
  
  const fileCount = await getBadgeCount(page, 'files-count-badge');
  expect(fileCount).toBeGreaterThan(0);

  const anonymizedCountBefore = await getBadgeCount(page, 'anonymized-count-badge');
  expect(anonymizedCountBefore).toBe(0);

  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

  const studyCheckboxes = page.getByRole('checkbox');
  await studyCheckboxes.nth(1).click();

  const anonymizeButton = page.getByTestId('anonymize-button');
  await expect(anonymizeButton).toContainText('Anonymize', { timeout: 5000 });
  await expect(anonymizeButton).toBeEnabled();

  await anonymizeButton.click();

  const currentFileCount = await getBadgeCount(page, 'files-count-badge');
  await waitForAnonymizedCount(page, currentFileCount);

  // After anonymization, studies are deselected. Re-select for table checks.
  await studyCheckboxes.nth(1).click();

  const anonymizedCount = await getBadgeCount(page, 'anonymized-count-badge');

  expect(anonymizedCount).toBe(currentFileCount);

  // Check that there's exactly 1 study in the table
  const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
  await expect(studyRows).toHaveCount(1);
});
