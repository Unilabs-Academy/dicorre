import { test, expect } from '@playwright/test'
import { waitForAppReady } from './helpers'

test.describe('Project Management', () => {
  test('should create project, generate shareable URL, and load from URL', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    // Navigate to the app
    await page.goto('/')

    // Wait for app to be ready
    await waitForAppReady(page)

    // Initially should show "No active project"
    await expect(page.getByText('No active project')).toBeVisible()

    // Step 1: Create a new project
    await page.getByTestId('edit-project-button').click()

    // Sheet should appear
    await expect(page.getByLabel('Project Name')).toBeVisible()

    // Fill in project name
    const projectName = 'E2E Test Project'
    await page.getByLabel('Project Name').fill(projectName)

    // Save via Save Configuration
    await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeEnabled()

    // Submit the form
    await page.getByRole('button', { name: 'Save Configuration' }).click()

    // Should show success notification
    await expect(page.locator('[data-sonner-toast][data-type="success"]').first()).toBeVisible({ timeout: 3000 })

    // Sheet should close
    await expect(page.getByLabel('Project Name')).toBeHidden()

    // Project should now be active - wait for UI to update
    await expect(page.getByTestId('project-title')).toContainText(projectName, { timeout: 3000 })
    await expect(page.getByText('No active project')).toBeHidden()

    // Step 2: Generate shareable URL - wait for button to be enabled
    await expect(page.getByTestId('share-project-button')).toBeEnabled()
    await page.getByTestId('share-project-button').click()

    // Should show success notification
    await expect(page.getByText('Project URL copied to clipboard')).toBeVisible()

    // Step 3: Test loading project from URL
    // Get the current URL with project parameter (simulating clipboard content)
    // For testing purposes, we'll create a test URL manually since clipboard access is limited in tests

    // Clear the project first to test URL loading: open settings, clear name, save
    await page.getByTestId('edit-project-button').click()
    await expect(page.getByLabel('Project Name')).toBeVisible()
    await page.getByLabel('Project Name').fill('')
    await page.getByRole('button', { name: 'Save Configuration' }).click()
    await expect(page.locator('[data-sonner-toast][data-type="success"]').first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByLabel('Project Name')).toBeHidden()

    // Step 4: Create a shareable URL manually and test loading
    // Since we can't easily access clipboard in tests, we'll simulate loading from URL
    // by creating a config with project data and encoding it
    const testConfig = {
      dicomServer: {
        url: "/api/orthanc/dicom-web",
        headers: {},
        timeout: 30000,
        auth: null,
        description: "Test server"
      },
      anonymization: {
        profileOptions: ["BasicProfile"],
        removePrivateTags: true,
        useCustomHandlers: true,
        dateJitterDays: 31,
        organizationRoot: "1.2.826.0.1.3680043.8.498",
        replacements: { default: "REMOVED" }
      },
      project: {
        name: "URL Test Project",
        id: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: new Date().toISOString()
      }
    }

    // Create base64 encoded URL (uncompressed for simplicity in tests)
    const jsonString = JSON.stringify(testConfig)
    const base64 = Buffer.from(jsonString).toString('base64')
    const urlSafeBase64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const testUrl = `${page.url().split('?')[0]}?project=${urlSafeBase64}`

    // Navigate to the URL with project parameter
    await page.goto(testUrl)

    // Should show success notification for loaded project
    await expect(page.getByText('Loaded project: URL Test Project')).toBeVisible()

    // Project should be active
    await expect(page.getByTestId('project-title')).toContainText('URL Test Project', { timeout: 3000 })

    // URL should be cleaned (project parameter removed)
    await expect(page).toHaveURL('/')
  })

  test('should handle project creation validation', async ({ page }) => {
    await page.goto('/')

    // Wait for app to be ready
    await waitForAppReady(page)

    // Open settings and cancel should close it
    await page.getByTestId('edit-project-button').click()
    await expect(page.getByLabel('Project Name')).toBeVisible()
    await page.getByLabel('Project Name').fill('Valid Project')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('Project Name')).toBeHidden()
  })
})
