// @ts-check
/**
 * integration.spec.js — Playwright integration / regression test suite
 *
 * Walks the live app checking for data corruption, UI regressions, and
 * navigation failures. Designed to catch the class of bugs we've seen
 * before: songs disappearing after sort, empty data after sync, missing
 * buttons, broken navigation, etc.
 *
 * Run: npx playwright test tests/integration.spec.js
 * Requires: Playwright installed, app running at BASE_URL
 */

const { test, expect } = require('@playwright/test');

// Uses baseURL from playwright.config.js — works with both localhost and production
const BASE_URL = '/';

// ─── Helpers ─────────────────────────────────────────────────

async function waitForAppReady(page) {
  await expect(page.locator('#app')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#topbar')).toBeVisible({ timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById('splash-screen'), { timeout: 15000 });
}

/** Count song cards in the song list */
async function countSongs(page) {
  return page.evaluate(() =>
    document.querySelectorAll('[aria-label^="Song:"]').length
  );
}

/** Navigate to a hash route and wait for view transition */
async function navigateTo(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(600);
}

// ─── 1. APP LOAD & STRUCTURE ─────────────────────────────────

test.describe('App Load', () => {
  test('loads and renders main UI with topbar', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);

    // Topbar title present
    const title = await page.locator('#topbar-title').textContent();
    expect(title).toContain('Catman');

    // Version string visible
    const versionText = await page.evaluate(() => {
      const el = document.querySelector('#topbar-title');
      return el ? el.textContent : '';
    });
    expect(versionText).toMatch(/v\d+\.\d+/);
  });

  test('search bar is visible and functional', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await expect(page.locator('#search-input')).toBeVisible();
  });

  test('no critical JS errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(2000);

    // Filter out CSP violations (not JS crashes)
    const jsErrors = errors.filter(e => !e.includes('Content-Security-Policy'));
    expect(jsErrors).toHaveLength(0);
  });
});

// ─── 2. SONG LIST INTEGRITY ─────────────────────────────────

