/**
 * app-data.js — D1-backed CRUD for songs, setlists, practice
 *
 * Replaces GitHub data branch as the primary data store.
 * All endpoints require session auth. Write operations require admin/owner role.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Songs ──────────────────────────────────────────────

export async function listSongs(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, subtitle, key, bpm, time_sig, duration, tags, notes, assets, chart_order, updated_at, created_at FROM songs ORDER BY title COLLATE NOCASE'
  ).all();

  const songs = (results || []).map(_rowToSong);
  return json({ songs });
}

export async function saveSongs(request, env) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.songs)) {
    return json({ error: 'songs array required' }, 400);
  }

  const batch = [];
  const now = new Date().toISOString();

  for (const song of body.songs) {
    if (!song.id) continue;
    batch.push(
      env.DB.prepare(`
        INSERT INTO songs (id, title, subtitle, key, bpm, time_sig, duration, tags, notes, assets, chart_order, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        now,
        song.createdAt || now
      )
    );
  }

  // Handle deletions
  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      batch.push(env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(id));
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.songs.length });
}

// ─── Setlists ───────────────────────────────────────────

export async function listSetlists(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, venue, gig_date, override_title, songs, notes, archived, updated_at, created_at FROM setlists ORDER BY created_at DESC'
  ).all();

  const setlists = (results || []).map(_rowToSetlist);
  return json({ setlists });
}

export async function saveSetlists(request, env) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.setlists)) {
    return json({ error: 'setlists array required' }, 400);
  }

  const batch = [];
  const now = new Date().toISOString();

  for (const sl of body.setlists) {
    if (!sl.id) continue;
    batch.push(
      env.DB.prepare(`
        INSERT INTO setlists (id, venue, gig_date, override_title, songs, notes, archived, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          venue = excluded.venue,
          gig_date = excluded.gig_date,
          override_title = excluded.override_title,
          songs = excluded.songs,
          notes = excluded.notes,
          archived = excluded.archived,
          updated_at = excluded.updated_at
      `).bind(
        sl.id,
        sl.venue || '',
        sl.gigDate || '',
        sl.overrideTitle || '',
        JSON.stringify(sl.songs || []),
        sl.notes || '',
        sl.archived ? 1 : 0,
        now,
        sl.createdAt || now
      )
    );
  }

  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      batch.push(env.DB.prepare('DELETE FROM setlists WHERE id = ?').bind(id));
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.setlists.length });
}

// ─── Practice ───────────────────────────────────────────

export async function listPractice(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, created_by, songs, archived, updated_at, created_at FROM practice_lists ORDER BY created_at DESC'
  ).all();

  const lists = (results || []).map(_rowToPractice);
  return json({ practice: lists });
}

export async function savePractice(request, env) {
  const body = await _parseBody(request);
  if (!body || !Array.isArray(body.practice)) {
    return json({ error: 'practice array required' }, 400);
  }

  const batch = [];
  const now = new Date().toISOString();

  for (const p of body.practice) {
    if (!p.id) continue;
    batch.push(
      env.DB.prepare(`
        INSERT INTO practice_lists (id, name, created_by, songs, archived, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          created_by = excluded.created_by,
          songs = excluded.songs,
          archived = excluded.archived,
          updated_at = excluded.updated_at
      `).bind(
        p.id,
        p.name || '',
        p.createdBy || '',
        JSON.stringify(p.songs || []),
        p.archived ? 1 : 0,
        now,
        p.createdAt || now
      )
    );
  }

  if (Array.isArray(body.deletions)) {
    for (const id of body.deletions) {
      batch.push(env.DB.prepare('DELETE FROM practice_lists WHERE id = ?').bind(id));
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({ ok: true, count: body.practice.length });
}

// ─── Files (R2) ─────────────────────────────────────────

export async function uploadFile(request, env, currentUser) {
  // Expect multipart or raw binary with headers
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  const filename = request.headers.get('X-Filename') || 'upload';
  const songId = request.headers.get('X-Song-Id') || '';
  const fileType = request.headers.get('X-File-Type') || 'chart'; // 'chart' | 'audio'

  const data = await request.arrayBuffer();
  if (!data || data.byteLength === 0) {
    return json({ error: 'Empty file' }, 400);
  }
  if (data.byteLength > 50 * 1024 * 1024) {
    return json({ error: 'File too large (max 50MB)' }, 400);
  }

  // Generate file ID and R2 key
  const fileId = _generateId();
  const ext = _getExtension(filename);
  const r2Key = `files/${songId || '_unsorted'}/${fileId}${ext}`;

  // Upload to R2
  await env.PACKETS.put(r2Key, data, {
    httpMetadata: { contentType },
    customMetadata: { filename, songId, fileType, uploadedBy: currentUser.userId },
  });

  // Register in D1
  await env.DB.prepare(`
    INSERT INTO files (id, r2_key, filename, mime_type, size_bytes, song_id, file_type, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(fileId, r2Key, filename, contentType, data.byteLength, songId, fileType, currentUser.userId).run();

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

export async function deleteFile(env, fileId) {
  const file = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?').bind(fileId).first();
  if (!file) return json({ error: 'File not found' }, 404);

  await env.PACKETS.delete(file.r2_key);
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();

  return json({ ok: true });
}

export async function listFiles(env, songId) {
  let query, bind;
  if (songId) {
    query = 'SELECT id, filename, mime_type, size_bytes, file_type, uploaded_at FROM files WHERE song_id = ? ORDER BY uploaded_at';
    bind = [songId];
  } else {
    query = 'SELECT id, filename, mime_type, size_bytes, song_id, file_type, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT 500';
    bind = [];
  }

  const stmt = env.DB.prepare(query);
  const { results } = bind.length ? await stmt.bind(...bind).all() : await stmt.all();
  return json({ files: results || [] });
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

// ─── Helpers ────────────────────────────────────────────

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
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function _parseJson(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}
