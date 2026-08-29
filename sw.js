// Service worker for Sonnier OS — enables installed-PWA push notifications.
// Bump this on deploy if you ever add asset caching; for now it only handles push.
const SW_VERSION = 'v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Sonnier OS';
  const body = data.body || 'Check your missions for today.';
  const url = data.url || './index.html';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: 'sonnier-os-reminder',
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
