import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForAppReady } from './helpers';

test.describe('Config Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads valid config file', async ({ page }) => {
    const validConfig = {
      // Simulate legacy file without version; migration should fill and persist version
      dicomServer: {
        url: "/api/orthanc/dicom-web",
        headers: {},
        timeout: 30000,
        auth: null,
        description: "Orthanc DICOM-Web server configuration"
      },
      anonymization: {
        profileOptions: ["BasicProfile", "RetainLongModifDatesOption", "RetainUIDsOption"],
        removePrivateTags: true,
        useCustomHandlers: true,
        dateJitterDays: 31,
        organizationRoot: "1.2.826.0.1.3680043.8.498",
      }
    };

    const tempConfigPath = path.join(process.cwd(), 'test-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(validConfig, null, 2));

    try {
      // Wait for initial app to load
      await waitForAppReady(page);

      // Open settings sheet from toolbar
      await page.getByTestId('edit-project-button').click();

      // Now set the file input (hidden) from the sheet Load Config button
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Check success toast appears
      await expect(page.locator('[data-sonner-toast][data-type="success"]')).toBeVisible({ timeout: 3000 });

      // Verify config was applied - check that toolbar appears (config loaded successfully)
      await expect(page.getByTestId('app-toolbar')).toBeVisible();
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('migrates legacy persisted config on startup', async ({ page }) => {
    // Inject a legacy config into localStorage before app code runs
    await page.addInitScript(() => {
      const legacy = {
        dicomServer: { url: '/api/test', timeout: 1234, auth: null },
        anonymization: { profileOptions: ['BasicProfile'], removePrivateTags: true }
      }
      localStorage.setItem('app-config', JSON.stringify(legacy))
    })

    await page.goto('/')
    await waitForAppReady(page)

    // Open settings to ensure app didn't crash and config is applied
    await page.getByTestId('edit-project-button').click()

    // After migration, toolbar should still be visible (app working)
    await expect(page.getByTestId('app-toolbar')).toBeVisible()
  })

  test('shows error for invalid config', async ({ page }) => {
    // Create an invalid config (missing required url field)
    const invalidConfig = {
      dicomServer: {
        timeout: 30000
      },
      anonymization: {
        profile: "basic",
        removePrivateTags: true
      }
    };

    const tempConfigPath = path.join(process.cwd(), 'invalid-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(invalidConfig, null, 2));

    try {
      // Wait for initial app to load
      await waitForAppReady(page);

      // Open settings sheet from toolbar
      await page.getByTestId('edit-project-button').click();

      // Now set the file input
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Check error toast appears
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({ timeout: 3000 });
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });
});
