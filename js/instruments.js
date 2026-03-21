/**
 * instruments.js — Instrument hierarchy data, icons, and chart filtering
 *
 * Provides:
 * - SVG icon mapping for instrument archetypes
 * - Chart filtering by user's instrument assignment
 * - Instrument picker UI component
 *
 * @module instruments
 */

import * as Store from './store.js?v=20.38';
import * as Auth from '../auth.js?v=20.38';

// ─── SVG Icons (inline, archetype-level) ────────────────

const ICONS = {
  saxophone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2c0 0-2 2-2 5s3 5 3 8c0 4-3 7-7 7"/><circle cx="7" cy="20" r="2"/><path d="M19 3l-2 2"/><path d="M17 5l3-1"/></svg>',
  trumpet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-3h6l2 3h4"/><path d="M7 12v4a2 2 0 004 0v-4"/><circle cx="19" cy="12" r="2"/></svg>',
  trombone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h14"/><path d="M2 14h14"/><path d="M16 8v8a2 2 0 004 0V8a2 2 0 00-4 0z"/><path d="M6 10v4"/></svg>',
  'french-horn': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M20 12h2"/></svg>',
  tuba: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v6a6 6 0 006 6h2"/><path d="M6 20c0-3 2-6 6-6"/><circle cx="8" cy="20" r="3"/></svg>',
  flute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/><circle cx="14" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></svg>',
  clarinet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v16"/><rect x="10" y="18" width="4" height="4" rx="1"/><circle cx="12" cy="7" r="1"/><circle cx="12" cy="11" r="1"/><circle cx="12" cy="15" r="1"/></svg>',
  oboe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v18"/><path d="M10 20l2 2 2-2"/><circle cx="12" cy="8" r="1"/><circle cx="12" cy="12" r="1"/></svg>',
  piano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 4v10"/><path d="M10 4v10"/><path d="M14 4v10"/><path d="M18 4v10"/><path d="M2 14h20"/></svg>',
  guitar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l5 5-1 1-5-5z"/><path d="M11.5 8.5C8 12 7 17 7 17s5-1 8.5-4.5L11.5 8.5z"/><circle cx="9" cy="15" r="2"/></svg>',
  bass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M8 6c0-2 8-2 8 0"/><ellipse cx="12" cy="16" rx="5" ry="3"/></svg>',
  drums: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="10" rx="9" ry="4"/><path d="M3 10v4c0 2.2 4 4 9 4s9-1.8 9-4v-4"/><path d="M7 4l-4 6"/><path d="M17 4l4 6"/></svg>',
  percussion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="6"/><circle cx="16" cy="14" r="6"/><path d="M6 3l4 8"/><path d="M18 3l-4 8"/></svg>',
  vibraphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="4" height="12" rx="1"/><rect x="7" y="4" width="4" height="14" rx="1"/><rect x="12" y="4" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="14" rx="1"/><path d="M4 16v4"/><path d="M9 18v4"/><path d="M14 16v4"/><path d="M19 18v4"/></svg>',
  mandolin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="15" rx="6" ry="4"/><path d="M12 2v9"/><path d="M9 5h6"/></svg>',
  violin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="M10 4h4"/><ellipse cx="12" cy="14" rx="5" ry="6"/><path d="M10 12c0 1 1 2 2 2s2-1 2-2"/></svg>',
  viola: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="M10 4h4"/><ellipse cx="12" cy="14" rx="5" ry="7"/><path d="M10 13c0 1 1 2 2 2s2-1 2-2"/></svg>',
  cello: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5"/><path d="M10 3h4"/><ellipse cx="12" cy="14" rx="6" ry="8"/><path d="M10 12c0 1.5 1 3 2 3s2-1.5 2-3"/></svg>',
  'upright-bass': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5"/><path d="M10 3h4"/><ellipse cx="12" cy="15" rx="6" ry="7"/><path d="M9 13c0 2 1.5 3 3 3s3-1 3-3"/></svg>',
  harp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V6c0-2.2 1.8-4 4-4h0c6 0 10 4 12 10"/><path d="M4 22h16"/><path d="M8 6v14"/><path d="M12 8v12"/><path d="M16 12v8"/></svg>',
  'mic-vocal': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0"/><path d="M12 17v5"/><path d="M8 22h8"/></svg>',
  'mic-stand': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="9" rx="3"/><path d="M5 9a7 7 0 0014 0"/><path d="M12 15v7"/><path d="M8 22h8"/></svg>',
};

/**
 * Get SVG icon HTML for an instrument archetype icon key.
 * @param {string} iconKey - e.g. "saxophone", "piano"
 * @param {string} [className] - Optional CSS class
 * @returns {string} SVG HTML string
 */
function getIcon(iconKey, className) {
  const svg = ICONS[iconKey] || ICONS['mic-vocal'];
  if (className) {
    return svg.replace('<svg ', `<svg class="${className}" `);
  }
  return svg;
}

// ─── Chart Filtering ────────────────────────────────────

/**
 * Given a user's specific instrument ID and the instrument hierarchy tree,
 * returns a Set of all instrument IDs this user "matches" at every tier level.
 * Used to filter charts by instrument assignment.
 *
 * @param {string} instrumentId - User's specific instrument ID (e.g. "inst_alto_sax")
 * @param {Object} hierarchy - { sections: [...] } from Store
 * @returns {Set<string>} Set of matching IDs including 'all', section, archetype, specific
 */
function getMatchingTags(instrumentId, hierarchy) {
  const tags = new Set(['all']);
  if (!instrumentId || !hierarchy?.sections) return tags;

  for (const section of hierarchy.sections) {
    for (const archetype of section.archetypes || []) {
      for (const instrument of archetype.instruments || []) {
        if (instrument.id === instrumentId) {
          tags.add(section.id);
          tags.add(archetype.id);
          tags.add(instrument.id);
          return tags;
        }
      }
    }
  }
  return tags;
}

