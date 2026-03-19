/**
 * gig-packets.js — Gig packet sharing endpoints
 *
 * Architecture:
 *   - Packet metadata stored in D1 (shared_packets table)
 *   - Individual files served from R2 (migrated) or Google Drive (legacy)
 *   - Zip bundle stored in R2 (built at share time)
 *   - Downloads proxied through Worker for PIN gating
 *
 * Routes (wired in index.js):
 *   POST   /gig/share              — Create/replace shared packet (auth required)
 *   DELETE /gig/share/:setlistId   — Unshare a packet (auth required)
 *   GET    /gig/shared             — List active shared packets (auth required)
 *   GET    /gig/:token             — Serve public gig packet page (no auth)
 *   POST   /gig/:token/verify-pin  — Verify PIN for downloads (no auth)
 *   GET    /gig/:token/file/:idx   — Download a file via Drive proxy (PIN required)
 *   GET    /gig/:token/zip         — Download the pre-built zip from R2 (PIN required)
 */

// ─── Helpers ─────────────────────────────────────────────

function generateToken(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generatePin() {
  const arr = new Uint8Array(2);
  crypto.getRandomValues(arr);
  return (((arr[0] << 8) | arr[1]) % 10000).toString().padStart(4, '0');
}

async function _hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _formatDate(dateStr) {
  if (!dateStr || dateStr === 'TBD') return dateStr || '';
  try {
    const dt = new Date(dateStr + 'T00:00:00');
    if (isNaN(dt.getTime())) return dateStr;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return dateStr; }
}

function _esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _safeUrl(url) {
  if (!url) return '#';
  const trimmed = String(url).trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return url;
  return '#'; // Block javascript:, data:, vbscript:, etc.
}

function _safeFilename(name) {
  if (!name) return 'download';
  return String(name).replace(/["\r\n\\]/g, '_').substring(0, 200);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// ─── PIN Session ─────────────────────────────────────────

async function _checkPinSession(request, env, token) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/gig_session=([^;]+)/);
  if (!match) return false;

  const raw = match[1];
  const lastDot = raw.lastIndexOf('.');
  if (lastDot < 0) return false;

  const value = raw.substring(0, lastDot);
  const sig = raw.substring(lastDot + 1);
  const secret = env.ENCRYPTION_KEY_SEED;
  if (!secret) return false; // Fail closed if secret not configured

  const expected = await _hmacSign(value, secret);
  if (expected !== sig) return false;
  if (!value.startsWith(token + ':')) return false;

  const ts = parseInt(value.split(':')[1], 10);
  if (Date.now() - ts > 86400000) return false; // 24h expiry

  return true;
}

// ─── File Fetch (R2 first, Drive fallback) ───────────────

async function _fetchFile(env, entry) {
  // Prefer R2 if file has been migrated
  if (entry.r2FileId) {
    const file = await env.DB.prepare('SELECT r2_key, mime_type FROM files WHERE id = ?').bind(entry.r2FileId).first();
    if (file) {
      const obj = await env.PACKETS.get(file.r2_key);
      if (obj) return new Response(obj.body, { headers: { 'Content-Type': file.mime_type || entry.contentType } });
    }
    // R2 entry missing — fall through to Drive if driveFileId exists
  }

  // Legacy: fetch from Google Drive
  if (entry.driveFileId) {
    return _fetchFromDrive(env, entry.driveFileId);
  }

  throw new Error('No file source available');
}

async function _fetchFromDrive(env, driveFileId) {
  const apiKey = env.DRIVE_API_KEY;
  if (!apiKey) throw new Error('DRIVE_API_KEY not configured');

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Drive fetch failed: ${resp.status}`);
  return resp;
}

// ─── R2 Cleanup ──────────────────────────────────────────

async function _cleanupR2(env, packet) {
  try {
    const zipKey = typeof packet === 'string' ? packet : packet.zip_r2_key;
    if (zipKey) await env.PACKETS.delete(zipKey);
  } catch (e) {
    console.error('R2 cleanup error:', e);
  }
}

// ─── ZIP Builder ─────────────────────────────────────────

// CRC-32 table
const _crc32Table = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function _crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = _crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function _buildZip(fileEntries) {
  // fileEntries: [{ name, data (Uint8Array) }]
  const encoder = new TextEncoder();
  const parts = [];
  const centralDir = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  for (const file of fileEntries) {
    const nameBytes = encoder.encode(file.name);
    const crc = _crc32(file.data);

    // Local file header
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // store method
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);

    // Central directory entry
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    parts.push(lh, file.data);
    centralDir.push(cd);
    offset += lh.length + file.data.length;
  }

  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, fileEntries.length, true);
  ev.setUint16(10, fileEntries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { zip.set(p, pos); pos += p.length; }
  for (const cd of centralDir) { zip.set(cd, pos); pos += cd.length; }
  zip.set(eocd, pos);

  return zip;
}

// ─── Route Handlers ──────────────────────────────────────

/**
 * POST /gig/share
 * Body: {
 *   setlistId, title, venue, gigDate,
 *   songs: [{ title, comment, songNotes, links }],
 *   files: [{ filename, driveFileId, type, songTitle, contentType }]
 * }
 */
export async function handleShare(request, env, currentUser) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'Invalid request body' }, 400); }
  const { setlistId, title, venue, gigDate, songs, files, setlistNotes } = body;

  if (!setlistId || !title || !songs || !Array.isArray(songs)) {
    return json({ error: 'setlistId, title, and songs are required' }, 400);
  }

  // Kill any existing share for this setlist (cleanup old R2 zip first)
  const existing = await env.DB.prepare(
    'SELECT zip_r2_key FROM shared_packets WHERE setlist_id = ?'
  ).bind(setlistId).first();
  if (existing) {
    await _cleanupR2(env, existing);
    await env.DB.prepare('DELETE FROM shared_packets WHERE setlist_id = ?').bind(setlistId).run();
  }
  // Note: UNIQUE(setlist_id) constraint on INSERT below guards against race conditions.
  // If two concurrent shares slip past the DELETE above, one INSERT will fail.

  const token = generateToken();
  const pin = generatePin();

  // Build manifest (pointers to R2 and/or Drive)
  const manifest = (files || []).map((f, i) => ({
    idx: i,
    filename: f.filename || `file-${i}`,
    driveFileId: f.driveFileId || null,
    r2FileId: f.r2FileId || null,
    type: f.type || 'pdf',       // 'pdf' | 'audio'
    songTitle: f.songTitle || '',
    contentType: f.contentType || 'application/octet-stream',
  }));

  // Build zip at share time (fetch all files from Drive, zip, store in R2)
  let zipR2Key = null;
  const dateStr = _formatDate(gigDate);
  const displayName = title || venue || 'Setlist';
  const zipFilename = `${displayName}${dateStr ? ` (${dateStr})` : ''} - Catman Setlist.zip`;

  if (manifest.length > 0) {
    try {
      const zipEntries = [];
      for (const entry of manifest) {
        if (!entry.driveFileId && !entry.r2FileId) continue;
        try {
          const resp = await _fetchFile(env, entry);
          const data = new Uint8Array(await resp.arrayBuffer());
          zipEntries.push({ name: entry.filename, data });
        } catch (e) {
          console.error(`Failed to fetch ${entry.filename}:`, e);
          // Skip failed files — don't block the whole share
        }
      }

      if (zipEntries.length > 0) {
        const zipData = await _buildZip(zipEntries);
        zipR2Key = `packets/${token}/bundle.zip`;
        await env.PACKETS.put(zipR2Key, zipData, {
          httpMetadata: { contentType: 'application/zip' },
        });
      }
    } catch (e) {
      console.error('Zip build failed:', e);
    }
  }

  // Store packet in D1
  const setlistJson = JSON.stringify({ songs, title, venue, gigDate, setlistNotes: setlistNotes || '' });
  try {
    await env.DB.prepare(`
      INSERT INTO shared_packets (token, pin, setlist_id, title, venue, gig_date, setlist_json, file_manifest, zip_r2_key, zip_filename, shared_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      token, pin, setlistId, title, venue || '', gigDate || '',
      setlistJson, JSON.stringify(manifest), zipR2Key, zipFilename,
      currentUser.userId
    ).run();
  } catch (e) {
    // UNIQUE constraint race: another concurrent share won — clean up our zip and retry
    if (zipR2Key) await _cleanupR2(env, { zip_r2_key: zipR2Key });
    return json({ error: 'Setlist was just shared by someone else — try again' }, 409);
  }

  return json({ ok: true, token, pin, url: `/gig/${token}` });
}

/**
 * DELETE /gig/share/:setlistId
 */
export async function handleUnshare(env, setlistId) {
  const existing = await env.DB.prepare(
    'SELECT zip_r2_key FROM shared_packets WHERE setlist_id = ?'
  ).bind(setlistId).first();
  if (!existing) return json({ error: 'No active share for this setlist' }, 404);

  await _cleanupR2(env, existing);
  await env.DB.prepare('DELETE FROM shared_packets WHERE setlist_id = ?').bind(setlistId).run();
  return json({ ok: true });
}

/**
 * Bulk unshare by setlist IDs (called when archiving)
 */
export async function unshareBySetlistIds(env, setlistIds) {
  for (const id of setlistIds) {
    const existing = await env.DB.prepare(
      'SELECT zip_r2_key FROM shared_packets WHERE setlist_id = ?'
    ).bind(id).first();
    if (existing) {
      await _cleanupR2(env, existing);
      await env.DB.prepare('DELETE FROM shared_packets WHERE setlist_id = ?').bind(id).run();
    }
  }
}

/**
 * GET /gig/shared — List active shared packets for dashboard
 */
export async function handleListShared(env) {
  const rows = await env.DB.prepare(
    'SELECT setlist_id, token, title, venue, gig_date, setlist_json, created_at FROM shared_packets ORDER BY created_at DESC'
  ).all();
  return json({ packets: rows.results || [] });
}

/**
 * GET /gig/:token — Serve the public gig packet HTML page
 */
export async function handleServePage(env, token) {
  const packet = await env.DB.prepare(
    'SELECT title, venue, gig_date, setlist_json, file_manifest, zip_filename, zip_r2_key FROM shared_packets WHERE token = ?'
  ).bind(token).first();

  if (!packet) {
    return new Response(_build404Page(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const setlistData = JSON.parse(packet.setlist_json);
  const manifest = JSON.parse(packet.file_manifest);
  const html = _buildPacketPage(token, packet, setlistData, manifest);

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * POST /gig/:token/verify-pin
 */
export async function handleVerifyPin(request, env, token) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'Invalid request' }, 400); }

  // Rate limit: 5 attempts per token per 15 minutes
  if (env.CATMAN_RATE) {
    const window = Math.floor(Date.now() / 900000); // 15-min windows
    const rateKey = `pin:${token}:${window}`;
    try {
      const attempts = parseInt(await env.CATMAN_RATE.get(rateKey) || '0', 10);
      if (attempts >= 5) return json({ error: 'Too many attempts — try again later' }, 429);
      await env.CATMAN_RATE.put(rateKey, String(attempts + 1), { expirationTtl: 900 });
    } catch (_) {} // rate limit failure is non-fatal
  }

  const packet = await env.DB.prepare('SELECT pin FROM shared_packets WHERE token = ?').bind(token).first();
  if (!packet) return json({ error: 'Invalid link' }, 404);
  if (body.pin !== packet.pin) return json({ error: 'Incorrect PIN' }, 403);

  const sessionValue = `${token}:${Date.now()}`;
  const secret = env.ENCRYPTION_KEY_SEED;
  if (!secret) return json({ error: 'Server misconfigured' }, 500);
  const sig = await _hmacSign(sessionValue, secret);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `gig_session=${sessionValue}.${sig}; Path=/gig/${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
    },
  });
}

/**
 * GET /gig/:token/file/:idx — Download single file (proxied from Drive)
 */
export async function handleFileDownload(request, env, token, fileIdx) {
  if (!await _checkPinSession(request, env, token)) {
    return json({ error: 'PIN required' }, 401);
  }

  const packet = await env.DB.prepare('SELECT file_manifest FROM shared_packets WHERE token = ?').bind(token).first();
  if (!packet) return json({ error: 'Invalid link' }, 404);

  const manifest = JSON.parse(packet.file_manifest);
  const idx = parseInt(fileIdx, 10);
  if (isNaN(idx) || idx < 0 || idx >= manifest.length) return json({ error: 'File not found' }, 404);

  const entry = manifest[idx];

  try {
    const fileResp = await _fetchFile(env, entry);
    return new Response(fileResp.body, {
      headers: {
        'Content-Type': entry.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${_safeFilename(entry.filename)}"`,
      },
    });
  } catch (e) {
    return json({ error: 'File download failed' }, 502);
  }
}

