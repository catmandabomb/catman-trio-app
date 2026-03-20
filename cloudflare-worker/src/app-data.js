/**
 * app-data.js — D1-backed CRUD for songs, setlists, practice, wikicharts
 *
 * Replaces GitHub data branch as the primary data store.
 * All endpoints require session auth. Write operations require admin/owner/conductr role.
 *
 * Orchestra scoping: when orchestraId is provided, all queries filter by it.
 * When null (pre-migration or no orchestra set), returns all data (backward compat).
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Permission helper ─────────────────────────────────

/**
 * Check if user can write data in the given orchestra context.
 * Owner/admin can always write. Conductr can write in their orchestra.
 */
export function canWriteData(currentUser, orchestraId) {
  if (['owner', 'admin'].includes(currentUser.role)) return true;
  if (currentUser.role === 'conductr' && orchestraId && currentUser.activeOrchestraId === orchestraId) return true;
  return false;
}

// ─── Songs ──────────────────────────────────────────────

export async function listSongs(env, orchestraId) {
  let query, bind;
  if (orchestraId) {
    query = 'SELECT id, title, subtitle, key, bpm, time_sig, duration, tags, notes, assets, chart_order, difficulty, orchestra_id, version, updated_at, created_at FROM songs WHERE orchestra_id = ? ORDER BY title COLLATE NOCASE';
    bind = [orchestraId];
  } else {
    query = 'SELECT id, title, subtitle, key, bpm, time_sig, duration, tags, notes, assets, chart_order, difficulty, orchestra_id, version, updated_at, created_at FROM songs ORDER BY title COLLATE NOCASE';
    bind = [];
  }
  const stmt = env.DB.prepare(query);
  const { results } = bind.length ? await stmt.bind(...bind).all() : await stmt.all();
  const songs = (results || []).map(_rowToSong);
  return json({ songs });
}

export async function saveSongs(request, env, orchestraId) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.songs)) {
    return json({ error: 'songs array required' }, 400);
  }

  const useVersioning = body.songs.some(s => s.version != null);
  if (useVersioning) {
    const conflict = await _checkVersionConflicts(env, 'songs', body.songs);
    if (conflict) return conflict;
  }

  const batch = [];
  const now = new Date().toISOString();

  for (const song of body.songs) {
    if (!song.id) continue;
    batch.push(
      env.DB.prepare(`
        INSERT INTO songs (id, title, subtitle, key, bpm, time_sig, duration, tags, notes, assets, chart_order, difficulty, orchestra_id, version, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          subtitle = excluded.subtitle,
          key = excluded.key,
          bpm = excluded.bpm,
          time_sig = excluded.time_sig,
          duration = excluded.duration,
          tags = excluded.tags,
          notes = excluded.notes,
          assets = excluded.assets,
          chart_order = excluded.chart_order,
          difficulty = excluded.difficulty,
          version = songs.version + 1,
          updated_at = excluded.updated_at
      `).bind(
        song.id,
        song.title || '',
        song.subtitle || '',
        song.key || '',
        String(song.bpm || ''),
        song.timeSig || '',
        song.duration || 0,
        JSON.stringify(song.tags || []),
        song.notes || '',
        JSON.stringify(song.assets || {}),
        JSON.stringify(song.chartOrder || []),
        song.difficulty || null,
        orchestraId || null,
        now,
        song.createdAt || now
      )
    );
  }

  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      if (orchestraId) {
        batch.push(env.DB.prepare('DELETE FROM songs WHERE id = ? AND orchestra_id = ?').bind(id, orchestraId));
      } else {
        batch.push(env.DB.prepare('DELETE FROM songs WHERE id = ? AND orchestra_id IS NULL').bind(id));
      }
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.songs.length });
}

// ─── Setlists ───────────────────────────────────────────

export async function listSetlists(env, orchestraId) {
  let query, bind;
  if (orchestraId) {
    query = 'SELECT id, venue, gig_date, override_title, songs, notes, archived, orchestra_id, version, updated_at, created_at FROM setlists WHERE orchestra_id = ? ORDER BY created_at DESC';
    bind = [orchestraId];
  } else {
    query = 'SELECT id, venue, gig_date, override_title, songs, notes, archived, orchestra_id, version, updated_at, created_at FROM setlists ORDER BY created_at DESC';
    bind = [];
  }
  const stmt = env.DB.prepare(query);
  const { results } = bind.length ? await stmt.bind(...bind).all() : await stmt.all();
  const setlists = (results || []).map(_rowToSetlist);
  return json({ setlists });
}

