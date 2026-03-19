# Web Push Notifications & Monitoring/Alerting Setup Guide

## Part 1: Web Push Notifications

### Overview
Web Push uses the Push API + Service Worker to send real-time notifications to users even when the app isn't open. Useful for: setlist changes, new songs added, gig packet shares, practice reminders.

### Prerequisites
1. **VAPID Keys** — Generate a key pair for push subscription authentication
2. **Cloudflare Worker** — Already deployed, just needs push endpoints
3. **D1 Table** — Store push subscriptions per user

---

### Step 1: Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

This outputs:
```
Public Key:  BN3tW...  (use in client JS)
Private Key: abc12...  (store as Cloudflare secret)
```

Store the private key:
```bash
cd cloudflare-worker
npx wrangler secret put VAPID_PRIVATE_KEY
# paste the private key

npx wrangler secret put VAPID_PUBLIC_KEY
# paste the public key
```

Also add to `wrangler.toml` as a var (public key only):
```toml
[vars]
VAPID_PUBLIC_KEY = "BN3tW..."
VAPID_SUBJECT = "mailto:your@email.com"
```

---

### Step 2: D1 Migration — Push Subscriptions Table

Create `cloudflare-worker/migrations/0008_push_subscriptions.sql`:
```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
```

Apply:
```bash
cd cloudflare-worker
npx wrangler d1 migrations apply catman-db --remote
```

---

### Step 3: Worker Endpoints

Add to `cloudflare-worker/src/index.js`:

```javascript
// POST /push/subscribe — Save a push subscription
if (path === '/push/subscribe' && method === 'POST') {
  const body = await request.json();
  const { endpoint, keys } = body.subscription;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, currentUser.userId, endpoint, keys.p256dh, keys.auth).run();
  return respond(json({ ok: true }));
}

// DELETE /push/unsubscribe — Remove push subscription
if (path === '/push/unsubscribe' && method === 'DELETE') {
  const body = await request.json();
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .bind(body.endpoint).run();
  return respond(json({ ok: true }));
}
```

For sending notifications (internal helper):
```javascript
// In a separate push-sender.js module
async function sendPushToUser(env, userId, payload) {
  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
  ).bind(userId).all();

  for (const sub of results || []) {
    try {
      // Use web-push library or manual VAPID signing
      // CF Workers: use the webpush npm package or manual fetch to push endpoint
      const pushPayload = JSON.stringify(payload);
      // ... VAPID signature + fetch to sub.endpoint
    } catch (e) {
      if (e.statusCode === 410) {
        // Subscription expired — clean up
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
          .bind(sub.endpoint).run();
      }
    }
  }
}
```

---

### Step 4: Client-Side Subscription (app.js or settings)

```javascript
async function subscribeToPush() {
  if (!('PushManager' in window)) { showToast('Push not supported'); return; }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  // Send subscription to Worker
  await _workerFetch('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  showToast('Notifications enabled');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
```

### Step 5: Service Worker Push Handler

In `service-worker.js`:
```javascript
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Catman Trio', {
      body: data.body || '',
      icon: '/img/icon-192.png',
      badge: '/img/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
```

### Step 6: Settings UI Toggle

Add a "Push Notifications" toggle in the Settings page (renderSettings in app.js):
```html
<div class="settings-row">
  <div class="settings-row-label">
    <div class="settings-label">Push Notifications</div>
    <div class="settings-hint">Get notified when songs or setlists change</div>
  </div>
  <label class="toggle">
    <input type="checkbox" id="pref-push-notifications">
    <span class="toggle-slider"></span>
  </label>
</div>
```

Wire it to `subscribeToPush()` on enable, and unsubscribe + DELETE endpoint on disable.

---

### Notification Triggers

Good candidates for push notifications:
- New song added by another user
- Setlist updated/shared
- New gig packet created
- Practice list assigned to you

Trigger them in the save endpoints (saveSongs, saveSetlists, etc.) by calling `sendPushToUser()` for all other logged-in users.

---

## Part 2: Monitoring & Alerting