test.describe('Song List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    // Wait for sync to populate songs
    await page.waitForTimeout(2000);
  });

  test('song list is not empty', async ({ page }) => {
    const count = await countSongs(page);
    expect(count).toBeGreaterThan(0);
  });

  test('song list has expected minimum count', async ({ page }) => {
    // We know there are 17 songs — allow some tolerance for additions
    const count = await countSongs(page);
    expect(count).toBeGreaterThanOrEqual(15);
  });

  test('every song card has a title', async ({ page }) => {
    const emptyTitles = await page.evaluate(() => {
      const cards = document.querySelectorAll('[aria-label^="Song:"]');
      let empty = 0;
      cards.forEach(c => {
        const label = c.getAttribute('aria-label') || '';
        if (label === 'Song:' || label === 'Song: ') empty++;
      });
      return empty;
    });
    expect(emptyTitles).toBe(0);
  });

  test('sort button is visible for authenticated users', async ({ page }) => {
    const sortBtn = page.locator('button[aria-label="Change sort order"]');
    await expect(sortBtn).toBeVisible();
  });

  test('add song button is visible for authenticated users', async ({ page }) => {
    const addBtn = page.locator('button[aria-label="Add song"]');
    await expect(addBtn).toBeVisible();
  });

  test('sort does NOT reduce song count (anti-nuke test)', async ({ page }) => {
    const countBefore = await countSongs(page);
    expect(countBefore).toBeGreaterThan(0);

    // Click sort
    await page.locator('button[aria-label="Change sort order"]').click();
    await page.waitForTimeout(500);

    const countAfter = await countSongs(page);
    expect(countAfter).toBe(countBefore);
  });

  test('search filters songs correctly', async ({ page }) => {
    const countBefore = await countSongs(page);

    // Type a specific song name
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      input.value = 'Curious';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const countFiltered = await countSongs(page);
    expect(countFiltered).toBeGreaterThan(0);
    expect(countFiltered).toBeLessThan(countBefore);

    // Verify the correct song appears
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label^="Song:"]')]
        .map(el => el.getAttribute('aria-label'))
    );
    expect(titles.some(t => t.includes('Curious'))).toBe(true);

    // Clear search — full list should restore
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const countRestored = await countSongs(page);
    expect(countRestored).toBe(countBefore);
  });

  test('tag pills are present', async ({ page }) => {
    const tagCount = await page.evaluate(() => {
      const container = document.getElementById('song-tags');
      return container ? container.querySelectorAll('button').length : 0;
    });
    expect(tagCount).toBeGreaterThan(0);
  });

  test('key pills are present', async ({ page }) => {
    const keyCount = await page.evaluate(() => {
      const allBtns = document.querySelectorAll('button');
      return [...allBtns].filter(b =>
        /^[A-G][#b]?\s*(Major|Minor)$/.test(b.textContent.trim())
      ).length;
    });
    expect(keyCount).toBeGreaterThan(0);
  });

  test('key filter works and restores', async ({ page }) => {
    const countBefore = await countSongs(page);

    // Click a key pill
    await page.evaluate(() => {
      const allBtns = document.querySelectorAll('button');
      const keyBtn = [...allBtns].find(b =>
        /^[A-G][#b]?\s*(Major|Minor)$/.test(b.textContent.trim())
      );
      if (keyBtn) keyBtn.click();
    });
    await page.waitForTimeout(300);

    const countFiltered = await countSongs(page);
    expect(countFiltered).toBeGreaterThan(0);
    expect(countFiltered).toBeLessThanOrEqual(countBefore);

    // Click again to deselect
    await page.evaluate(() => {
      const allBtns = document.querySelectorAll('button');
      const activeKey = [...allBtns].find(b =>
        /^[A-G][#b]?\s*(Major|Minor)$/.test(b.textContent.trim()) &&
        b.classList.contains('active')
      );
      if (activeKey) activeKey.click();
    });
    await page.waitForTimeout(300);

    const countRestored = await countSongs(page);
    expect(countRestored).toBe(countBefore);
  });
});

// ─── 3. NAVIGATION ──────────────────────────────────────────

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(1000);
  });

  test('WikiCharts page loads with content', async ({ page }) => {
    await page.locator('button:has-text("Charts")').click();
    await page.waitForTimeout(600);

    expect(page.url()).toContain('#wikicharts');

    // Should have a back button and title
    await expect(page.locator('button:has-text("Back")')).toBeVisible();
    // Search bar on wikicharts
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('Practice page loads with lists', async ({ page }) => {
    await page.locator('button:has-text("Practice")').first().click();
    await page.waitForTimeout(600);

    expect(page.url()).toContain('#practice');
    await expect(page.locator('button:has-text("Back")')).toBeVisible();

    // Should have at least one practice list
    const listCount = await page.evaluate(() => {
      const view = document.getElementById('view-practice');
      if (!view) return 0;
      return view.querySelectorAll('button[class*="card"], .practice-card, [role="button"]').length;
    });
    expect(listCount).toBeGreaterThan(0);
  });

  test('Setlists page loads with setlists', async ({ page }) => {
    await page.locator('button:has-text("Setlists")').first().click();
    await page.waitForTimeout(600);

    expect(page.url()).toContain('#setlists');
    await expect(page.locator('button:has-text("Back")')).toBeVisible();

    // Should have at least one setlist
    const setlistCount = await page.evaluate(() =>
      document.querySelectorAll('[aria-label^="Setlist:"]').length
    );
    expect(setlistCount).toBeGreaterThan(0);
  });

  test('Messages page loads', async ({ page }) => {
    await page.locator('button[aria-label="Messages"]').click();
    await page.waitForTimeout(600);

    expect(page.url()).toContain('#messages');
    await expect(page.locator('button:has-text("Back")')).toBeVisible();
    // Category filter pills should be present
    await expect(page.locator('button:has-text("All")')).toBeVisible();
  });

  test('song detail loads with metadata', async ({ page }) => {
    // Click first song
    const firstSong = page.locator('[aria-label^="Song:"]').first();
    await firstSong.click();
    await page.waitForTimeout(600);

    expect(page.url()).toContain('#song/');

    // Back button visible
    await expect(page.locator('button:has-text("Back")')).toBeVisible();

    // Metadata section should exist (Key, BPM, Time)
    const hasMetadata = await page.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Key') && text.includes('BPM');
    });
    expect(hasMetadata).toBe(true);
  });

  test('back navigation returns to song list', async ({ page }) => {
    // Go to Charts
    await page.locator('button:has-text("Charts")').click();
    await page.waitForTimeout(600);
    expect(page.url()).toContain('#wikicharts');

    // Go back
    await page.locator('button:has-text("Back")').click();
    await page.waitForTimeout(600);

    // Should be back on song list with songs
    const count = await countSongs(page);
    expect(count).toBeGreaterThan(0);
  });

  test('navigation round-trip preserves song count', async ({ page }) => {
    const countBefore = await countSongs(page);

    // Navigate away and back through each section
    for (const route of ['#wikicharts', '#practice', '#setlists', '#messages']) {
      await navigateTo(page, route);
    }

    // Return to song list
    await navigateTo(page, '#list');
    await page.waitForTimeout(500);

    const countAfter = await countSongs(page);
    expect(countAfter).toBe(countBefore);
  });
});