export async function saveSetlists(request, env, orchestraId) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.setlists)) {
    return json({ error: 'setlists array required' }, 400);
  }

  const useVersioning = body.setlists.some(s => s.version != null);
  if (useVersioning) {
    const conflict = await _checkVersionConflicts(env, 'setlists', body.setlists);
    if (conflict) return conflict;
  }

  const batch = [];
  const now = new Date().toISOString();

  for (const sl of body.setlists) {
    if (!sl.id) continue;
    batch.push(
      env.DB.prepare(`
        INSERT INTO setlists (id, venue, gig_date, override_title, songs, notes, archived, orchestra_id, version, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          venue = excluded.venue,
          gig_date = excluded.gig_date,
          override_title = excluded.override_title,
          songs = excluded.songs,
          notes = excluded.notes,
          archived = excluded.archived,
          version = setlists.version + 1,
          updated_at = excluded.updated_at
      `).bind(
        sl.id,
        sl.venue || '',
        sl.gigDate || '',
        sl.overrideTitle || '',
        JSON.stringify(sl.songs || []),
        sl.notes || '',
        sl.archived ? 1 : 0,
        orchestraId || null,
        now,
        sl.createdAt || now
      )
    );
  }

  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      if (orchestraId) {
        batch.push(env.DB.prepare('DELETE FROM setlists WHERE id = ? AND orchestra_id = ?').bind(id, orchestraId));
      } else {
        batch.push(env.DB.prepare('DELETE FROM setlists WHERE id = ? AND orchestra_id IS NULL').bind(id));
      }
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.setlists.length });
}

// ─── Practice ───────────────────────────────────────────

export async function listPractice(env, orchestraId) {
  let query, bind;
  if (orchestraId) {
    query = 'SELECT id, name, created_by, songs, archived, orchestra_id, version, updated_at, created_at FROM practice_lists WHERE orchestra_id = ? ORDER BY created_at DESC';
    bind = [orchestraId];
  } else {
    query = 'SELECT id, name, created_by, songs, archived, orchestra_id, version, updated_at, created_at FROM practice_lists ORDER BY created_at DESC';
    bind = [];
  }
  const stmt = env.DB.prepare(query);
  const { results } = bind.length ? await stmt.bind(...bind).all() : await stmt.all();
  const lists = (results || []).map(_rowToPractice);
  return json({ practice: lists });
}

export async function savePractice(request, env, currentUser, orchestraId) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.practice)) {
    return json({ error: 'practice array required' }, 400);
  }

  const useVersioning = body.practice.some(p => p.version != null);
  if (useVersioning) {
    const conflict = await _checkVersionConflicts(env, 'practice_lists', body.practice);
    if (conflict) return conflict;
  }

  const isPrivileged = ['owner', 'admin', 'conductr'].includes(currentUser.role);
  const batch = [];
  const now = new Date().toISOString();

  for (const p of body.practice) {
    if (!p.id) continue;
    if (!isPrivileged) {
      const existing = await env.DB.prepare(
        'SELECT created_by FROM practice_lists WHERE id = ?'
      ).bind(p.id).first();
      if (existing && existing.created_by !== currentUser.username) {
        return json({ error: 'Cannot modify another user\'s practice list' }, 403);
      }
    }
    batch.push(
      env.DB.prepare(`
        INSERT INTO practice_lists (id, name, created_by, songs, archived, orchestra_id, version, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          songs = excluded.songs,
          archived = excluded.archived,
          version = practice_lists.version + 1,
          updated_at = excluded.updated_at
      `).bind(
        p.id,
        p.name || '',
        isPrivileged ? (p.createdBy || currentUser.username) : currentUser.username,
        JSON.stringify(p.songs || []),
        p.archived ? 1 : 0,
        orchestraId || null,
        now,
        p.createdAt || now
      )
    );
  }

  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      if (!isPrivileged) {
        const row = await env.DB.prepare('SELECT created_by FROM practice_lists WHERE id = ?').bind(id).first();
        if (row && row.created_by !== currentUser.username) {
          return json({ error: 'Cannot delete another user\'s practice list' }, 403);
        }
      }
      batch.push(env.DB.prepare('DELETE FROM practice_lists WHERE id = ?').bind(id));
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.practice.length });
}

// ─── WikiCharts ─────────────────────────────────────────

