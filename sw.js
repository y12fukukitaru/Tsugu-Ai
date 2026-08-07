// TsuguAi -継- Service Worker
// 役割はプッシュ通知の受信と表示のみ。fetchハンドラは持たない
// （キャッシュを一切せず、アプリの更新が常に即時反映されるようにするため）。

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || 'TsuguAi -継-', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'favicon-32.png',
    lang: 'ja',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
