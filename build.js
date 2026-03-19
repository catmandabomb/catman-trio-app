#!/usr/bin/env node
/**
 * build.js — esbuild bundler + version management for Catman Trio App
 *
 * Usage:
 *   node build.js              — bundle + minify (no version change)
 *   node build.js --bump       — increment version by 0.01, update all 4 locations, then bundle
 *   node build.js --version    — print current version and exit
 *
 * Output:
 *   app.bundle.js     — single bundled + minified file (all app JS)
 *   app.bundle.js.map — source map
 *
 * What gets bundled:
 *   app.js and all its ES module imports (js/*.js, admin.js, player.js, etc.)
 *
 * What does NOT get bundled:
 *   - UMD libraries in lib/ (loaded via <script> tags)
 *   - workers/*.js (run in separate worker scope)
 *   - service-worker.js (SW scope)
 *   - lucide.min.js (UMD global)
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ─── Version Management ─────────────────────────────────────

/**
 * Read current version from js/store.js (e.g. "v19.99" → "19.99")
 */
function readVersion() {
  const storeContent = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
  const match = storeContent.match(/APP_VERSION:\s*'v([\d.]+)'/);
  if (!match) throw new Error('Could not parse APP_VERSION from js/store.js');
  return match[1];
}

/**
 * Increment version by 0.01 (e.g. "19.99" → "20.00")
 */
function bumpVersion(current) {
  const num = parseFloat(current);
  const next = (num + 0.01).toFixed(2);
  return next;
}

/**
 * Update all 4 version locations:
 * 1. js/store.js: APP_VERSION
 * 2. index.html: all ?v= params
 * 3. service-worker.js: CACHE_NAME
 * 4. package.json: version field
 */
function updateVersion(oldVer, newVer) {
  // 1. js/store.js
  const storePath = path.join(ROOT, 'js/store.js');
  let store = fs.readFileSync(storePath, 'utf8');
  store = store.replace(`APP_VERSION:        'v${oldVer}'`, `APP_VERSION:        'v${newVer}'`);
  // Handle any whitespace variation
  store = store.replace(new RegExp(`APP_VERSION:\\s*'v${oldVer.replace('.', '\\.')}'`), `APP_VERSION:        'v${newVer}'`);
  fs.writeFileSync(storePath, store);

  // 2. index.html — replace all ?v=OLD with ?v=NEW
  const indexPath = path.join(ROOT, 'index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  const oldPattern = new RegExp(`\\?v=${oldVer.replace('.', '\\.')}`, 'g');
  index = index.replace(oldPattern, `?v=${newVer}`);
  fs.writeFileSync(indexPath, index);

  // 3. service-worker.js
  const swPath = path.join(ROOT, 'service-worker.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(`catmantrio-v${oldVer}`, `catmantrio-v${newVer}`);
  fs.writeFileSync(swPath, sw);

  // 4. package.json
  const pkgPath = path.join(ROOT, 'package.json');
  let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = newVer + '.0';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  console.log(`Version bumped: v${oldVer} → v${newVer}`);
  console.log(`  Updated: js/store.js, index.html, service-worker.js, package.json`);
}

// ─── Build ──────────────────────────────────────────────────

async function build() {
  const version = readVersion();
  console.log(`Building Catman Trio v${version}...`);

  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'app.js')],
    bundle: true,
    minify: true,
    sourcemap: true,
    outfile: path.join(ROOT, 'app.bundle.js'),
    format: 'esm',
    target: ['es2020', 'chrome90', 'firefox90', 'safari14'],
    // UMD globals accessed via window — mark as external
    external: [],
    // Tree-shake unused exports
    treeShaking: true,
    // Banner with version
    banner: {
      js: `/* Catman Trio v${version} — bundled ${new Date().toISOString().split('T')[0]} */`,
    },
    // Log level
    logLevel: 'info',
  });

  if (result.errors.length > 0) {
    console.error('Build failed:', result.errors);
    process.exit(1);
  }

  // Report bundle size
  const stats = fs.statSync(path.join(ROOT, 'app.bundle.js'));
  const kb = (stats.size / 1024).toFixed(1);
  console.log(`\nBundle: app.bundle.js (${kb} KB minified)`);

  // Update service worker to reference bundle instead of individual files
  // (Don't modify SW automatically — user controls when to switch)
  console.log('\nTo use the bundle in production:');
  console.log('  Replace <script type="module" src="app.js"> with:');
  console.log('  <script type="module" src="app.bundle.js">');

  return result;
}

// ─── CLI ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log('v' + readVersion());
    return;
  }

  if (args.includes('--bump')) {
    const current = readVersion();
    const next = bumpVersion(current);
    updateVersion(current, next);
  }

  await build();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