export async function listWikiCharts(env, orchestraId) {
  let query, bind;
  if (orchestraId) {
    query = 'SELECT id, title, key, bpm, time_sig, feel, sections, structure_tag, notes, versions, created_by, orchestra_id, version, updated_at, created_at FROM wiki_charts WHERE orchestra_id = ? ORDER BY title COLLATE NOCASE';
    bind = [orchestraId];
  } else {
    query = 'SELECT id, title, key, bpm, time_sig, feel, sections, structure_tag, notes, versions, created_by, orchestra_id, version, updated_at, created_at FROM wiki_charts ORDER BY title COLLATE NOCASE';
    bind = [];
  }
  const stmt = env.DB.prepare(query);
  const { results } = bind.length ? await stmt.bind(...bind).all() : await stmt.all();
  const wikiCharts = (results || []).map(_rowToWikiChart);
  return json({ wikiCharts });
}

export async function saveWikiCharts(request, env, currentUser, orchestraId) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.wikiCharts)) {
    return json({ error: 'wikiCharts array required' }, 400);
  }

  const useVersioning = body.wikiCharts.some(w => w.version != null);
  if (useVersioning) {
    const conflict = await _checkVersionConflicts(env, 'wiki_charts', body.wikiCharts);
    if (conflict) return conflict;
  }

  const batch = [];
  const now = new Date().toISOString();

  for (const wc of body.wikiCharts) {
    if (!wc.id) continue;
    batch.push(
      env.DB.prepare(`
        INSERT INTO wiki_charts (id, title, key, bpm, time_sig, feel, sections, structure_tag, notes, versions, created_by, orchestra_id, version, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          key = excluded.key,
          bpm = excluded.bpm,
          time_sig = excluded.time_sig,
          feel = excluded.feel,
          sections = excluded.sections,
          structure_tag = excluded.structure_tag,
          notes = excluded.notes,
          versions = excluded.versions,
          version = wiki_charts.version + 1,
          updated_at = excluded.updated_at
      `).bind(
        wc.id,
        wc.title || '',
        wc.key || '',
        wc.bpm || 0,
        wc.timeSig || '4/4',
        wc.feel || '',
        JSON.stringify(wc.sections || []),
        wc.structureTag || '',
        wc.notes || '',
        JSON.stringify(wc.versions || []),
        wc.createdBy || currentUser.username,
        orchestraId || null,
        now,
        wc.createdAt || now
      )
    );
  }

  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      if (orchestraId) {
        batch.push(env.DB.prepare('DELETE FROM wiki_charts WHERE id = ? AND orchestra_id = ?').bind(id, orchestraId));
      } else {
        batch.push(env.DB.prepare('DELETE FROM wiki_charts WHERE id = ? AND orchestra_id IS NULL').bind(id));
      }
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.wikiCharts.length });
}

// ─── Change detection (lightweight poll endpoint) ───────

export async function getChangeTimestamps(env, orchestraId) {
  let songsQ, setlistsQ, practiceQ, wikiQ;
  if (orchestraId) {
    songsQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM songs WHERE orchestra_id = ?').bind(orchestraId).first();
    setlistsQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM setlists WHERE orchestra_id = ?').bind(orchestraId).first();
    practiceQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM practice_lists WHERE orchestra_id = ?').bind(orchestraId).first();
    wikiQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM wiki_charts WHERE orchestra_id = ?').bind(orchestraId).first();
  } else {
    songsQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM songs').first();
    setlistsQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM setlists').first();
    practiceQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM practice_lists').first();
    wikiQ = env.DB.prepare('SELECT MAX(updated_at) as latest, COUNT(*) as count FROM wiki_charts').first();
  }
  const [songsRes, setlistsRes, practiceRes, wikiRes] = await Promise.all([songsQ, setlistsQ, practiceQ, wikiQ]);
  return json({
    songs: { latest: songsRes?.latest || null, count: songsRes?.count || 0 },
    setlists: { latest: setlistsRes?.latest || null, count: setlistsRes?.count || 0 },
    practice: { latest: practiceRes?.latest || null, count: practiceRes?.count || 0 },
    wikiCharts: { latest: wikiRes?.latest || null, count: wikiRes?.count || 0 },
  });
}

// ─── Files (R2) ─────────────────────────────────────────

