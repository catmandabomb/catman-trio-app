# Research Log — All Agents & Research Tasks

**Last updated**: 2026-03-20

---

## Completed Research Agents

| # | Agent | Date | Scope | Key Findings | File | Integrated? |
|---|---|---|---|---|---|---|
| 1 | **Android Deep Audit** | 2026-03-20 | Samsung, budget Android, Huawei, WebView, Go, foldables, tablets, audio, PWA, CSS | 14 action items. Score 7.7/10. Foldables 5/10 (no resize handler). OEM battery killing is #1 fragmentation issue. | `CLAUDE/android-deep-audit.md` | YES — merged into cheatsheet |
| 2 | **iOS Deep Audit** | 2026-03-20 | iOS Safari, WebKit quirks, iPadOS, safe areas, audio volume, PWA isolation | iOS-specific quick rules and Safari version matrix. audio.volume read-only, AudioWorklet bug, OffscreenCanvas broken. | `CLAUDE/ios-deep-audit.md` | PARTIAL — quick rules in cheatsheet, full section still [PENDING] |
| 3 | **Desktop Browser Audit** | 2026-03-20 | Brave, Opera/GX, Vivaldi, Arc, Edge, Firefox, Safari macOS, Chromebook, Windows tablet, 9 extension categories | 12 recommendations. Brave Shields + Dark Reader are top risks. Safari macOS needs install hint. | `CLAUDE/desktop-browser-audit.md` | YES — merged into cheatsheet |
| 4 | **A11y / i18n / Perf Audit** | 2026-03-20 | WCAG 2.1 AA keyboard/SR/ARIA/contrast/touch, character rendering, RTL, performance budgets | A11y 6.2/10, i18n 7.5/10, Perf 6.8/10. Song cards keyboard-inaccessible (CRITICAL). All color contrasts PASS. | `CLAUDE/accessibility-i18n-perf-audit.md` | YES — merged into cheatsheet |
| 5 | **Device Compatibility Audit** (cross-platform) | 2026-03-20 | 7 critical gaps across all platforms, scored 7.8/10 | Foundation audit that spawned the 4 deep audits above. | `CLAUDE/device-compatibility-audit.md` | YES — informed cheatsheet structure |
| 6 | **AI Song Detection Research** | 2026-03-20 | MusicBrainz, AcoustID, Spotify API, auto-populate key/BPM/duration | API options, rate limits, accuracy tradeoffs | `CLAUDE/song-detection-research.md` | NO — parked, awaiting design |
| 7 | **Backing Track Research** | pre-v20.28 | Bass/drums synthesis for practice backing tracks | Web Audio synthesis approaches, sample-based vs algorithmic | `memory/backing-track-research.md` (referenced in MEMORY.md, file may not exist) | NO — parked |
| 8 | **Conductr Audit** | pre-v20.28 | 9 Conductr-only feature areas | Feature gaps for conductr role | `CLAUDE/conductr-audit.md` | YES — 18 settings shipped v20.28 |
| 9 | **Conductr Settings Ideas** | pre-v20.28 | 25 settings across 7 categories, 3 phases | Informed the 18 GO settings in v20.28 | `CLAUDE/conductr-settings-ideas.md` | YES — Phase 1 shipped |
| 10 | **Settings Integrity Audit** | pre-v20.28 | Data integrity of all settings/prefs | 1 MEDIUM: ct_last_played unbounded growth (FIXED) | `CLAUDE/settings-integrity-audit.md` | YES — fixed v20.28+ |
| 11 | **Dynamic Header Research** | 2026-03-20 | Resize nav buttons based on available space | Background agent launched, results pending | No file yet | NO — awaiting results |

---

## QA Audits (not research agents, but related)

| Audit | Date | Scope | File |
|---|---|---|---|
| QA Audit v20.05 | early | Full app QA pass | `CLAUDE/qa-audit-v20.05.md` |
| QA Audit v20.06 | early | Follow-up QA pass | `CLAUDE/qa-audit-v20.06.md` |
| Barrel Audit v20.31 | 2026-03-20 | 2-pass parallel audit, 7 bugs found + fixed | session-handoff-v20.31.md |

---

## Integration Status Summary

- **Cheatsheet fully populated**: Android, Desktop, A11y, i18n, Performance sections
- **Cheatsheet still [PENDING]**: iOS section (quick rules present but full content not merged)
- **All audit action items tracked**: in `memory/ledger/MASTER-LEDGER.md` P0-P3 priority table
- **Research awaiting action**: AI song detection (design phase), dynamic header (results pending), backing tracks (parked)
