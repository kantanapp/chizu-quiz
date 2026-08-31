/**
 * data/countries.js と data/geo.js を生成する。
 *
 *   cd chizu-quiz/tools && npm install && node build-data.mjs
 *
 * 出典:
 *   world-countries (ODbL)  … 国名（日本語/英語）・地域・ISOコード
 *   world-atlas (Natural Earth, public domain) … 国境ポリゴン 1:110m
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const countries = require('world-countries');
const topo = require('world-atlas/countries-110m.json');

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ *
 * 1. 名前の上書き（学校の教科書に合わせる）
 * ------------------------------------------------------------------ */
const JA_OVERRIDE = {
  US: 'アメリカ合衆国', AE: 'アラブ首長国連邦', GB: 'イギリス',
  KR: '韓国', KP: '北朝鮮',
  CD: 'コンゴ民主共和国', CG: 'コンゴ共和国', VA: 'バチカン市国',
  MK: '北マケドニア', CZ: 'チェコ', LA: 'ラオス', BN: 'ブルネイ',
  TL: '東ティモール', SZ: 'エスワティニ', CI: 'コートジボワール',
  ST: 'サントメ・プリンシペ', VC: 'セントビンセント及びグレナディーン諸島',
};

const EN_OVERRIDE = {
  US: 'United States', GB: 'United Kingdom', KR: 'South Korea',
  KP: 'North Korea', TR: 'Turkey', CZ: 'Czech Republic',
  CD: 'Democratic Republic of the Congo', CG: 'Republic of the Congo',
  CI: "Côte d'Ivoire", CV: 'Cabo Verde', SZ: 'Eswatini',
  TL: 'Timor-Leste', MM: 'Myanmar', NL: 'Netherlands', VA: 'Vatican City',
};

/* ------------------------------------------------------------------ *
 * 2. 難易度（出題範囲）
 *    LEVEL1 … 中学地理で必ず出てくる国
 *    LEVEL2 … LEVEL1 ＋ 教科書・地図帳によく出る国
 *    LEVEL3 … 国連加盟 194 か国すべて
 * ------------------------------------------------------------------ */
const LEVEL1 = `
JP CN KR KP MN IN PK BD NP TH VN ID PH MY SG SA AE IR IQ TR IL
GB FR DE IT ES PT NL CH SE NO FI GR PL RU UA AT BE DK IE
EG ZA NG KE ET MA DZ GH TZ SD
US CA MX CU JM GT CR PA
BR AR CL PE CO VE EC BO
AU NZ PG FJ
`.trim().split(/\s+/);

const LEVEL2_EXTRA = `
LK MM KH LA KZ UZ JO LB SY YE OM QA KW AF AZ GE AM BT MV BN TM KG TJ
CZ HU RO BG RS HR IS SK SI LT LV EE BY BA AL MD LU MT CY ME MK
CI CM CD CG SS MG TN LY ZW ZM UG SN AO MZ NA BW ML NE TD SO RW MW
PY UY HT DO HN NI SV TT BS BZ GY SR
SB VU WS TO
`.trim().split(/\s+/);

const level1 = new Set(LEVEL1);
const level2 = new Set([...LEVEL1, ...LEVEL2_EXTRA]);

/* ------------------------------------------------------------------ *
 * 3. 地域（大州）
 * ------------------------------------------------------------------ */
function regionOf(c) {
  if (c.region === 'Americas') {
    return c.subregion === 'South America' ? 'south-america' : 'north-america';
  }
  return { Asia: 'asia', Europe: 'europe', Africa: 'africa', Oceania: 'oceania' }[c.region] || null;
}

/* ------------------------------------------------------------------ *
 * 4. ジオメトリの縮小
 * ------------------------------------------------------------------ */
const PRECISION = 2;                  // 小数点以下 2 桁 ≒ 1km
const MIN_RING_AREA = 0.12;           // これより小さい島は捨てる（度^2）

const round = (n) => Math.round(n * 10 ** PRECISION) / 10 ** PRECISION;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/**
 * 経度 180 度線をまたぐ輪をほどく。
 * world-atlas の輪は 180 度線で切れておらず、そのまま描くと
 * 地図を横切る帯（ロシアやフィジー）になってしまうため、
 * 隣り合う点の差が 180 度を超えないよう ±360 して連続させる。
 * ほどいたあとは、輪の中心が -180〜180 に入るようにずらす。
 */