export async function uploadFile(request, env, currentUser, orchestraId) {
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  const filename = request.headers.get('X-Filename') || 'upload';
  const songId = request.headers.get('X-Song-Id') || '';
  const fileType = request.headers.get('X-File-Type') || 'chart';
  const instrumentTags = request.headers.get('X-Instrument-Tags') || '[]';

  const data = await request.arrayBuffer();
  if (!data || data.byteLength === 0) {
    return json({ error: 'Empty file' }, 400);
  }
  if (data.byteLength > 50 * 1024 * 1024) {
    return json({ error: 'File too large (max 50MB)' }, 400);
  }

  const fileId = _generateId();
  const ext = _getExtension(filename);
  // Prefix R2 key with orchestra ID for new uploads
  const prefix = orchestraId ? `${orchestraId}/` : '';
  const r2Key = `files/${prefix}${songId || '_unsorted'}/${fileId}${ext}`;

  await env.PACKETS.put(r2Key, data, {
    httpMetadata: { contentType },
    customMetadata: { filename, songId, fileType, uploadedBy: currentUser.userId },
  });

  await env.DB.prepare(`
    INSERT INTO files (id, r2_key, filename, mime_type, size_bytes, song_id, file_type, uploaded_by, orchestra_id, instrument_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(fileId, r2Key, filename, contentType, data.byteLength, songId, fileType, currentUser.userId, orchestraId || null, instrumentTags).run();

  return json({ ok: true, fileId, r2Key, filename, size: data.byteLength });
}

export async function downloadFile(env, fileId) {
  const file = await env.DB.prepare('SELECT r2_key, filename, mime_type FROM files WHERE id = ?').bind(fileId).first();
  if (!file) return json({ error: 'File not found' }, 404);

  const obj = await env.PACKETS.get(file.r2_key);
  if (!obj) return json({ error: 'File missing from storage' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': file.mime_type,
      'Content-Disposition': `inline; filename="${_safeFilename(file.filename)}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export async function deleteFile(env, fileId, orchestraId, currentUser) {
  const file = await env.DB.prepare('SELECT r2_key, orchestra_id FROM files WHERE id = ?').bind(fileId).first();
  if (!file) return json({ error: 'File not found' }, 404);

  // Scope check: owner/admin can delete any file; others must own the orchestra
  if (!['owner', 'admin'].includes(currentUser.role)) {
    if (file.orchestra_id !== orchestraId) return json({ error: 'Permission denied' }, 403);
  }

  await env.PACKETS.delete(file.r2_key);
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();

  return json({ ok: true });
}

export async function listFiles(env, songId, orchestraId) {
  let query, bind;
  if (songId) {
    query = 'SELECT id, filename, mime_type, size_bytes, file_type, instrument_tags, uploaded_at FROM files WHERE song_id = ? ORDER BY uploaded_at';
    bind = [songId];
  } else if (orchestraId) {
    query = 'SELECT id, filename, mime_type, size_bytes, song_id, file_type, instrument_tags, uploaded_at FROM files WHERE orchestra_id = ? ORDER BY uploaded_at DESC LIMIT 500';
    bind = [orchestraId];
  } else {
    query = 'SELECT id, filename, mime_type, size_bytes, song_id, file_type, instrument_tags, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT 500';
    bind = [];
  }

  const stmt = env.DB.prepare(query);
  const { results } = bind.length ? await stmt.bind(...bind).all() : await stmt.all();
  return json({ files: results || [] });
}

// ─── Orchestras ─────────────────────────────────────────

export async function listOrchestras(env, currentUser) {
  // Owner/admin see ALL orchestras; others see only their memberships
  if (['owner', 'admin'].includes(currentUser.role)) {
    const { results } = await env.DB.prepare(
      'SELECT id, name, description, genres, conductr_id, max_members, is_active, created_at, updated_at FROM orchestras ORDER BY name COLLATE NOCASE'
    ).all();
    return json({ orchestras: (results || []).map(_rowToOrchestra) });
  }
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, o.description, o.genres, o.conductr_id, o.max_members, o.is_active, o.created_at, o.updated_at
     FROM orchestras o
     JOIN orchestra_members om ON o.id = om.orchestra_id
     WHERE om.user_id = ? AND o.is_active = 1
     ORDER BY o.name COLLATE NOCASE`
  ).bind(currentUser.userId).all();
  return json({ orchestras: (results || []).map(_rowToOrchestra) });
}

export async function getOrchestra(env, orchestraId, currentUser) {
  const orch = await env.DB.prepare(
    'SELECT id, name, description, genres, conductr_id, max_members, is_active, created_at, updated_at FROM orchestras WHERE id = ?'
  ).bind(orchestraId).first();
  if (!orch) return json({ error: 'Orchestra not found' }, 404);

  // Verify access: member, conductr, or owner/admin
  if (!['owner', 'admin'].includes(currentUser.role)) {
    const membership = await env.DB.prepare(
      'SELECT 1 FROM orchestra_members WHERE orchestra_id = ? AND user_id = ?'
    ).bind(orchestraId, currentUser.userId).first();
    if (!membership) return json({ error: 'Not a member of this orchestra' }, 403);
  }

  // Get member count (visible only)
  const memberCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM orchestra_members WHERE orchestra_id = ? AND is_visible = 1'
  ).bind(orchestraId).first();

  const orchestra = _rowToOrchestra(orch);
  orchestra.memberCount = memberCount?.cnt || 0;
  return json({ orchestra });
}

export async function createOrchestra(env, currentUser, body) {
  if (!body || !body.name) {
    return json({ error: 'Orchestra name required' }, 400);
  }
  if (body.name.length > 60) {
    return json({ error: 'Orchestra name must be 60 characters or less' }, 400);
  }

  // Check name uniqueness
  const existing = await env.DB.prepare(
    'SELECT id FROM orchestras WHERE LOWER(name) = ? LIMIT 1'
  ).bind(body.name.trim().toLowerCase()).first();
  if (existing) {
    return json({ error: 'An orchestra with this name already exists' }, 409);
  }

  // Conductr can only have 1 orchestra
  if (currentUser.role === 'conductr') {
    const existingOrch = await env.DB.prepare(
      'SELECT id FROM orchestras WHERE conductr_id = ? LIMIT 1'
    ).bind(currentUser.userId).first();
    if (existingOrch) {
      return json({ error: 'Conductrs can only lead one orchestra' }, 409);
    }
  }

  const orchId = _generateId();
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO orchestras (id, name, description, genres, conductr_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(orchId, body.name.trim(), body.description || '', JSON.stringify(body.genres || []), currentUser.userId, now, now),
    // Auto-add creator as member
    env.DB.prepare(
      'INSERT INTO orchestra_members (orchestra_id, user_id, is_visible, joined_at) VALUES (?, ?, ?, ?)'
    ).bind(orchId, currentUser.userId, ['owner', 'admin'].includes(currentUser.role) ? 0 : 1, now),
    // Set as active orchestra
    env.DB.prepare(
      'UPDATE users SET active_orchestra_id = ?, updated_at = ? WHERE id = ?'
    ).bind(orchId, now, currentUser.userId),
  ]);

  return json({ ok: true, orchestra: { id: orchId, name: body.name.trim(), conductrId: currentUser.userId } }, 201);
}

export async function updateOrchestra(env, orchestraId, currentUser, body) {
  // Verify: conductr of this orchestra, or owner/admin
  const orch = await env.DB.prepare('SELECT conductr_id FROM orchestras WHERE id = ?').bind(orchestraId).first();
  if (!orch) return json({ error: 'Orchestra not found' }, 404);
  if (!['owner', 'admin'].includes(currentUser.role) && orch.conductr_id !== currentUser.userId) {
    return json({ error: 'Only the conductr can update this orchestra' }, 403);
  }

  const sets = [];
  const vals = [];
  if (body.name !== undefined) {
    if (body.name.length > 60) return json({ error: 'Name too long' }, 400);
    sets.push('name = ?'); vals.push(body.name.trim());
  }
  if (body.description !== undefined) {
    if (typeof body.description === 'string' && body.description.length > 500) return json({ error: 'Description too long (max 500 chars)' }, 400);
    sets.push('description = ?'); vals.push(body.description || '');
  }
  if (body.genres !== undefined) { sets.push('genres = ?'); vals.push(JSON.stringify(body.genres)); }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);

  sets.push('updated_at = ?'); vals.push(new Date().toISOString());
  vals.push(orchestraId);
  await env.DB.prepare(`UPDATE orchestras SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true });
}

