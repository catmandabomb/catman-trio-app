# Topbar Buttons Map — Catman Trio App v20.18

## HTML Topbar Structure (index.html lines 108-136)

```
<header #topbar>
  <div .topbar-row-top>
    [#btn-back]  [#topbar-title]  [.topbar-right: #btn-wikicharts #btn-practice #btn-setlists #btn-topbar-refresh + injected actions]
  </div>
  <div .topbar-row-bottom>
    [#topbar-actions + #qi-badge]  [#master-volume slider]
  </div>
</header>
```

Note: `#btn-account`, `#btn-auth-toggle`, `#btn-add-song`, `#btn-install-app` are in `.list-subheader` inside `#view-list` (NOT in the topbar header).

---

## View-by-View Button Map

### LIST (Song List) — `#` home
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Hidden | Home page | — |
| Title | `#topbar-title` | Catman Trio gradient + version badge | Always | Admin on list → Dashboard; Logged-in non-admin → Sync refresh; Else → scroll top |
| Right | `#btn-wikicharts` | Visible | Always | → WikiCharts |
| Right | `#btn-practice` | Visible | Always | → Practice |
| Right | `#btn-setlists` | Visible | Always | → Setlists |
| Subheader | `#btn-auth-toggle` | Visible if NOT logged in | `!Auth.isLoggedIn()` | → Login modal |
| Subheader | `#btn-account` | Visible if logged in | `Auth.isLoggedIn()` | → Account page |
| Subheader | `#btn-add-song` | Visible if admin mode active | `Admin.isAdminModeActive()` | → New song modal |
| Subheader | `#btn-install-app` | Visible if PWA installable | `deferredInstallPrompt` exists | → PWA install prompt |

### SONG DETAIL — `#song/:id`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to list |
| Title | `#topbar-title` | Song title text | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#song-detail-topbar-actions` | Visible if logged in | `Auth.isLoggedIn()` | Admin: "Add to Setlist" picker; Non-admin: "Add to Practice" picker |
| Bottom | Volume slider | Visible if audio exists | Song has audio/links | Volume control |

### SONG EDIT — no hash (injected)
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to detail |
| Title | `#topbar-title` | "Edit Song" / "New Song" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | No injected actions | — | — | Save/Cancel in content |

### SETLISTS — `#setlists`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to list |
| Title | `#topbar-title` | "Setlists" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#setlists-topbar-actions` | Visible if admin edit mode | `Admin.isEditMode()` | → New setlist edit |

### SETLIST DETAIL — `#setlist/:id`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to setlists |
| Title | `#topbar-title` | Setlist name + date | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#setlist-detail-topbar-actions` | Visible if admin edit mode | `Admin.isEditMode()` | Edit + Copy buttons |

### SETLIST LIVE MODE — no hash (injected)
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Special | Full custom header | Auto-hides | Configurable | Row1: jump, progress, clock/timer, exit. Row2: dark, half, red, notes, auto |
| Keys | G=stage red, N=notes, ?=help | — | Keyboard only | — |

### PRACTICE — `#practice`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to list |
| Title | `#topbar-title` | "Practice Lists" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#practice-topbar-actions` | Visible if logged in | `Auth.isLoggedIn()` | → New practice list |

### PRACTICE DETAIL — `#practice` (sub-view)
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to practice lists |
| Title | `#topbar-title` | List name | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#practice-list-detail-topbar-actions` | Edit: admin. Delete: admin OR creator | `Admin.isEditMode()` or `createdBy === userId` | Edit / Delete |

### PRACTICE MODE (active, inside detail)
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Exit practice mode |
| Title | `#topbar-title` | "Song X / Total" | Always | Progress |
| Right | `#tuning-fork-wrap` | Visible | Always in practice mode | Tuning fork + pitch selector |

### DASHBOARD — `#dashboard`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to list |
| Title | `#topbar-title` | "Dashboard" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#dash-topbar-actions` | **Always visible** (admin-only view) | `Auth.canEditSongs()` guard | "User Mode"/"Admin Mode" toggle + "Log Out" |

### ACCOUNT — `#account`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to list |
| Title | `#topbar-title` | "My Account" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#acct-logout-topbar` | Mode toggle: admin only. Log Out: always | `Auth.canEditSongs()` for toggle | "User Mode"/"Admin Mode" toggle + "Log Out" |

### SETTINGS — `#settings`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to account |
| Title | `#topbar-title` | "Settings" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | No injected actions | — | — | — |

### WIKICHARTS — `#wikicharts`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to list |
| Title | `#topbar-title` | "WikiCharts" | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#wikicharts-topbar-actions` | Visible if logged in | `Auth.isLoggedIn()` | → New WikiChart |

### WIKICHART DETAIL — `#wikichart/:id`
| Position | Element | Visibility | Conditions | Action |
|----------|---------|------------|------------|--------|
| Left | `#btn-back` | Visible | Always | → Back to wikicharts |
| Title | `#topbar-title` | Chart title | Always | — |
| Right | Nav buttons | Hidden | `setTopbar(_, true)` | — |
| Right | `#wikichart-detail-topbar-actions` | Edit: admin or creator. Copy/Duplicate: always. History: if versions exist + can edit | `_canEdit(chart)` | Edit, Copy ASCII, Duplicate, History |

---

## Permission Gates Summary

| Gate | Function | Controls |
|------|----------|----------|
| Logged in | `Auth.isLoggedIn()` | Account btn, practice access, add-to-setlist/practice, wikichart create |
| Admin/Owner | `Auth.canEditSongs()` | Dashboard access, mode toggle buttons, edit/delete on all entities |
| Admin mode on | `Admin.isAdminModeActive()` | Add Song btn visibility, edit icons on cards |
| Edit mode on | `Admin.isEditMode()` | New Setlist btn, Edit/Copy btns on setlist detail, practice edit |
| Creator match | `createdBy === userId` | Practice list delete, WikiChart edit/delete |

## Dynamic Button Injection

All views use `skipViewTransition` (v20.18 fix) before `showView()` to ensure buttons injected after `showView()` aren't removed by async `swap()`. Cleanup happens in `swap()` line 167 of `router.js`.
