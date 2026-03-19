#!/usr/bin/env node
/**
 * lighthouse.js — Run Lighthouse CI audit against trio.catmanbeats.com
 *
 * Usage:  node scripts/lighthouse.js [url]
 * Output: lighthouse-report.html + lighthouse-report.json
 *
 * Note: Lighthouse requires Chromium internally for auditing (even though
 * the app targets Firefox). This is a testing tool only, not user-facing.
 *
 * Install: npm install -g lighthouse (or npx lighthouse)
 */

const { execSync } = require('child_process');
const url = process.argv[2] || 'https://trio.catmanbeats.com';

console.log(`Running Lighthouse audit on ${url}...`);

try {
  execSync(
    `npx lighthouse "${url}" ` +
    '--output=html --output=json ' +
    '--output-path=./lighthouse-report ' +
    '--chrome-flags="--headless --no-sandbox" ' +
    '--only-categories=performance,pwa,accessibility,best-practices ' +
    '--quiet',
    { stdio: 'inherit', timeout: 120000 }
  );

  // Parse JSON report for summary
  const fs = require('fs');
  const report = JSON.parse(fs.readFileSync('./lighthouse-report.report.json', 'utf8'));
  const cats = report.categories;

  console.log('\n=== Lighthouse Results ===');
  console.log(`Performance:    ${Math.round(cats.performance.score * 100)}/100`);
  console.log(`Accessibility:  ${Math.round(cats.accessibility.score * 100)}/100`);
  console.log(`Best Practices: ${Math.round(cats['best-practices'].score * 100)}/100`);
  console.log(`PWA:            ${Math.round(cats.pwa.score * 100)}/100`);
  console.log('\nFull report: lighthouse-report.report.html');

  // Thresholds
  const perf = cats.performance.score * 100;
  const a11y = cats.accessibility.score * 100;
  if (perf < 70) console.warn('\n⚠ Performance below 70 — investigate!');
  if (a11y < 80) console.warn('\n⚠ Accessibility below 80 — investigate!');

} catch (e) {
  console.error('Lighthouse failed:', e.message);
  process.exit(1);
}