// ─── Orchestra Members ──────────────────────────────────

export async function listOrchestraMembers(env, orchestraId, currentUser) {
  const orch = await env.DB.prepare('SELECT conductr_id FROM orchestras WHERE id = ?').bind(orchestraId).first();
  if (!orch) return json({ error: 'Orchestra not found' }, 404);

  // Owner/admin see all members (including invisible). Others see only visible.
  let query;
  if (['owner', 'admin'].includes(currentUser.role)) {
    query = `SELECT u.id, u.username, u.display_name, u.role, u.instrument_id, om.is_visible, om.joined_at
             FROM orchestra_members om JOIN users u ON om.user_id = u.id
             WHERE om.orchestra_id = ? ORDER BY om.joined_at`;
  } else {
    query = `SELECT u.id, u.username, u.display_name, u.role, u.instrument_id, om.is_visible, om.joined_at
             FROM orchestra_members om JOIN users u ON om.user_id = u.id
             WHERE om.orchestra_id = ? AND om.is_visible = 1 ORDER BY om.joined_at`;
  }
  const { results } = await env.DB.prepare(query).bind(orchestraId).all();
  const members = (results || []).map(r => ({
    id: r.id, username: r.username, displayName: r.display_name, role: r.role,
    instrumentId: r.instrument_id, isVisible: !!r.is_visible, joinedAt: r.joined_at,
  }));
  return json({ members, conductrId: orch.conductr_id });
}

