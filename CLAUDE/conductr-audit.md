# Conductr-Only Features Audit — v20.22

Comprehensive audit of all features gated behind conductr/admin/owner roles.

## Role Hierarchy Reference

| Role | `canEditSongs()` | `canEditSetlists()` | `canManageOrchestra()` | `canManageUsers()` | `canUploadFiles()` | `canEditPractice()` |
|------|------------------|---------------------|------------------------|--------------------|--------------------|---------------------|
| **owner** | yes | yes | yes | yes | yes | yes |
| **admin** | yes | yes | yes | no | yes | yes |
| **conductr** | yes | yes | yes | no | yes | yes |
| **member** | no | no | no | no | no | yes |
| **guest** | no | no | no | no | no | no |

---

## 1. Songs (`js/songs.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| Add Song button visibility | `Admin.isEditMode()` | Hidden for members |
| Song card edit (pencil) button | `Admin.isEditMode()` | Only shown in admin mode |
| Song detail "Edit Song" bar | `Admin.isEditMode()` | Edit bar removed for non-admins |
| Edit song form / save | `Admin.isEditMode()` | Guard at entry to edit render |
| Delete song | `Admin.isEditMode()` | Within edit form only |
| Upload charts/audio | `Admin.isEditMode()` | Implicit via edit mode gate |
| Song list cache key includes edit mode | `Admin.isEditMode()` | Different renders for admin vs non-admin |
| Favorite/star songs | `Admin.isEditMode() || Auth.isLoggedIn()` | All logged-in users can favorite |

## 2. Setlists (`js/setlists.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| "New Setlist" topbar button | `Admin.isEditMode()` | Only in admin mode |
| Setlist card edit button | `Admin.isEditMode()` | Pencil icon on card |
| Setlist card delete button | `Admin.isEditMode()` | Trash icon on card |
| Setlist detail "Edit" topbar button | `Admin.isEditMode()` | Edit + Copy buttons |
| Setlist detail "Copy" (duplicate) button | `Admin.isEditMode()` | Duplicate setlist |
| Setlist detail edit bar | `Admin.isEditMode()` | Removed if not admin |
| Add song to setlist picker | `Admin.isEditMode()` | `showSetlistPicker()` guard |
| Batch add songs to setlist | `Admin.isEditMode()` | `showBatchSetlistPicker()` guard |
| Setlist notes edit vs readonly | `Auth.canEditSetlists() && (Auth.isConductr() \|\| Admin.isAdminModeActive())` | Members see read-only notes |
| Freetext entry key override button | `Auth.canEditSetlists()` | Key override on freetext entries |
| View setlists at all | `Auth.isLoggedIn()` | Must be logged in |

## 3. WikiCharts (`js/wikicharts.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| Create new WikiChart (+) button | `Auth.isLoggedIn()` | ALL logged-in users can create |
| Edit own WikiChart | `_canEdit(chart)` | Owner of chart OR `canEditSongs()` |
| Edit any WikiChart | `Auth.canEditSongs()` | Admins/conductrs/owners can edit any |
| Delete WikiChart | `_canEdit(chart)` | Same as edit permission |
| Version management | `_canEdit(chart)` | Only if can edit the chart |

## 4. Practice Lists (`js/practice.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| Create new practice list | `Auth.isLoggedIn()` | All non-guest logged-in users |
| Edit own practice list | Own list (`createdBy` match) OR `Admin.isEditMode()` | Admins can edit any |
| Delete practice list | Own list OR `Admin.isEditMode()` | Same pattern |
| View practice lists | `Auth.isLoggedIn()` | Must be logged in |

## 5. Orchestra (`js/orchestra.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| "Create Orchestra" button | `Auth.canManageOrchestra()` | owner/admin/conductr |
| "Create Orchestra" (standalone, in list) | `canManage && Auth.isConductr()` | Only conductrs see standalone create |
| "Manage" button on orchestra card | `Auth.canManageOrchestra()` | Navigate to detail/management |
| Invite members | `isConductr` (orchestra-level) OR `Auth.isOwnerOrAdmin()` | Orchestra-level conductr check |
| Remove members | `isConductr` (orchestra-level) | Cannot remove self or other conductrs |
| Orchestra settings (name, description) | `isConductr` (orchestra-level) | Only orchestra conductr |
| Switch orchestra | Any member of multiple orchestras | All logged-in users |

## 6. Dashboard (`js/dashboard.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| Access dashboard at all | `Auth.isLoggedIn() && Auth.canEditSongs()` | owner/admin/conductr |
| Storage migration section | `Auth.getRole() === 'owner'` | Owner only |
| Shared setlist packets | `['owner', 'admin'].includes(Auth.getRole())` | Owner + admin |
| User management link | `Auth.canManageUsers()` | Owner only |
| Tag manager link | `Admin.isEditMode()` | owner/admin/conductr in admin mode |
| Data management / purge | `Auth.getRole() === 'owner'` | Owner only |
| Data export section | `Auth.getRole() === 'owner'` | Owner only |
| Admin mode toggle | `Admin.isEditMode()` | In topbar |

## 7. Account Page (`app.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| Admin/User mode toggle in topbar | `Auth.canEditSongs()` | owner/admin/conductr |
| Dashboard button (in account) | `Auth.canEditSongs()` | Via `_renderOrchestraSelector` |
| Delete account button | `user.role !== 'owner'` | Hidden from owner |
| Manage orchestra button | Implicit via orchestra section | All users see their orchestras |

## 8. Admin Module (`admin.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| `isEditMode()` | `Auth.isLoggedIn() && Auth.canEditSongs() && _adminModeActive` | Combined gate |
| `enterEditMode()` | `Auth.isLoggedIn() && Auth.canEditSongs()` | Must have edit permission |
| Add Song FAB visibility | `isEditMode()` | Tied to admin mode toggle |

## 9. Settings Page (`app.js`)

| Feature | Gate | Notes |
|---------|------|-------|
| Access settings | `Auth.isLoggedIn()` | All logged-in users |
| **Conductr Tools section** | `Auth.canEditSongs()` | **NEW** - owner/admin/conductr only |
| Setlist Insights toggle | `Auth.canEditSongs()` | **NEW** - controls last played, duplicates, key flow |

---

## Summary

The primary gate for "conductr-level" features is `Auth.canEditSongs()` which returns true for **owner**, **admin**, and **conductr** roles. This is the same check used by `Admin.isEditMode()` (plus the `_adminModeActive` toggle).

Members and guests cannot:
- Add, edit, or delete songs
- Create, edit, or delete setlists
- Edit setlist notes (read-only)
- Access the dashboard
- Toggle admin/user mode
- Edit other users' WikiCharts
- Create orchestras
- Upload files

Members CAN:
- View songs, setlists, and WikiCharts
- Create and manage their own practice lists
- Create their own WikiCharts
- Favorite songs
- Access all settings (live mode, practice, display, etc.)
