import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadFiles, waitForAppReady } from './helpers';

test.describe('Image Converter Plugin', () => {
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

  test('converts JPG images to DICOM files', async ({ page }) => {

    // Upload JPG test images
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/blue-rectangle.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/gradient.jpg')
    ];
    await uploadFiles(page, testImagePaths);

    // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    );

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible({ timeout: 5000 });
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(3);

    // Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that 3 studies appear in the table (one per image)
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    await expect(studyRows).toHaveCount(3);
  });

  test('converts PNG images to DICOM files', async ({ page }) => {

    // Upload PNG test images
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/purple-square.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/orange-banner.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/radial-gradient.png')
    ];
    await uploadFiles(page, testImagePaths);

    // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    );

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();

    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(3);

    // Should convert 3 PNG files to DICOM// Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that 3 studies appear in the table (one per image)
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    await expect(studyRows).toHaveCount(3);
  });

  test('converts mixed image formats and anonymizes them', async ({ page }) => {

    // Upload mixed image formats (2 JPG + 2 PNG)
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/gradient.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/purple-square.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/radial-gradient.png')
    ];

    await uploadFiles(page, testImagePaths);

    // Wait for all processing cards to be hidden (concurrent processing may show multiple cards)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    );

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();

    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(4);

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

    expect(anonymizedCount).toBe(4);
  });

  test('rejects unsupported file formats', async ({ page }) => {

    // Try to upload a text file (should be rejected)
    const testFilePath = path.join(process.cwd(), 'package.json'); // Use an existing non-image file
    await uploadFiles(page, testFilePath);

    // Wait for error toast to appear
    const error = page.getByTestId('file-processing-progress-error');
    await expect(error).toBeVisible({ timeout: 5000 });

    // Check that no files were processed - files count should be 0 or not visible
    const filesCountBadge = page.getByTestId('files-count-badge');
    const isVisible = await filesCountBadge.isVisible().catch(() => false);
    if (isVisible) {
      const filesCountText = await filesCountBadge.textContent();
      const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
      expect(fileCount).toBe(0);
    }
  });
});