export async function addOrchestraMember(env, orchestraId, currentUser, body) {
  if (!body || !body.username) {
    return json({ error: 'Username required' }, 400);
  }

  // Verify conductr/owner/admin access
  const orch = await env.DB.prepare('SELECT conductr_id, max_members FROM orchestras WHERE id = ?').bind(orchestraId).first();
  if (!orch) return json({ error: 'Orchestra not found' }, 404);
  if (!['owner', 'admin'].includes(currentUser.role) && orch.conductr_id !== currentUser.userId) {
    return json({ error: 'Only the conductr can add members' }, 403);
  }

  // Find user
  const user = await env.DB.prepare(
    'SELECT id, username, role FROM users WHERE LOWER(username) = ? AND is_active = 1'
  ).bind(body.username.trim().toLowerCase()).first();
  if (!user) return json({ error: 'User not found' }, 404);

  // Check if already a member
  const existing = await env.DB.prepare(
    'SELECT 1 FROM orchestra_members WHERE orchestra_id = ? AND user_id = ?'
  ).bind(orchestraId, user.id).first();
  if (existing) return json({ error: 'User is already a member' }, 409);

  // Guest: max 1 orchestra
  if (user.role === 'guest') {
    const guestCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM orchestra_members WHERE user_id = ?'
    ).bind(user.id).first();
    if ((guestCount?.cnt || 0) >= 1) return json({ error: 'Guests can only be in 1 orchestra' }, 409);
  }

  // Member: max 5 orchestras
  if (user.role === 'member') {
    const memberCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM orchestra_members WHERE user_id = ?'
    ).bind(user.id).first();
    if ((memberCount?.cnt || 0) >= 5) return json({ error: 'Member is already in the maximum number of orchestras (5)' }, 409);
  }

  // Check orchestra member cap
  const currentCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM orchestra_members WHERE orchestra_id = ? AND is_visible = 1'
  ).bind(orchestraId).first();
  if ((currentCount?.cnt || 0) >= orch.max_members) {
    return json({ error: 'Orchestra is at maximum capacity' }, 409);
  }

  const isInvisible = ['owner', 'admin'].includes(user.role) ? 0 : 1;
  await env.DB.prepare(
    'INSERT INTO orchestra_members (orchestra_id, user_id, is_visible, joined_at) VALUES (?, ?, ?, ?)'
  ).bind(orchestraId, user.id, isInvisible, new Date().toISOString()).run();

  // If user has no active orchestra, set this one
  const userRow = await env.DB.prepare('SELECT active_orchestra_id FROM users WHERE id = ?').bind(user.id).first();
  if (!userRow?.active_orchestra_id) {
    await env.DB.prepare('UPDATE users SET active_orchestra_id = ?, updated_at = ? WHERE id = ?')
      .bind(orchestraId, new Date().toISOString(), user.id).run();
  }

  return json({ ok: true, userId: user.id, username: user.username }, 201);
}

