/**
 * data/prefectures.js / data/japan-geo.js / data/kanji.js を生成する。
 *
 *   cd tools && npm install && node build-japan.mjs
 *
 * 出典:
 *   jpn-atlas (BSD-3-Clause)                  … 都道府県の境界（国土地理院 地球地図2016）
 *   @k1low/hanzi-writer-data-jp (APL / LGPL)  … 漢字の筆画データ
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const topo = require('jpn-atlas/japan/japan.json');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');
const KANJI_DIR = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '@k1low', 'hanzi-writer-data-jp');
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ *
 * 1. 47都道府県
 *    code … JIS の都道府県コード（jpn-atlas の id と一致する）
 *    name/suffix … 「新潟」+「県」。漢字を書く問題では name だけを書かせる。
 *    cap/capSuffix … 県庁所在地。「盛岡」+「市」。
 * ------------------------------------------------------------------ */
const PREFECTURES = [
  ['01', '北海道',  '',   'ほっかいどう',   '札幌',   '市', 'さっぽろ',     'hokkaido-tohoku'],
  ['02', '青森',    '県', 'あおもり',       '青森',   '市', 'あおもり',     'hokkaido-tohoku'],
  ['03', '岩手',    '県', 'いわて',         '盛岡',   '市', 'もりおか',     'hokkaido-tohoku'],
  ['04', '宮城',    '県', 'みやぎ',         '仙台',   '市', 'せんだい',     'hokkaido-tohoku'],
  ['05', '秋田',    '県', 'あきた',         '秋田',   '市', 'あきた',       'hokkaido-tohoku'],
  ['06', '山形',    '県', 'やまがた',       '山形',   '市', 'やまがた',     'hokkaido-tohoku'],
  ['07', '福島',    '県', 'ふくしま',       '福島',   '市', 'ふくしま',     'hokkaido-tohoku'],
  ['08', '茨城',    '県', 'いばらき',       '水戸',   '市', 'みと',         'kanto'],
  ['09', '栃木',    '県', 'とちぎ',         '宇都宮', '市', 'うつのみや',   'kanto'],
  ['10', '群馬',    '県', 'ぐんま',         '前橋',   '市', 'まえばし',     'kanto'],
  ['11', '埼玉',    '県', 'さいたま',       'さいたま', '市', 'さいたま',   'kanto'],
  ['12', '千葉',    '県', 'ちば',           '千葉',   '市', 'ちば',         'kanto'],
  ['13', '東京',    '都', 'とうきょう',     '東京',   '',   'とうきょう',   'kanto'],
  ['14', '神奈川',  '県', 'かながわ',       '横浜',   '市', 'よこはま',     'kanto'],
  ['15', '新潟',    '県', 'にいがた',       '新潟',   '市', 'にいがた',     'chubu'],
  ['16', '富山',    '県', 'とやま',         '富山',   '市', 'とやま',       'chubu'],
  ['17', '石川',    '県', 'いしかわ',       '金沢',   '市', 'かなざわ',     'chubu'],
  ['18', '福井',    '県', 'ふくい',         '福井',   '市', 'ふくい',       'chubu'],
  ['19', '山梨',    '県', 'やまなし',       '甲府',   '市', 'こうふ',       'chubu'],
  ['20', '長野',    '県', 'ながの',         '長野',   '市', 'ながの',       'chubu'],
  ['21', '岐阜',    '県', 'ぎふ',           '岐阜',   '市', 'ぎふ',         'chubu'],
  ['22', '静岡',    '県', 'しずおか',       '静岡',   '市', 'しずおか',     'chubu'],
  ['23', '愛知',    '県', 'あいち',         '名古屋', '市', 'なごや',       'chubu'],
  ['24', '三重',    '県', 'みえ',           '津',     '市', 'つ',           'kinki'],
  ['25', '滋賀',    '県', 'しが',           '大津',   '市', 'おおつ',       'kinki'],
  ['26', '京都',    '府', 'きょうと',       '京都',   '市', 'きょうと',     'kinki'],
  ['27', '大阪',    '府', 'おおさか',       '大阪',   '市', 'おおさか',     'kinki'],
  ['28', '兵庫',    '県', 'ひょうご',       '神戸',   '市', 'こうべ',       'kinki'],
  ['29', '奈良',    '県', 'なら',           '奈良',   '市', 'なら',         'kinki'],
  ['30', '和歌山',  '県', 'わかやま',       '和歌山', '市', 'わかやま',     'kinki'],
  ['31', '鳥取',    '県', 'とっとり',       '鳥取',   '市', 'とっとり',     'chugoku-shikoku'],
  ['32', '島根',    '県', 'しまね',         '松江',   '市', 'まつえ',       'chugoku-shikoku'],
  ['33', '岡山',    '県', 'おかやま',       '岡山',   '市', 'おかやま',     'chugoku-shikoku'],
  ['34', '広島',    '県', 'ひろしま',       '広島',   '市', 'ひろしま',     'chugoku-shikoku'],
  ['35', '山口',    '県', 'やまぐち',       '山口',   '市', 'やまぐち',     'chugoku-shikoku'],
  ['36', '徳島',    '県', 'とくしま',       '徳島',   '市', 'とくしま',     'chugoku-shikoku'],
  ['37', '香川',    '県', 'かがわ',         '高松',   '市', 'たかまつ',     'chugoku-shikoku'],
  ['38', '愛媛',    '県', 'えひめ',         '松山',   '市', 'まつやま',     'chugoku-shikoku'],
  ['39', '高知',    '県', 'こうち',         '高知',   '市', 'こうち',       'chugoku-shikoku'],
  ['40', '福岡',    '県', 'ふくおか',       '福岡',   '市', 'ふくおか',     'kyushu-okinawa'],
  ['41', '佐賀',    '県', 'さが',           '佐賀',   '市', 'さが',         'kyushu-okinawa'],
  ['42', '長崎',    '県', 'ながさき',       '長崎',   '市', 'ながさき',     'kyushu-okinawa'],
  ['43', '熊本',    '県', 'くまもと',       '熊本',   '市', 'くまもと',     'kyushu-okinawa'],
  ['44', '大分',    '県', 'おおいた',       '大分',   '市', 'おおいた',     'kyushu-okinawa'],
  ['45', '宮崎',    '県', 'みやざき',       '宮崎',   '市', 'みやざき',     'kyushu-okinawa'],
  ['46', '鹿児島',  '県', 'かごしま',       '鹿児島', '市', 'かごしま',     'kyushu-okinawa'],
  ['47', '沖縄',    '県', 'おきなわ',       '那覇',   '市', 'なは',         'kyushu-okinawa'],
];

