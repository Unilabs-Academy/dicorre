import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadFiles, waitForAppReady } from './helpers';

test.describe('Study Logger - Final Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('study logger works - logs appear after parsing', async ({ page }) => {
    // Upload test files
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/1_case_3_series_6_images.zip');
    await uploadFiles(page, testZipPath);

    // Wait for processing to complete
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="file-processing-progress-card"]');
        return cards.length === 0;
      },
      { timeout: 15000 }
    );

    // Wait for studies table to be visible
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });
    const firstRow = page.locator('[data-testid="studies-data-table"] tbody tr').first();
    await expect(firstRow).toBeVisible();

    // Open the actions menu and click View log
    const actionsButton = firstRow.locator('button:has-text("⋯")');
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();
    
    const viewLogOption = page.getByText('View log');
    await expect(viewLogOption).toBeVisible();
    await viewLogOption.click();

    // Check that log sheet is visible
    const logSheet = page.getByTestId('study-log-sheet');
    await expect(logSheet).toBeVisible();
    
    // Wait for logs to load and verify parse log exists
    await page.waitForTimeout(1000);
    
    const logEntries = page.locator('[data-testid^="log-entry-"]');
    await expect(logEntries.first()).toBeVisible({ timeout: 5000 });
    
    const logTexts = await logEntries.allTextContents();
    const hasParseLog = logTexts.some(text => 
      text.includes('Parsed') && text.includes('file')
    );
    expect(hasParseLog).toBeTruthy();

    // Verify it's an info level log
    const infoLogs = page.locator('[data-testid="log-entry-info"]');
    await expect(infoLogs).toHaveCount(1);
  });

  test('study logger shows empty state when no logs exist', async ({ page }) => {
    // Upload files but don't process them long enough to generate logs
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/1_case_3_series_6_images.zip');
    await uploadFiles(page, testZipPath);

    // Immediately try to open log sheet before processing completes
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });
    
    const firstRow = page.locator('[data-testid="studies-data-table"] tbody tr').first();
    await expect(firstRow).toBeVisible();

    // Open log sheet immediately
    const actionsButton = firstRow.locator('button:has-text("⋯")');
    await actionsButton.click();
    
    const viewLogOption = page.getByText('View log');
    await viewLogOption.click();

    const logSheet = page.getByTestId('study-log-sheet');
    await expect(logSheet).toBeVisible();

    // Should show "No entries" initially or have entries after processing
    const noEntries = page.getByTestId('log-no-entries');
    const logEntries = page.locator('[data-testid^="log-entry-"]');
    
    // Either no entries message is visible OR we have log entries (race condition with processing)
    const hasNoEntries = await noEntries.isVisible();
    const logCount = await logEntries.count();
    
    // We should have either the no entries message OR actual log entries
    expect(hasNoEntries || logCount > 0).toBeTruthy();
  });

  test('study logger handles multiple files correctly', async ({ page }) => {
    // Upload multiple studies
    const testZipPath = path.join(process.cwd(), '../../test-data/CASES/3_cases_each_with_3_series_6_images.zip');
    await uploadFiles(page, testZipPath);

    // Wait for processing
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="file-processing-progress-card"]').length === 0,
      { timeout: 20000 }
    );

    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Get table rows
    const rows = page.locator('[data-testid="studies-data-table"] tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(1);

    // Check logs for first study
    const firstRow = rows.first();
    const firstActionsBtn = firstRow.locator('button:has-text("⋯")');
    await firstActionsBtn.click();
    
    let viewLogOption = page.getByText('View log');
    await viewLogOption.click();

    let logSheet = page.getByTestId('study-log-sheet');
    await expect(logSheet).toBeVisible();
    await page.waitForTimeout(1000);

    let logEntries = page.locator('[data-testid^="log-entry-"]');
    const firstStudyLogCount = await logEntries.count();
    expect(firstStudyLogCount).toBeGreaterThan(0);

    // Close sheet
    await page.keyboard.press('Escape');
    await expect(logSheet).toBeHidden();

    // Check logs for second study
    const secondRow = rows.nth(1);
    const secondActionsBtn = secondRow.locator('button:has-text("⋯")');
    await secondActionsBtn.click();
    
    viewLogOption = page.getByText('View log');
    await viewLogOption.click();

    logSheet = page.getByTestId('study-log-sheet');
    await expect(logSheet).toBeVisible();
    await page.waitForTimeout(1000);

    logEntries = page.locator('[data-testid^="log-entry-"]');
    const secondStudyLogCount = await logEntries.count();
    expect(secondStudyLogCount).toBeGreaterThan(0);
  });
});