/**
 * Filter a song's charts array based on user's instrument.
 * Each chart in the assets.charts array may have an `instruments` field (JSON array of tag IDs).
 *
 * @param {Array} charts - Song's charts array from assets
 * @param {Set<string>} userTags - From getMatchingTags()
 * @param {string} filterMode - 'smart' | 'section' | 'all' | 'mine-only'
 * @returns {Array} Filtered charts
 */
function filterCharts(charts, userTags, filterMode) {
  if (!charts || !charts.length) return charts || [];
  if (filterMode === 'all' || !userTags || userTags.size <= 1) return charts;

  return charts.filter(chart => {
    const chartTags = chart.instruments || chart.instrumentTags || ['all'];
    if (chartTags.includes('all')) return true;

    if (filterMode === 'mine-only') {
      // Only charts specifically tagged for user's exact instrument
      return chartTags.some(t => userTags.has(t) && t.startsWith('inst_'));
    }
    // 'smart' (default): show all charts matching any tier of user's instrument
    return chartTags.some(t => userTags.has(t));
  });
}

/**
 * Resolve an instrument ID to its full info from the hierarchy.
 * @param {string} instrumentId
 * @param {Object} hierarchy
 * @returns {{ id, name, archetypeName, sectionName, iconKey }|null}
 */
function resolveInstrument(instrumentId, hierarchy) {
  if (!instrumentId || !hierarchy?.sections) return null;
  for (const section of hierarchy.sections) {
    for (const archetype of section.archetypes || []) {
      for (const instrument of archetype.instruments || []) {
        if (instrument.id === instrumentId) {
          return {
            id: instrument.id,
            name: instrument.name,
            archetypeName: archetype.name,
            sectionName: section.name,
            iconKey: archetype.iconKey,
          };
        }
      }
    }
  }
  return null;
}

// ─── Instrument Picker Component ────────────────────────

/**
 * Render a cascading instrument picker (Section > Archetype > Specific).
 * @param {HTMLElement} container - Target element
 * @param {string|null} currentId - Currently selected instrument ID
 * @param {Function} onSelect - Callback with selected instrument ID
 */
function renderPicker(container, currentId, onSelect) {
  const hierarchy = Store.get('instrumentHierarchy');
  if (!hierarchy?.sections?.length) {
    container.innerHTML = '<p class="muted">No instruments available</p>';
    return;
  }

  // Resolve current selection
  const current = currentId ? resolveInstrument(currentId, hierarchy) : null;

  let html = '<div class="instrument-picker">';

  // Section select
  html += '<div class="form-group"><label>Section</label><select id="inst-section" class="select-input">';
  html += '<option value="">Select section…</option>';
  for (const s of hierarchy.sections) {
    const sel = current?.sectionName === s.name ? ' selected' : '';
    html += `<option value="${s.id}"${sel}>${_esc(s.name)}</option>`;
  }
  html += '</select></div>';

  // Archetype select (populated dynamically)
  html += '<div class="form-group"><label>Instrument Type</label><select id="inst-archetype" class="select-input" disabled>';
  html += '<option value="">Select type…</option>';
  if (current) {
    const section = hierarchy.sections.find(s => s.name === current.sectionName);
    if (section) {
      for (const a of section.archetypes || []) {
        const sel = current.archetypeName === a.name ? ' selected' : '';
        html += `<option value="${a.id}"${sel}>${_esc(a.name)}</option>`;
      }
    }
  }
  html += '</select></div>';

  // Specific select
  html += '<div class="form-group"><label>Specific Instrument</label><select id="inst-specific" class="select-input" disabled>';
  html += '<option value="">Select instrument…</option>';
  if (current) {
    const section = hierarchy.sections.find(s => s.name === current.sectionName);
    const archetype = section?.archetypes?.find(a => a.name === current.archetypeName);
    if (archetype) {
      for (const i of archetype.instruments || []) {
        const sel = i.id === currentId ? ' selected' : '';
        html += `<option value="${i.id}"${sel}>${_esc(i.name)}</option>`;
      }
    }
  }
  html += '</select></div>';

  html += '</div>';
  container.innerHTML = html;

  // Wire up cascading selects
  const sectionSel = container.querySelector('#inst-section');
  const archSel = container.querySelector('#inst-archetype');
  const specSel = container.querySelector('#inst-specific');

  sectionSel.addEventListener('change', () => {
    const sectionId = sectionSel.value;
    archSel.innerHTML = '<option value="">Select type…</option>';
    specSel.innerHTML = '<option value="">Select instrument…</option>';
    archSel.disabled = !sectionId;
    specSel.disabled = true;
    if (!sectionId) return;
    const section = hierarchy.sections.find(s => s.id === sectionId);
    for (const a of section?.archetypes || []) {
      archSel.innerHTML += `<option value="${a.id}">${_esc(a.name)}</option>`;
    }
  });

  archSel.addEventListener('change', () => {
    const archId = archSel.value;
    specSel.innerHTML = '<option value="">Select instrument…</option>';
    specSel.disabled = !archId;
    if (!archId) return;
    const section = hierarchy.sections.find(s => s.id === sectionSel.value);
    const arch = section?.archetypes?.find(a => a.id === archId);
    for (const i of arch?.instruments || []) {
      specSel.innerHTML += `<option value="${i.id}">${_esc(i.name)}</option>`;
    }
  });

  specSel.addEventListener('change', () => {
    const instId = specSel.value;
    if (instId && onSelect) onSelect(instId);
  });
}

function _esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export { getIcon, getMatchingTags, filterCharts, resolveInstrument, renderPicker, ICONS };
