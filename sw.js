// TsuguAi -継- Service Worker
// 役割はプッシュ通知の受信と表示、アプリのアイコンのバッジのみ。fetchハンドラは持たない
// （ページを一切キャッシュせず、アプリの更新が常に即時反映されるようにするため）。
// Cache Storage の 'tsugu-badge' はバッジの数を1つ置いておくだけの場所で、ページは入れない。

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

//  アプリを閉じているあいだに通知が届いたら、アイコンのバッジを1つ足す。
//  元の数は、アプリを最後に開いたときの数（index.html の appBadgeSet が書く）。
//  次にアプリを開くと、アプリが正しい数に置き直す。
//  バッジに対応していない端末では何もしない。
function bumpBadge() {
  if (!self.navigator || !('setAppBadge' in self.navigator) || !self.caches) return Promise.resolve();
  return caches.open('tsugu-badge').then(function (c) {
    return c.match('badge-n').then(function (r) { return r ? r.text() : '0'; }).then(function (t) {
      var n = (parseInt(t, 10) || 0) + 1;
      return c.put('badge-n', new Response(String(n))).then(function () { return self.navigator.setAppBadge(n); });
    });
  }).catch(function () {});
}

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  var opt = {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'favicon-32.png',
    lang: 'ja',
    data: { url: d.url || './' }
  };
  //  予定・TODO の通知には tag が付いてくる。同じ予定の通知は1枚に重ね、
  //  重ねたときも鳴らす（時刻を変えて届き直したものを見落とさないため）
  if (d.tag) { opt.tag = d.tag; opt.renotify = true; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'TsuguAi -継-', opt),
    bumpBadge()
  ]));
});

//  通知を押したら、予定タブ・TODOタブなど、その通知の中身の場所を開く。
//  アプリがもう開いていれば、そのアプリに知らせて継ナビくんのタブを開かせる
//  （開き直すと、書きかけの画面が消えてしまうため）。開いていなければ URL で開く。
//  URL の ?knv=cal ／ ?knv=todo は、アプリがログインのあとに読んで開く。
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  var m = /[?&]knv=([a-z]+)/.exec(url), tab = m ? m[1] : '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) {
        if (tab) { try { list[i].postMessage({ type: 'knv-open', tab: tab }); } catch (err) {} }
        return list[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