/* ------------------------------------------------------------------ *
 * 2. 境界の縮小
 * ------------------------------------------------------------------ */
const PRECISION = 1;         // jpn-atlas の座標は 850 幅ほどの平面。0.1 で十分。
const TOLERANCE = 0.45;      // ダグラス・ポイカー法のしきい値
const MIN_RING_AREA = 4;     // これより小さい島は捨てる（座標系の面積）

const round = (n) => Math.round(n * 10 ** PRECISION) / 10 ** PRECISION;

/** 点と線分の距離の2乗 */
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** ダグラス・ポイカー法。形を保ったまま点を減らす。 */
function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0, index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > sq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/** GeoJSON の geometry → 外周リングの配列（穴は塗り分けに不要なので捨てる） */
function toPolygons(geom) {
  const raw = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const rings = raw
    .map((poly) => simplify(poly[0], TOLERANCE).map(([x, y]) => [round(x), round(y)]))
    .filter((r) => r.length >= 4)
    .map((r) => ({ ring: r, area: ringArea(r) }))
    .sort((a, b) => b.area - a.area);
  if (!rings.length) return [];
  return rings.filter((r, i) => i === 0 || r.area >= MIN_RING_AREA).map((r) => r.ring);
}

function bboxOf(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of polys) {
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

/* ------------------------------------------------------------------ *
 * 3. 組み立て
 * ------------------------------------------------------------------ */
const fc = feature(topo, topo.objects.prefectures);
const shapes = {};
for (const f of fc.features) {
  const polys = toPolygons(f.geometry);
  if (polys.length) shapes[f.id] = { p: polys, b: bboxOf(polys) };
}

/* 漢字を書く問題に使える字がそろっているか確かめる */
const hasChar = (c) => existsSync(join(KANJI_DIR, c + '.json'));
const needed = new Set();

const list = PREFECTURES.map(([code, name, suffix, yomi, cap, capSuffix, capYomi, region]) => {
  const canWrite = [...name].every(hasChar);
  const canWriteCap = [...cap].every(hasChar);
  if (canWrite) [...name].forEach((c) => needed.add(c));
  if (canWriteCap) [...cap].forEach((c) => needed.add(c));
  return {
    code, name, suffix, yomi, cap, capSuffix, capYomi, region,
    full: name + suffix,
    capFull: cap + capSuffix,
    /* 県名と県庁所在地が違うか（中学地理で問われるところ） */
    diff: name !== cap,
    write: canWrite ? 1 : 0,
    writeCap: canWriteCap ? 1 : 0,
    hasMap: shapes[code] ? 1 : 0,
  };
});

/* 必要な漢字の筆画データだけ集める */
const kanji = {};
for (const c of [...needed].sort()) {
  const d = JSON.parse(readFileSync(join(KANJI_DIR, c + '.json'), 'utf8'));
  /* 判定に使うのは medians（各画の中心線）、表示に使うのは strokes（輪郭） */
  kanji[c] = {
    s: d.strokes,
    m: d.medians.map((line) => line.map(([x, y]) => [Math.round(x), Math.round(y)])),
  };
}

/* ライセンス表示のため、筆画データのライセンス一式を同梱する */
cpSync(join(KANJI_DIR, 'licenses'), join(ROOT, 'data', 'kanji-licenses'), { recursive: true });
cpSync(join(KANJI_DIR, 'LICENSE'), join(ROOT, 'data', 'kanji-licenses', 'README.txt'));

/* ------------------------------------------------------------------ *
 * 4. 書き出し
 * ------------------------------------------------------------------ */
const banner = (src) =>
  `/* 自動生成ファイル — 直接編集しないでください。\n` +
  `   tools/build-japan.mjs で再生成できます。\n` +
  `   出典: ${src} */\n`;

writeFileSync(join(OUT, 'prefectures.js'),
  banner('都道府県名・県庁所在地は手入力（tools/build-japan.mjs 内の表）') +
  'window.PREFECTURES = ' + JSON.stringify(list) + ';\n');

writeFileSync(join(OUT, 'japan-geo.js'),
  banner('jpn-atlas（国土地理院 地球地図2016, BSD-3-Clause）') +
  'window.JAPAN_GEO = ' + JSON.stringify(shapes) + ';\n');

writeFileSync(join(OUT, 'kanji.js'),
  banner('@k1low/hanzi-writer-data-jp（Arphic Public License / LGPL-3.0 / Unicode）\n' +
         '   ライセンス全文は data/kanji-licenses/ にあります。') +
  'window.KANJI = ' + JSON.stringify(kanji) + ';\n');

const kb = (p) => (readFileSync(join(OUT, p)).length / 1024).toFixed(0) + 'KB';
const pts = Object.values(shapes).reduce((n, s) => n + s.p.reduce((m, r) => m + r.length, 0), 0);
console.log(`prefectures.js : ${list.length} 件 ` +
  `(県名を書ける ${list.filter((p) => p.write).length} / 所在地を書ける ${list.filter((p) => p.writeCap).length} / ` +
  `県名と所在地が違う ${list.filter((p) => p.diff).length}) ${kb('prefectures.js')}`);
console.log(`japan-geo.js   : ${Object.keys(shapes).length} 件, ${pts} 点 ${kb('japan-geo.js')}`);
console.log(`kanji.js       : ${Object.keys(kanji).length} 字 ${kb('kanji.js')}`);