export async function removeOrchestraMember(env, orchestraId, userId, currentUser) {
  const orch = await env.DB.prepare('SELECT conductr_id FROM orchestras WHERE id = ?').bind(orchestraId).first();
  if (!orch) return json({ error: 'Orchestra not found' }, 404);

  // Can't remove the conductr
  if (userId === orch.conductr_id) {
    return json({ error: 'Cannot remove the conductr. Transfer leadership first.' }, 422);
  }

  // Must be conductr, owner, admin, or self
  const isSelf = userId === currentUser.userId;
  const isConductr = orch.conductr_id === currentUser.userId;
  if (!isSelf && !isConductr && !['owner', 'admin'].includes(currentUser.role)) {
    return json({ error: 'Permission denied' }, 403);
  }

  await env.DB.prepare(
    'DELETE FROM orchestra_members WHERE orchestra_id = ? AND user_id = ?'
  ).bind(orchestraId, userId).run();

  // If user's active orchestra was this one, clear it
  await env.DB.prepare(
    'UPDATE users SET active_orchestra_id = NULL, updated_at = ? WHERE id = ? AND active_orchestra_id = ?'
  ).bind(new Date().toISOString(), userId, orchestraId).run();

  return json({ ok: true });
}

// ─── Instruments ────────────────────────────────────────

export async function getInstrumentHierarchy(env, orchestraId) {
  // Get global sections + orchestra-specific custom sections
  let sectionQuery, sectionBind;
  if (orchestraId) {
    sectionQuery = 'SELECT id, orchestra_id, name, sort_order FROM instrument_sections WHERE orchestra_id IS NULL OR orchestra_id = ? ORDER BY sort_order';
    sectionBind = [orchestraId];
  } else {
    sectionQuery = 'SELECT id, orchestra_id, name, sort_order FROM instrument_sections WHERE orchestra_id IS NULL ORDER BY sort_order';
    sectionBind = [];
  }

  const sStmt = env.DB.prepare(sectionQuery);
  const { results: sections } = sectionBind.length ? await sStmt.bind(...sectionBind).all() : await sStmt.all();

  if (!sections || sections.length === 0) return json({ sections: [] });

  const sectionIds = sections.map(s => s.id);
  const placeholders = sectionIds.map(() => '?').join(',');

  const [archRes, specRes] = await Promise.all([
    env.DB.prepare(`SELECT id, section_id, name, icon_key, sort_order FROM instrument_archetypes WHERE section_id IN (${placeholders}) ORDER BY sort_order`).bind(...sectionIds).all(),
    // Get all specifics for matching archetypes
    env.DB.prepare(`SELECT s.id, s.archetype_id, s.name, s.sort_order FROM instrument_specifics s JOIN instrument_archetypes a ON s.archetype_id = a.id WHERE a.section_id IN (${placeholders}) ORDER BY s.sort_order`).bind(...sectionIds).all(),
  ]);

  const archetypes = archRes.results || [];
  const specifics = specRes.results || [];

  // Build tree
  const specByArch = {};
  for (const s of specifics) {
    if (!specByArch[s.archetype_id]) specByArch[s.archetype_id] = [];
    specByArch[s.archetype_id].push({ id: s.id, name: s.name, sortOrder: s.sort_order });
  }

  const archBySection = {};
  for (const a of archetypes) {
    if (!archBySection[a.section_id]) archBySection[a.section_id] = [];
    archBySection[a.section_id].push({
      id: a.id, name: a.name, iconKey: a.icon_key, sortOrder: a.sort_order,
      instruments: specByArch[a.id] || [],
    });
  }

  const tree = sections.map(s => ({
    id: s.id, name: s.name, isCustom: !!s.orchestra_id, sortOrder: s.sort_order,
    archetypes: archBySection[s.id] || [],
  }));

  return json({ sections: tree });
}

// ─── Orchestra active switching ─────────────────────────

export async function switchActiveOrchestra(env, currentUser, orchestraId) {
  // Verify membership (or owner/admin)
  if (!['owner', 'admin'].includes(currentUser.role)) {
    const membership = await env.DB.prepare(
      'SELECT 1 FROM orchestra_members WHERE orchestra_id = ? AND user_id = ?'
    ).bind(orchestraId, currentUser.userId).first();
    if (!membership) return json({ error: 'Not a member of this orchestra' }, 403);
  }

  await env.DB.prepare(
    'UPDATE users SET active_orchestra_id = ?, updated_at = ? WHERE id = ?'
  ).bind(orchestraId, new Date().toISOString(), currentUser.userId).run();

  return json({ ok: true, activeOrchestraId: orchestraId });
}

// ─── Migration ──────────────────────────────────────────

export async function getMigrationState(env) {
  const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM migration_state').all();
  const state = {};
  (results || []).forEach(r => { state[r.key] = r.value; });
  return json({ state });
}

