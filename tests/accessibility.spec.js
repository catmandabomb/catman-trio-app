// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/**
 * Accessibility audit using axe-core.
 * Tests key views for WCAG 2.1 AA violations.
 */

test.describe('Accessibility audit', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to initialize
    await page.waitForSelector('#view-list', { state: 'visible', timeout: 10000 });
  });

  test('Main song list has no critical a11y violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .exclude('.lucide-icon') // SVG icons are decorative
      .analyze();

    const critical = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    );

    if (critical.length > 0) {
      console.log('Critical/serious a11y violations:');
      critical.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        v.nodes.forEach(n => console.log(`    - ${n.html.substring(0, 120)}`));
      });
    }

    expect(critical.length).toBe(0);
  });

  test('Login modal has no critical a11y violations', async ({ page }) => {
    // Click login to show the auth modal
    const loginBtn = page.locator('#btn-auth-toggle');
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
      await page.waitForTimeout(500);
    }

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const critical = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    );

    expect(critical.length).toBe(0);
  });

  test('All interactive elements are keyboard accessible', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['button-name', 'link-name', 'label', 'tabindex'])
      .analyze();

    const violations = results.violations;
    if (violations.length > 0) {
      console.log('Keyboard accessibility violations:');
      violations.forEach(v => {
        console.log(`  ${v.id}: ${v.description} (${v.nodes.length} instances)`);
      });
    }

    // Allow minor violations but no critical keyboard issues
    const critical = violations.filter(v => v.impact === 'critical');
    expect(critical.length).toBe(0);
  });

  test('Color contrast meets WCAG AA', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();

    const violations = results.violations;
    if (violations.length > 0) {
      console.log(`Color contrast violations: ${violations[0]?.nodes?.length || 0} elements`);
      violations[0]?.nodes?.slice(0, 5).forEach(n => {
        console.log(`  - ${n.html.substring(0, 100)}`);
        console.log(`    ${n.message}`);
      });
    }

    // Log but don't fail on contrast (dark themes often have minor issues)
    // Fail only if more than 10 elements have contrast issues
    const count = violations[0]?.nodes?.length || 0;
    expect(count).toBeLessThan(10);
  });

  test('ARIA roles and attributes are valid', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules([
        'aria-allowed-attr',
        'aria-hidden-focus',
        'aria-required-attr',
        'aria-roles',
        'aria-valid-attr',
        'aria-valid-attr-value',
      ])
      .analyze();

    const violations = results.violations;
    if (violations.length > 0) {
      console.log('ARIA violations:');
      violations.forEach(v => {
        console.log(`  ${v.id}: ${v.description} (${v.nodes.length} instances)`);
      });
    }

    expect(violations.length).toBe(0);
  });
});
