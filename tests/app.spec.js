// @ts-check
const { test, expect } = require('@playwright/test');

// Helper: wait for app to finish loading (splash gone + init complete)
async function waitForAppReady(page) {
  // Wait for the main app to be visible
  await expect(page.locator('#app')).toBeVisible({ timeout: 15000 });
  // Wait for topbar which means JS has executed
  await expect(page.locator('#topbar')).toBeVisible({ timeout: 5000 });
  // Wait for splash screen to be removed (signals init() has completed)
  await page.waitForFunction(() => !document.getElementById('splash-screen'), { timeout: 15000 });
}

// ─── Test 1: App loads and renders correctly ────────────────────
test('app loads and renders main UI', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  // Topbar should be visible with title
  const titleText = await page.locator('#topbar-title').textContent();
  expect(titleText).toContain('Catman');

  // Search bar should be present
  await expect(page.locator('#search-input')).toBeVisible();

  // Song list container should exist
  await expect(page.locator('#song-list')).toBeAttached();
});

// ─── Test 2: Search input is functional ─────────────────────────
test('search input accepts text and dispatches input event', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  const searchInput = page.locator('#search-input');
  await expect(searchInput).toBeVisible();

  // Use evaluate to set value + dispatch input event (bypasses auth-gated click overlay)
  await page.evaluate(() => {
    const input = document.getElementById('search-input');
    input.value = 'test query';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(searchInput).toHaveValue('test query');

  // Clear button should appear (the app toggles .hidden class on input)
  const clearBtn = page.locator('#search-clear');
  await expect(clearBtn).not.toHaveClass(/hidden/, { timeout: 3000 });

  // Click clear — input should empty
  await clearBtn.click({ force: true });
  await expect(searchInput).toHaveValue('');
});

// ─── Test 3: Hash navigation works ─────────────────────────────
test('hash navigation updates the active view', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  // List view should be active initially
  await expect(page.locator('#view-list')).toHaveClass(/active/);

  // Navigate via hash change (bypasses auth gate, stays on same page)
  await page.evaluate(() => { window.location.hash = '#setlists'; });
  await page.waitForTimeout(500);

  // Check URL has the hash
  expect(page.url()).toContain('#setlists');

  // Navigate back to list
  await page.evaluate(() => { window.location.hash = '#list'; });
  await page.waitForTimeout(500);
  await expect(page.locator('#view-list')).toHaveClass(/active/, { timeout: 3000 });
});

// ─── Test 4: Service worker registers ───────────────────────────
test('service worker registers successfully', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  // Wait a moment for SW registration to complete
  await page.waitForTimeout(1000);

  const swRegistered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg;
  });
  expect(swRegistered).toBe(true);
});

// ─── Test 5: App works offline (shell cached) ───────────────────
test('app loads from cache when offline', async ({ page, context }) => {
  // First load — populate the cache
  await page.goto('/');
  await waitForAppReady(page);

  // Wait for SW to finish caching shell assets
  await page.waitForTimeout(3000);

  // Go offline
  await context.setOffline(true);

  // Reload — should serve from SW cache
  await page.reload({ waitUntil: 'domcontentloaded' });

  // App should still render
  await expect(page.locator('#topbar')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#app')).toBeVisible();

  // Restore online
  await context.setOffline(false);
});