export async function setMigrationState(request, env) {
  const body = await _parseBody(request);
  if (!body || !body.key || body.value === undefined) {
    return json({ error: 'key and value required' }, 400);
  }
  await env.DB.prepare(`
    INSERT INTO migration_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(body.key, String(body.value)).run();
  return json({ ok: true });
}

// ─── Backfill helper ────────────────────────────────────

export async function backfillOrchestra(env, orchestraId) {
  // Assign all unscoped data to the given orchestra
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE songs SET orchestra_id = ? WHERE orchestra_id IS NULL').bind(orchestraId),
    env.DB.prepare('UPDATE setlists SET orchestra_id = ? WHERE orchestra_id IS NULL').bind(orchestraId),
    env.DB.prepare('UPDATE practice_lists SET orchestra_id = ? WHERE orchestra_id IS NULL').bind(orchestraId),
    env.DB.prepare('UPDATE wiki_charts SET orchestra_id = ? WHERE orchestra_id IS NULL').bind(orchestraId),
    env.DB.prepare('UPDATE files SET orchestra_id = ? WHERE orchestra_id IS NULL').bind(orchestraId),
    // Set all users' active_orchestra_id if not set
    env.DB.prepare('UPDATE users SET active_orchestra_id = ?, updated_at = ? WHERE active_orchestra_id IS NULL').bind(orchestraId, now),
  ]);
  return json({ ok: true, orchestraId });
}

// ─── Helpers ────────────────────────────────────────────

async function _checkVersionConflicts(env, table, items) {
  const ALLOWED_TABLES = new Set(['songs', 'setlists', 'practice_lists', 'wiki_charts']);
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table: ${table}`);

  const itemsWithVersion = items.filter(i => i.id && i.version != null);
  if (itemsWithVersion.length === 0) return null;

  const ids = itemsWithVersion.map(i => i.id);
  const dbVersions = {};
  for (let i = 0; i < ids.length; i += 900) {
    const chunk = ids.slice(i, i + 900);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, version FROM ${table} WHERE id IN (${placeholders})`
    ).bind(...chunk).all();
    (results || []).forEach(r => { dbVersions[r.id] = r.version; });
  }

  const conflicts = [];
  for (const item of itemsWithVersion) {
    const dbVer = dbVersions[item.id];
    if (dbVer != null && dbVer !== item.version) {
      conflicts.push({ id: item.id, clientVersion: item.version, serverVersion: dbVer });
    }
  }

  if (conflicts.length > 0) {
    return json({ error: 'Version conflict', conflicts }, 409);
  }
  return null;
}

async function _parseBody(request) {
  try { return await request.json(); } catch (_) { return null; }
}

function _generateId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _getExtension(filename) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.substring(dot) : '';
}

function _safeFilename(name) {
  if (!name) return 'download';
  return String(name).replace(/["\r\n\\]/g, '_').substring(0, 200);
}

function _rowToSong(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    key: row.key,
    bpm: row.bpm,
    timeSig: row.time_sig,
    duration: row.duration,
    tags: _parseJson(row.tags, []),
    notes: row.notes,
    assets: _parseJson(row.assets, {}),
    chartOrder: _parseJson(row.chart_order, []),
    difficulty: row.difficulty || null,
    orchestraId: row.orchestra_id || null,
    version: row.version || 1,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function _rowToSetlist(row) {
  return {
    id: row.id,
    venue: row.venue,
    gigDate: row.gig_date,
    overrideTitle: row.override_title,
    songs: _parseJson(row.songs, []),
    notes: row.notes,
    archived: !!row.archived,
    orchestraId: row.orchestra_id || null,
    version: row.version || 1,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function _rowToPractice(row) {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    songs: _parseJson(row.songs, []),
    archived: !!row.archived,
    orchestraId: row.orchestra_id || null,
    version: row.version || 1,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function _rowToWikiChart(row) {
  return {
    id: row.id,
    title: row.title,
    key: row.key,
    bpm: row.bpm,
    timeSig: row.time_sig,
    feel: row.feel,
    sections: _parseJson(row.sections, []),
    structureTag: row.structure_tag,
    notes: row.notes,
    versions: _parseJson(row.versions, []),
    createdBy: row.created_by,
    orchestraId: row.orchestra_id || null,
    version: row.version || 1,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function _rowToOrchestra(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    genres: _parseJson(row.genres, []),
    conductrId: row.conductr_id,
    maxMembers: row.max_members,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _parseJson(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}