/**
 * GET /gig/:token/zip — Download pre-built zip from R2
 */
export async function handleZipDownload(request, env, token) {
  if (!await _checkPinSession(request, env, token)) {
    return json({ error: 'PIN required' }, 401);
  }

  const packet = await env.DB.prepare(
    'SELECT zip_r2_key, zip_filename FROM shared_packets WHERE token = ?'
  ).bind(token).first();
  if (!packet?.zip_r2_key) return json({ error: 'No zip available' }, 404);

  const obj = await env.PACKETS.get(packet.zip_r2_key);
  if (!obj) return json({ error: 'Zip not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${_safeFilename(packet.zip_filename || 'Catman Setlist.zip')}"`,
    },
  });
}

// ─── HTML Page Builders ──────────────────────────────────

function _build404Page() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link Expired - Catman Trio</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0e0e10;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
.msg{max-width:400px}h1{color:#d4b478;font-size:24px;margin-bottom:12px}p{color:#9ca3af;font-size:15px}</style>
</head><body><div class="msg"><h1>Link No Longer Active</h1><p>This shared setlist has been unshared or archived. Contact the person who sent it for an updated link.</p></div></body></html>`;
}

function _buildPacketPage(token, packet, setlistData, manifest) {
  const { songs, title, venue, gigDate, setlistNotes } = setlistData;
  const dateStr = _formatDate(gigDate);
  const displayTitle = title || venue || 'Setlist';
  const subtitle = venue && title !== venue ? venue : '';
  const hasFiles = manifest.length > 0;

  // Group files by song title for Region 2
  const filesBySong = {};
  manifest.forEach((f, i) => {
    const key = f.songTitle || '_other';
    if (!filesBySong[key]) filesBySong[key] = [];
    filesBySong[key].push({ ...f, idx: i });
  });

  // Region 1: Song list with notes
  let songListHtml = '';
  songs.forEach((song, i) => {
    const setNotes = (song.comment || '').trim();
    const songNotes = (song.songNotes || '').trim();
    songListHtml += `
      <div class="pkt-entry">
        <div class="pkt-num">${i + 1}</div>
        <div class="pkt-body">
          <div class="pkt-title">${_esc(song.title || song.name || 'Untitled')}</div>
          <div class="pkt-notes">
            <div class="pkt-note">${setNotes ? _esc(setNotes) : '<span class="pkt-dim">No setlist notes</span>'}</div>
            <div class="pkt-note">${songNotes ? _esc(songNotes) : '<span class="pkt-dim">No song notes</span>'}</div>
          </div>
        </div>
      </div>`;
  });

  // Region 2: Resources by song
  let resourcesHtml = '';
  songs.forEach((song, i) => {
    const songTitle = song.title || song.name || 'Untitled';
    const sf = filesBySong[songTitle] || [];
    const pdfs = sf.filter(f => f.type === 'pdf');
    const audio = sf.filter(f => f.type === 'audio');
    const links = song.links || [];
    const hasContent = pdfs.length > 0 || audio.length > 0 || links.length > 0;

    resourcesHtml += `
      <div class="pkt-entry">
        <div class="pkt-num">${i + 1}</div>
        <div class="pkt-body">
          <div class="pkt-title">${_esc(songTitle)}</div>`;

    if (pdfs.length > 0) {
      resourcesHtml += `<div class="pkt-fgroup"><div class="pkt-flabel">Charts</div>`;
      for (const p of pdfs) {
        resourcesHtml += `<a href="#" class="pkt-dl" onclick="dlFile(event,${p.idx},'${_esc(p.filename)}')">${_svgDoc()} ${_esc(p.filename)}</a>`;
      }
      resourcesHtml += `</div>`;
    }
    if (audio.length > 0) {
      resourcesHtml += `<div class="pkt-fgroup"><div class="pkt-flabel">Audio</div>`;
      for (const a of audio) {
        resourcesHtml += `<a href="#" class="pkt-dl" onclick="dlFile(event,${a.idx},'${_esc(a.filename)}')">${_svgPlay()} ${_esc(a.filename)}</a>`;
      }
      resourcesHtml += `</div>`;
    }
    if (links.length > 0) {
      resourcesHtml += `<div class="pkt-fgroup"><div class="pkt-flabel">Links</div>`;
      for (const lnk of links) {
        const url = typeof lnk === 'string' ? lnk : lnk.url;
        const label = (typeof lnk === 'object' && lnk.label) ? lnk.label : url;
        resourcesHtml += `<a href="${_esc(_safeUrl(url))}" target="_blank" rel="noopener" class="pkt-link">${_svgExternal()} ${_esc(label)}</a>`;
      }
      resourcesHtml += `</div>`;
    }
    if (!hasContent) {
      resourcesHtml += `<div class="pkt-dim" style="margin-top:4px">No resources</div>`;
    }

    resourcesHtml += `</div></div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${_esc(displayTitle)}${dateStr ? ` (${dateStr})` : ''} - Catman Trio</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0e0e10;color:#e4e4e7;line-height:1.6;min-height:100vh}
.pkt-hdr{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 20px;border-bottom:2px solid #d4b478;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.pkt-hdr h1{font-size:22px;font-weight:700;color:#d4b478}
.pkt-hdr .sub{font-size:14px;color:#9ca3af;margin-top:2px}
.pkt-hdr .date{font-size:13px;color:#6b7280;margin-top:2px}
.pkt-dlall{background:#d4b478;color:#0e0e10;border:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap}
.pkt-dlall:hover{background:#e5c98a}
.pkt-wrap{max-width:720px;margin:0 auto;padding:0 16px}
.pkt-sec{margin:28px 0}
.pkt-sec-title{font-size:16px;font-weight:700;color:#d4b478;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;border-bottom:1px solid #2a2a3e;margin-bottom:16px}
.pkt-entry{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.pkt-num{font-size:18px;font-weight:700;color:#d4b478;min-width:28px;text-align:right;padding-top:2px}
.pkt-title{font-size:17px;font-weight:600;color:#f4f4f5}
.pkt-notes{margin-top:6px}
.pkt-note{font-size:13px;font-style:italic;color:#a1a1aa;margin-bottom:3px}
.pkt-dim{font-size:13px;font-style:italic;color:#3f3f46}
.pkt-fgroup{margin-top:8px}
.pkt-flabel{font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;margin-bottom:4px;letter-spacing:.5px}
.pkt-dl{display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(212,180,120,.08);border:1px solid rgba(212,180,120,.15);border-radius:6px;color:#d4b478;text-decoration:none;font-size:13px;margin-bottom:4px;cursor:pointer}
.pkt-dl:hover{background:rgba(212,180,120,.15)}
.pkt-link{display:flex;align-items:center;gap:6px;padding:5px 10px;color:#93c5fd;text-decoration:none;font-size:13px;margin-bottom:4px;word-break:break-all}
.pkt-link:hover{text-decoration:underline}
.pkt-footer{text-align:center;padding:32px 16px;color:#52525b;font-size:12px;border-top:1px solid rgba(255,255,255,.06);margin-top:40px}
/* PIN modal */
.pin-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:1000;align-items:center;justify-content:center}
.pin-bg.on{display:flex}
.pin-box{background:#1a1a2e;border:1px solid #d4b478;border-radius:12px;padding:28px 24px;text-align:center;max-width:320px;width:90%}
.pin-box h3{color:#d4b478;margin-bottom:8px}
.pin-box p{color:#9ca3af;font-size:13px;margin-bottom:16px}
.pin-inp{font-size:28px;text-align:center;letter-spacing:12px;width:140px;padding:8px;background:#0e0e10;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;font-family:monospace}
.pin-inp:focus{outline:none;border-color:#d4b478}
.pin-btn{display:block;width:100%;margin-top:16px;padding:10px;background:#d4b478;color:#0e0e10;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer}
.pin-btn:hover{background:#e5c98a}
.pin-err{color:#ef4444;font-size:13px;margin-top:8px;display:none}
</style>
</head>
<body>
<div class="pkt-hdr">
  <div>
    <h1>${_esc(displayTitle)}</h1>
    ${subtitle ? `<div class="sub">${_esc(subtitle)}</div>` : ''}
    ${dateStr ? `<div class="date">${_esc(dateStr)}</div>` : ''}
  </div>
  ${hasFiles ? `<button class="pkt-dlall" onclick="dlAll()">${_svgDownload()} Download All</button>` : ''}
</div>
<div class="pkt-wrap">
  <div class="pkt-sec"><div class="pkt-sec-title">Setlist</div>${setlistNotes ? `<div style="font-size:14px;color:#a1a1aa;font-style:italic;margin-bottom:16px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:8px;border-left:3px solid #d4b478;">${_esc(setlistNotes)}</div>` : ''}${songListHtml}</div>
  <div class="pkt-sec"><div class="pkt-sec-title">Resources</div>${resourcesHtml}</div>
</div>
<div class="pkt-footer">Catman Trio &mdash; Shared Setlist</div>

<div class="pin-bg" id="pinModal">
  <div class="pin-box">
    <h3>Enter PIN</h3>
    <p>A 4-digit PIN was included in the email with this link.</p>
    <input type="text" class="pin-inp" id="pinInp" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off">
    <button class="pin-btn" onclick="submitPin()">Verify</button>
    <div class="pin-err" id="pinErr">Incorrect PIN</div>
  </div>
</div>

<script>
let authed=false,pending=null;const T='${token}';
function needPin(fn){if(authed){fn();return;}pending=fn;document.getElementById('pinModal').classList.add('on');const i=document.getElementById('pinInp');i.value='';i.focus();}
async function submitPin(){const p=document.getElementById('pinInp').value.trim();if(p.length!==4)return;try{const r=await fetch('/gig/'+T+'/verify-pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:p}),credentials:'same-origin'});const d=await r.json();if(d.ok){authed=true;document.getElementById('pinModal').classList.remove('on');document.getElementById('pinErr').style.display='none';if(pending){pending();pending=null;}}else{document.getElementById('pinErr').textContent=d.error||'Incorrect PIN';document.getElementById('pinErr').style.display='block';}}catch(e){document.getElementById('pinErr').textContent='Network error';document.getElementById('pinErr').style.display='block';}}
document.getElementById('pinInp').addEventListener('keydown',e=>{if(e.key==='Enter')submitPin();});
function dlFile(e,idx,name){e.preventDefault();needPin(()=>{const a=document.createElement('a');a.href='/gig/'+T+'/file/'+idx;a.download=name;document.body.appendChild(a);a.click();a.remove();});}
function dlAll(){needPin(()=>{const a=document.createElement('a');a.href='/gig/'+T+'/zip';a.download='';document.body.appendChild(a);a.click();a.remove();});}
</script>
</body>
</html>`;
}

// Mini SVG icons for the packet page
function _svgDownload() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'; }
function _svgDoc() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'; }
function _svgPlay() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>'; }
function _svgExternal() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'; }