### Overview
Monitor the Cloudflare Worker for errors, latency, and resource exhaustion. Alert when things go wrong.

---

### Option A: Cloudflare Analytics (Free, Built-in)

Cloudflare Workers have built-in analytics at:
`https://dash.cloudflare.com > Workers & Pages > catman-api > Analytics`

Shows: request count, error rate, CPU time, duration percentiles.

**Limitations**: No custom alerts, 24h retention on free plan, no per-endpoint breakdown.

---

### Option B: Worker Error Logging to D1 (Already Implemented)

The `error_log` table in D1 already captures errors:
```sql
-- Already exists from migration 0004
SELECT * FROM error_log ORDER BY created_at DESC LIMIT 50;
```

**Add a dashboard endpoint** for monitoring:
```javascript
// GET /admin/errors — Recent errors (owner only)
if (path === '/admin/errors' && method === 'GET') {
  if (currentUser.role !== 'owner') return respond(json({ error: 'Owner only' }, 403));
  const { results } = await env.DB.prepare(
    'SELECT * FROM error_log ORDER BY created_at DESC LIMIT 100'
  ).all();
  return respond(json({ errors: results }));
}

// GET /admin/stats — Basic operational stats (owner only)
if (path === '/admin/stats' && method === 'GET') {
  if (currentUser.role !== 'owner') return respond(json({ error: 'Owner only' }, 403));
  const [users, songs, setlists, errors24h] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM songs').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM setlists').first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM error_log WHERE created_at > datetime('now', '-1 day')").first(),
  ]);
  return respond(json({
    users: users?.count || 0,
    songs: songs?.count || 0,
    setlists: setlists?.count || 0,
    errors24h: errors24h?.count || 0,
  }));
}
```

---

### Option C: External Uptime Monitoring (Recommended)

Use a free uptime monitor to ping the health endpoint:

**UptimeRobot (free, 5-min intervals)**:
1. Sign up at https://uptimerobot.com
2. Add HTTP(s) monitor: `https://catman-api.catmandabomb.workers.dev/health`
3. Expected status: 200
4. Alert contacts: your email/SMS

**Better Stack (free tier, 30s intervals)**:
1. Sign up at https://betterstack.com
2. Add heartbeat monitor for the Worker URL
3. Set up Slack/email alerts

**Cronitor (free tier)**:
1. https://cronitor.io — similar concept
2. Monitors URL availability + response time

---

### Option D: Custom Alerting via Cron Trigger

Add a Cron Trigger to the Worker that checks error rates:

In `wrangler.toml`:
```toml
[triggers]
crons = ["*/15 * * * *"]  # Every 15 minutes
```

In `index.js`, add:
```javascript
export default {
  async fetch(request, env) { /* existing handler */ },

  async scheduled(event, env) {
    // Check error rate in last 15 minutes
    const { count } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM error_log WHERE created_at > datetime('now', '-15 minutes')"
    ).first();

    if (count > 10) {
      // Send alert via Resend email API (already configured)
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'alerts@catmanbeats.com',
          to: 'your@email.com',
          subject: `[Catman API] ${count} errors in last 15min`,
          text: `The Catman API Worker logged ${count} errors in the last 15 minutes. Check the error_log table.`,
        }),
      });
    }
  },
};
```

---

### Recommended Monitoring Stack (Minimal Setup)

1. **UptimeRobot** — Free, monitors /health every 5 min, emails on downtime
2. **D1 error_log** — Already implemented, view in Dashboard
3. **Cron trigger** — 15-min error rate check, email via Resend on spikes
4. **Cloudflare Analytics** — Built-in, check manually for trends

This gives full coverage with zero ongoing cost.

---

### Dashboard Integration

Add a "System Health" card to the admin Dashboard (js/dashboard.js) that calls `/admin/stats` and shows:
- Total users / songs / setlists
- Errors in last 24h (with color: green < 5, yellow < 20, red >= 20)
- Last sync timestamp

This requires adding the `/admin/stats` and `/admin/errors` endpoints to the Worker (code above) and a Dashboard UI card.