function unwrapRing(ring) {
  var out = [ring[0].slice()];
  var prev = ring[0][0];
  for (var i = 1; i < ring.length; i++) {
    var lon = ring[i][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[i][1]]);
    prev = lon;
  }
  var lo = Infinity, hi = -Infinity;
  for (var j = 0; j < out.length; j++) {
    if (out[j][0] < lo) lo = out[j][0];
    if (out[j][0] > hi) hi = out[j][0];
  }
  var k = Math.round((lo + hi) / 2 / 360);
  if (k) for (var m = 0; m < out.length; m++) out[m][0] -= k * 360;
  return out;
}

function simplifyRing(ring) {
  const out = [];
  for (const [lon, lat] of unwrapRing(ring)) {
    const p = [round(lon), round(lat)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;   // 閉じるのは SVG の Z にまかせる
}

/** GeoJSON の geometry → 外周リングの配列（穴は捨てる：塗り分けだけなので不要） */
function toPolygons(geom) {
  const raw = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const rings = raw
    .map((poly) => simplifyRing(poly[0]))
    .filter((r) => r.length >= 4)
    .map((r) => ({ ring: r, area: ringArea(r) }))
    .sort((a, b) => b.area - a.area);
  if (!rings.length) return [];
  return rings.filter((r, i) => i === 0 || r.area >= MIN_RING_AREA).map((r) => r.ring);
}

function bboxOf(polys) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
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
 * 5. 組み立て
 * ------------------------------------------------------------------ */
const fc = feature(topo, topo.objects.countries);
const geomByCcn3 = new Map();
for (const f of fc.features) {
  if (f.id == null) continue;
  const polys = toPolygons(f.geometry);
  if (polys.length) geomByCcn3.set(String(f.id), polys);
}

const list = [];
for (const c of countries) {
  if (!c.unMember) continue;
  const region = regionOf(c);
  if (!region) continue;
  const ja = JA_OVERRIDE[c.cca2] ?? c.translations.jpn?.common ?? c.name.common;
  const en = EN_OVERRIDE[c.cca2] ?? c.name.common;
  const level = level1.has(c.cca2) ? 1 : level2.has(c.cca2) ? 2 : 3;
  list.push({
    a2: c.cca2,
    n3: c.ccn3,
    ja,
    en,
    region,
    level,
    latlng: [round(c.latlng[1]), round(c.latlng[0])],   // [lon, lat]
    hasMap: geomByCcn3.has(c.ccn3),
  });
}
list.sort((a, b) => a.a2.localeCompare(b.a2));

/* 背景として描くだけの地形（南極・グリーンランドなど）も残す */
const quizIds = new Set(list.map((c) => c.n3));
const shapes = {};
for (const [n3, polys] of geomByCcn3) {
  shapes[n3] = { p: polys, b: bboxOf(polys), q: quizIds.has(n3) ? 1 : 0 };
}

/* ------------------------------------------------------------------ *
 * 6. 書き出し
 * ------------------------------------------------------------------ */
const banner = (src) =>
  `/* 自動生成ファイル — 直接編集しないでください。\n` +
  `   tools/build-data.mjs で再生成できます。\n` +
  `   出典: ${src} */\n`;

writeFileSync(
  join(OUT, 'countries.js'),
  banner('world-countries (ODbL)') + 'window.COUNTRIES = ' + JSON.stringify(list) + ';\n'
);
writeFileSync(
  join(OUT, 'geo.js'),
  banner('Natural Earth 1:110m via world-atlas (public domain)') +
    'window.GEO = ' + JSON.stringify(shapes) + ';\n'
);

const byLevel = (n) => list.filter((c) => c.level <= n).length;
console.log(`countries.js : ${list.length} か国 ` +
  `(やさしい ${byLevel(1)} / ふつう ${byLevel(2)} / すべて ${byLevel(3)}), ` +
  `地図あり ${list.filter((c) => c.hasMap).length}`);
console.log(`geo.js       : ${Object.keys(shapes).length} 図形`);