// ─── 4. SONG DETAIL ─────────────────────────────────────────

test.describe('Song Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(2000);
  });

  test('song detail shows chart section for songs with charts', async ({ page }) => {
    // Find a song that says "1 chart" in its card
    const songWithChart = page.locator('[aria-label^="Song:"]').filter({
      hasText: 'chart'
    }).first();

    await songWithChart.click();
    await page.waitForTimeout(600);

    // Charts section should be present
    const hasCharts = await page.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Charts') || text.includes('chart');
    });
    expect(hasCharts).toBe(true);
  });

  test('song detail shows tags section', async ({ page }) => {
    // Click first song with tags
    const songWithTags = page.locator('[aria-label^="Song:"]').first();
    await songWithTags.click();
    await page.waitForTimeout(600);

    const hasTags = await page.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Tags');
    });
    expect(hasTags).toBe(true);
  });
});

// ─── 5. PRACTICE LIST DETAIL ────────────────────────────────

test.describe('Practice Detail', () => {
  test('practice list detail shows songs', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(1000);

    // Go to practice
    await page.locator('button:has-text("Practice")').first().click();
    await page.waitForTimeout(600);

    // Find a list with songs (not "0 songs")
    const listWithSongs = page.locator('button').filter({
      hasText: /[1-9]\d* songs/
    }).first();

    if (await listWithSongs.count() > 0) {
      await listWithSongs.click();
      await page.waitForTimeout(600);

      expect(page.url()).toContain('#practice/');

      // Should show numbered songs
      const hasSongs = await page.evaluate(() => {
        const text = document.body.textContent || '';
        return /"\d+"/.test(text) || text.includes('Add Song');
      });
      expect(hasSongs).toBe(true);
    }
  });
});

// ─── 6. DATA INTEGRITY ──────────────────────────────────────

test.describe('Data Integrity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(2000);
  });

  test('songs have valid metadata format', async ({ page }) => {
    const issues = await page.evaluate(() => {
      const cards = document.querySelectorAll('[aria-label^="Song:"]');
      const problems = [];
      cards.forEach(card => {
        const text = card.textContent || '';
        const title = card.getAttribute('aria-label')?.replace('Song: ', '');
        // Every song should have a BPM display
        if (!text.includes('bpm')) {
          problems.push(`${title}: missing BPM`);
        }
      });
      return problems;
    });
    // Allow some songs without BPM but flag if many are broken
    expect(issues.length).toBeLessThan(5);
  });

  test('localStorage has song data', async ({ page }) => {
    const hasSongs = await page.evaluate(() => {
      const data = localStorage.getItem('ct_songs');
      if (!data) return false;
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch { return false; }
    });
    expect(hasSongs).toBe(true);
  });

  test('localStorage has setlist data', async ({ page }) => {
    const hasSetlists = await page.evaluate(() => {
      const data = localStorage.getItem('ct_setlists');
      if (!data) return false;
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch { return false; }
    });
    expect(hasSetlists).toBe(true);
  });

  test('localStorage has practice data', async ({ page }) => {
    const hasPractice = await page.evaluate(() => {
      const data = localStorage.getItem('ct_practice_lists');
      if (!data) return false;
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch { return false; }
    });
    expect(hasPractice).toBe(true);
  });
});

// ─── 7. UI ELEMENT VISIBILITY ───────────────────────────────

test.describe('UI Elements (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(1000);
  });

  test('topbar nav buttons visible (Charts, Practice, Setlists)', async ({ page }) => {
    await expect(page.locator('button:has-text("Charts")')).toBeVisible();
    await expect(page.locator('button:has-text("Practice")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Setlists")').first()).toBeVisible();
  });

  test('admin action buttons visible (Messages, Account, Add)', async ({ page }) => {
    await expect(page.locator('button[aria-label="Messages"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Account"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Add song"]')).toBeVisible();
  });

  test('Log Out button visible', async ({ page }) => {
    await expect(page.locator('button:has-text("Log Out")')).toBeVisible();
  });

  test('footer has navigation links', async ({ page }) => {
    const footerLinks = await page.evaluate(() => {
      const footer = document.querySelector('footer, .app-footer');
      if (!footer) {
        // Check for footer-like content at bottom
        const text = document.body.textContent || '';
        return text.includes('Navigate') && text.includes('Songs');
      }
      return true;
    });
    expect(footerLinks).toBe(true);
  });
});

// ─── 8. SERVICE WORKER ──────────────────────────────────────

test.describe('Service Worker', () => {
  test('service worker is registered', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForAppReady(page);
    await page.waitForTimeout(2000);

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    expect(swRegistered).toBe(true);
  });
});
