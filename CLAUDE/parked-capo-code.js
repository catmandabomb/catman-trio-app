/**
 * PARKED: Capo Calculator Code
 * Removed from wikicharts.js to declutter controls bar.
 * Ready to re-add when we have a collapsible/popover controls panel.
 *
 * To restore: paste these back into wikicharts.js in the marked locations.
 */

// ─── 1. Function: _capoKey (goes in Transposition engine section) ───

function _capoKey(originalKey, capoFret) {
  if (!originalKey || capoFret <= 0) return originalKey;
  const parsed = _parseChordRoot(originalKey);
  if (!parsed) return originalKey;
  const idx = _rootToIndex(parsed.root);
  if (idx < 0) return originalKey;
  const useFlats = FLAT_KEYS.has(originalKey);
  // Capo up means shapes go DOWN by capoFret semitones
  const newIdx = ((idx - capoFret) % 12 + 12) % 12;
  return _indexToRoot(newIdx, useFlats) + parsed.suffix;
}

// ─── 2. State: add capoFret to _detailState ───
// _detailState = { chartId: null, transposeSemitones: 0, capoFret: 0, showNashville: false };

// ─── 3. Detail view: capoFret variable ───
// let capoFret = _detailState.capoFret;

// ─── 4. Header meta: capo display ───
// if (capoShapes) meta.push('<span class="wc-capo">Capo ' + capoFret + ' (shapes in ' + esc(capoShapes) + ')</span>');
// Where: const capoShapes = capoFret > 0 ? _capoKey(displayKey || chart.key, capoFret) : '';

// ─── 5. Controls bar: capo dropdown ───
/*
html += `<div class="wc-capo-ctrl">
  <label class="wc-ctrl-label">Capo</label>
  <select id="wc-capo-select" class="wc-select">
    <option value="0" ${capoFret === 0 ? 'selected' : ''}>None</option>
    ${[1,2,3,4,5,6,7,8,9].map(f => `<option value="${f}" ${capoFret === f ? 'selected' : ''}>${f}</option>`).join('')}
  </select>
</div>`;
*/

// ─── 6. Event listener: capo change ───
// container.querySelector('#wc-capo-select')?.addEventListener('change', (e) => {
//   capoFret = parseInt(e.target.value, 10) || 0;
//   _detailState.capoFret = capoFret;
//   _render();
// });

// ─── 7. CSS classes (in app.css) ───
// .wc-capo { font-weight: 500; color: var(--text-2); }
// .wc-capo-ctrl { display: flex; align-items: center; gap: 4px; }
