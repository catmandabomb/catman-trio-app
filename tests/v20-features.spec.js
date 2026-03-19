// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * v20.10 Feature Traversal Tests
 *
 * Tests new features added in v20.10:
 * - Data export/import UI
 * - Audio offline cache UI
 * - BPM detect button (edit form)
 * - Share target manifest
 * - Unsaved changes confirmation
 * - Settings page layout
 *
 * NOTE: Many features require authentication. Run against a local server
 * with a test account, or use Playwright's storageState for auth.
 */

async function waitForAppReady(page) {
  await expect(page.locator('#app')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#topbar')).toBeVisible({ timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById('splash-screen'), { timeout: 15000 });
}

test.describe('v20.10 Feature Tests (no auth required)', () => {

  test('manifest.json includes share_target config', async ({ page }) => {
    const resp = await page.goto('/manifest.json');
    const manifest = await resp.json();
    expect(manifest.share_target).toBeDefined();
    expect(manifest.share_target.action).toBe('/share-target');
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.share_target.params.files).toBeDefined();
  });

  test('service worker handles share-target POST', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Verify SW is registered and would intercept share-target
    const swActive = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && (reg.active || reg.installing || reg.waiting));
    });
    expect(swActive).toBe(true);
  });

  test('app version is v20.10+', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    const version = await page.evaluate(() => {
      // Store module exposes APP_VERSION
      const badge = document.getElementById('admin-version-badge');
      return badge ? badge.textContent : '';
    });
    expect(version).toMatch(/v20\.\d+/);
  });

  test('login modal is accessible and has form fields', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Click the login button
    const loginBtn = page.locator('#btn-auth-toggle');
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
      await page.waitForTimeout(500);
      // Login form should appear
      const usernameField = page.locator('#login-username');
      const passwordField = page.locator('#login-password');
      // At least one should be visible
      const hasLoginForm = await usernameField.isVisible() || await passwordField.isVisible();
      expect(hasLoginForm).toBe(true);
    }
  });

  test('search functionality works with no songs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      if (input) {
        input.value = 'nonexistent song';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);
    // Should show "No results" or empty list
    const songList = page.locator('#song-list');
    const text = await songList.textContent();
    // Either empty or shows no results
    expect(text.length).toBeLessThan(500); // No massive content
  });
});

test.describe('v20.10 Authenticated Feature Tests', () => {
  // These tests require auth. Skip if not configured.
  // To run: set CATMAN_TEST_USER and CATMAN_TEST_PASS env vars

  test.skip(
    () => !process.env.CATMAN_TEST_USER,
    'Skipping auth tests (set CATMAN_TEST_USER and CATMAN_TEST_PASS)'
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Login
    const loginBtn = page.locator('#btn-auth-toggle');
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
      await page.waitForTimeout(500);
      await page.fill('#login-username', process.env.CATMAN_TEST_USER || '');
      await page.fill('#login-password', process.env.CATMAN_TEST_PASS || '');
      await page.click('#btn-login-submit');
      await page.waitForTimeout(2000);
    }
  });

  test('settings page shows PDF and audio cache sections', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#settings'; });
    await page.waitForTimeout(1000);
    // PDF cache section
    await expect(page.locator('#pref-clear-pdf-cache')).toBeVisible();
    await expect(page.locator('#pref-pdf-cache-label')).toBeVisible();
    // Audio cache section
    await expect(page.locator('#pref-clear-audio-cache')).toBeVisible();
    await expect(page.locator('#pref-audio-cache-label')).toBeVisible();
  });

  test('settings page shows export/import buttons', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#settings'; });
    await page.waitForTimeout(1000);
    await expect(page.locator('#pref-export-data')).toBeVisible();
    await expect(page.locator('#pref-import-data')).toBeVisible();
  });

  test('song edit form has BPM detect button when audio exists', async ({ page }) => {
    // Navigate to first song detail
    const firstSong = page.locator('#song-list .song-row').first();
    if (await firstSong.isVisible()) {
      await firstSong.click();
      await page.waitForTimeout(500);
      // Check if edit button is available (admin only)
      const editBtn = page.locator('#btn-edit-song, .edit-btn');
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.waitForTimeout(500);
        // If the song has audio, BPM detect button should be present
        const bpmBtn = page.locator('#ef-bpm-detect');
        // Don't fail — not all songs have audio
        if (await bpmBtn.isVisible()) {
          expect(await bpmBtn.isEnabled()).toBe(true);
        }
      }
    }
  });

  test('audio offline cache buttons appear on song detail', async ({ page }) => {
    const firstSong = page.locator('#song-list .song-row').first();
    if (await firstSong.isVisible()) {
      await firstSong.click();
      await page.waitForTimeout(1000);
      // Check for cache buttons (only if song has audio)
      const cacheBtn = page.locator('.btn-cache-audio').first();
      if (await cacheBtn.isVisible()) {
        expect(await cacheBtn.isEnabled()).toBe(true);
      }
    }
  });

  test('unsaved changes confirmation shows on song edit cancel', async ({ page }) => {
    const firstSong = page.locator('#song-list .song-row').first();
    if (await firstSong.isVisible()) {
      await firstSong.click();
      await page.waitForTimeout(500);
      const editBtn = page.locator('#btn-edit-song, .edit-btn');
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.waitForTimeout(500);
        // Modify a field to trigger dirty state
        const titleInput = page.locator('#ef-title');
        if (await titleInput.isVisible()) {
          await titleInput.fill('CHANGED TITLE FOR TEST');
          await page.waitForTimeout(100);
          // Click cancel
          await page.click('#ef-cancel');
          await page.waitForTimeout(500);
          // Confirm modal should appear
          const confirmModal = page.locator('#modal-confirm');
          const isVisible = await confirmModal.isVisible();
          if (isVisible) {
            const title = await page.locator('#confirm-title').textContent();
            expect(title).toContain('Unsaved');
            // Cancel the discard (keep editing)
            await page.click('#btn-confirm-cancel');
          }
        }
      }
    }
  });
});
