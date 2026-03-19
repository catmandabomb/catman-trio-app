#!/usr/bin/env node
/**
 * build.js — esbuild bundler for Catman Trio App
 *
 * Bundles all ES modules into a single minified file.
 * Keeps service-worker.js, web workers, and UMD libs separate.
 *
 * Usage:
 *   node scripts/build.js          # production build (minified)
 *   node scripts/build.js --dev    # development build (no minify, sourcemap)
 *   node scripts/build.js --watch  # watch mode for development
 *
 * Output: dist/ directory with all production files
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

// Read version from store.js
function getVersion() {
  const storeContent = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
  const match = storeContent.match(/APP_VERSION:\s*'(v[\d.]+)'/);
  if (!match) throw new Error('Could not read APP_VERSION from js/store.js');
  return match[1];
}

const VERSION = getVersion();
console.log(`Building ${VERSION}${isDev ? ' (dev)' : ''}...`);

// Clean dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });

// ─── 1. Bundle app.js (all ES modules → single file) ─────────────
// esbuild resolves all imports and bundles into one file.
// The ?v= query params on imports are stripped by the plugin below.

const stripVersionPlugin = {
  name: 'strip-version-params',
  setup(build) {
    // Strip ?v=... from import paths so esbuild can resolve them
    build.onResolve({ filter: /\?v=/ }, (args) => {
      const cleanPath = args.path.replace(/\?v=[\d.]+$/, '');
      const resolved = path.resolve(args.resolveDir, cleanPath);
      return { path: resolved };
    });
  },
};

async function buildApp() {
  const buildOptions = {
    entryPoints: [path.join(ROOT, 'app.js')],
    bundle: true,
    format: 'esm',
    outfile: path.join(DIST, 'app.js'),
    minify: !isDev,
    sourcemap: isDev ? 'linked' : false,
    target: ['es2020'],
    plugins: [stripVersionPlugin],
    // External globals (loaded via separate <script> tags)
    define: {
      // These are checked at runtime, not bundled
    },
    banner: {
      js: `/* Catman Trio ${VERSION} — bundled ${new Date().toISOString().slice(0, 10)} */`,
    },
    logLevel: 'info',
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
}

// ─── 2. Copy static files that must NOT be bundled ─────────────
function copyStatic() {
  const staticFiles = [
    // HTML + CSS
    'index.html',
    'app.css',
    // Service Worker (must be top-level, not bundled)
    'service-worker.js',
    // PWA manifest + icons
    'manifest.json',
    // UMD libraries (loaded via global <script> tags)
    'lucide.min.js',
    'lib/pdf.min.js',
    'lib/pdf.worker.min.js',
    'lib/Sortable.min.js',
    // Web Workers (loaded via new Worker())
    'workers/levenshtein-worker.js',
    'workers/metronome-processor.js',
    'workers/pdf-render-worker.js',
    'workers/crypto-worker.js',
    'workers/bpm-detect-worker.js',
    // Images
    'img/icon-192.png',
    'img/icon-512.png',
  ];

  for (const file of staticFiles) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST, file);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP (not found): ${file}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ─── 3. Stamp version into dist files ─────────────────────────
function stampVersion() {
  // index.html: replace ?v=ANYTHING with ?v=VERSION for CSS/JS references
  const indexPath = path.join(DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    // Replace the module script src to point to bundled app.js (no ?v= needed, it's hashed by content)
    html = html.replace(
      /src="app\.js\?v=[\d.]+"/,
      `src="app.js?v=${VERSION.replace('v', '')}"`
    );
    // Replace CSS version params
    html = html.replace(
      /href="app\.css\?v=[\d.]+"/g,
      `href="app.css?v=${VERSION.replace('v', '')}"`
    );
    fs.writeFileSync(indexPath, html);
  }

  // service-worker.js: update CACHE_NAME
  const swPath = path.join(DIST, 'service-worker.js');
  if (fs.existsSync(swPath)) {
    let sw = fs.readFileSync(swPath, 'utf8');
    sw = sw.replace(
      /const CACHE_NAME = 'catmantrio-v[\d.]+'/,
      `const CACHE_NAME = 'catmantrio-${VERSION}'`
    );
    // Update SHELL_ASSETS to remove individual module files (they're bundled now)
    // The bundled app only needs: /, /index.html, /app.css, /app.js, + libs + workers + icons
    sw = sw.replace(
      /const SHELL_ASSETS = \[[\s\S]*?\];/,
      `const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/lucide.min.js',
  '/lib/pdf.min.js',
  '/lib/pdf.worker.min.js',
  '/lib/Sortable.min.js',
  '/workers/levenshtein-worker.js',
  '/workers/metronome-processor.js',
  '/workers/pdf-render-worker.js',
  '/workers/crypto-worker.js',
  '/workers/bpm-detect-worker.js',
  '/manifest.json',
  '/img/icon-192.png',
  '/img/icon-512.png',
];`
    );
    fs.writeFileSync(swPath, sw);
  }
}

// ─── Run ──────────────────────────────────────────────────────
(async () => {
  try {
    await buildApp();
    copyStatic();
    stampVersion();

    // Report sizes
    const appDist = path.join(DIST, 'app.js');
    if (fs.existsSync(appDist)) {
      const size = fs.statSync(appDist).size;
      const kb = (size / 1024).toFixed(1);
      console.log(`\n✓ dist/app.js: ${kb} KB${isDev ? '' : ' (minified)'}`);
    }

    const totalFiles = fs.readdirSync(DIST, { recursive: true }).filter(f => !fs.statSync(path.join(DIST, f)).isDirectory()).length;
    console.log(`✓ ${totalFiles} files in dist/`);
    console.log(`✓ Build complete: ${VERSION}`);
  } catch (e) {
    console.error('Build failed:', e);
    process.exit(1);
  }
})();
