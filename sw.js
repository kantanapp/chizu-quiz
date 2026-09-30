/* オフラインでも遊べるようにアプリ本体をキャッシュする。
   ファイルを更新したら CACHE のバージョン番号を上げること。 */
var CACHE = 'chizu-quiz-v14';

var ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/map.js',
  'js/kanji.js',
  'js/quiz.js',
  'js/app.js',
  'data/countries.js',
  'data/geo.js',
  'data/prefectures.js',
  'data/japan-geo.js',
  'data/kanji.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* かならずサーバーから取り直す（cache: 'reload'）。ブラウザが持っている
         古いファイルをそのまま保存すると、新しい HTML と古い JavaScript が
         混ざったままオフライン用に焼き付いてしまう。
         1つでも取れなければインストールを失敗させ、前のものを使わせる。 */
      return Promise.all(ASSETS.map(function (url) {
        return fetch(url, { cache: 'reload' }).then(function (res) {
          if (!res || !res.ok) throw new Error('取得できなかった: ' + url);
          return c.put(url, res);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  /* 国旗画像（絵文字が使えない環境のみ利用）は取得できたらキャッシュする */
  if (req.url.indexOf('flagcdn.com') >= 0) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () { return hit; });
      })
    );
    return;
  }

  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('index.html');
      });
    })
  );
});
