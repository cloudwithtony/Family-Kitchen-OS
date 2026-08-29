import { buildPushPayload } from '@block65/webcrypto-web-push';

// Mirrors the M[] mission list in index.html (id/icon/name must stay in sync).
const MISSIONS = [
  { id: 'sec', icon: '🛡️', name: 'Family Security' },
  { id: 'wlth', icon: '🏗️', name: 'Wealth Building' },
  { id: 'biz', icon: '⚡', name: 'Business' },
  { id: 'car', icon: '🎯', name: 'Career Growth' },
  { id: 'exp', icon: '🌱', name: 'Family Experiences' },
];

const JSON_HEADERS = { 'content-type': 'application/json' };

function withCors(resp, origin) {
  resp.headers.set('Access-Control-Allow-Origin', origin || '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'content-type, x-app-secret');
  return resp;
}

function json(body, status, origin) {
  return withCors(new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }), origin);
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function authorized(request, env) {
  return Boolean(env.APP_SECRET) && request.headers.get('x-app-secret') === env.APP_SECRET;
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      if (!authorized(request, env)) return json({ error: 'forbidden' }, 403, origin);
      const sub = await request.json().catch(() => null);
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return json({ error: 'invalid subscription' }, 400, origin);
      }
      const id = await sha256Hex(sub.endpoint);
      await env.PUSH_KV.put(`sub:${id}`, JSON.stringify(sub));
      return json({ ok: true }, 200, origin);
    }

    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      if (!authorized(request, env)) return json({ error: 'forbidden' }, 403, origin);
      const { endpoint } = await request.json().catch(() => ({}));
      if (endpoint) {
        const id = await sha256Hex(endpoint);
        await env.PUSH_KV.delete(`sub:${id}`);
      }
      return json({ ok: true }, 200, origin);
    }

    if (url.pathname === '/sync' && request.method === 'POST') {
      if (!authorized(request, env)) return json({ error: 'forbidden' }, 403, origin);
      const state = await request.json().catch(() => null);
      if (!state || !state.date || typeof state.missions !== 'object') {
        return json({ error: 'invalid state' }, 400, origin);
      }
      await env.PUSH_KV.put('state:today', JSON.stringify(state));
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'not found' }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};

async function buildReminderBody(env) {
  const raw = await env.PUSH_KV.get('state:today');
  const state = raw ? JSON.parse(raw) : null;

  if (!state || state.date !== todayKey()) {
    return "You haven't checked in yet today — tap to log your 5 missions.";
  }
  const remaining = MISSIONS.filter((m) => !state.missions?.[m.id]);
  if (remaining.length === 0) return null; // all done — skip the nag
  if (state.locked) return null; // day already locked in, nothing left to remind about
  return `${remaining.length} of 5 missions left today: ${remaining.map((m) => m.name).join(', ')}`;
}

async function sendReminders(env) {
  const body = await buildReminderBody(env);
  if (!body) return;

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const message = {
    data: JSON.stringify({ title: 'Sonnier OS', body, url: env.APP_URL }),
    options: { ttl: 3600 },
  };

  const list = await env.PUSH_KV.list({ prefix: 'sub:' });
  await Promise.all(
    list.keys.map(async (k) => {
      const subRaw = await env.PUSH_KV.get(k.name);
      if (!subRaw) return;
      const subscription = JSON.parse(subRaw);
      try {
        const payload = await buildPushPayload(message, subscription, vapid);
        const res = await fetch(subscription.endpoint, payload);
        if (res.status === 404 || res.status === 410) {
          await env.PUSH_KV.delete(k.name); // subscription expired/revoked
        }
      } catch (err) {
        console.error('push failed for', k.name, err);
      }
    })
  );
}
