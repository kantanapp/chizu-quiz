/* 漢字の判定（js/kanji.js の judge）のものさしを測るための検証。
   手書きのブレを作り出して「正しく書いたのに落ちる率」と
   「ちがう字・でたらめな線を通してしまう率」を数える。

   指で書くと 2画をつなげたり 1画を2回に分けたりするので、それも作り出す。
   ここが、画を1本ずつ対応させる見かたでは通らなかったところ。

   使い方:
     node tools/check-kanji.mjs                 いまの js/kanji.js の設定で測る
     node tools/check-kanji.mjs 70 78 86        TOL の候補を並べて比べる
     COVER=0.75 EXCESS=0.35 node tools/check-kanji.mjs
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = {};
require('../data/kanji.js');
require('../data/prefectures.js');
require('../js/kanji.js');
const { KANJI, PREFECTURES, KanjiPad } = globalThis.window;

const LIM = KanjiPad._limits();
const COVER = Number(process.env.COVER ?? LIM.cover);
const STROKE = Number(process.env.STROKE ?? LIM.stroke);
const WEAK = Number(process.env.WEAK ?? LIM.weak);
const EXCESS = Number(process.env.EXCESS ?? LIM.excess);
const MARGIN = Number(process.env.MARGIN ?? LIM.margin);

/** js/kanji.js の合否。ものさしを環境変数で振れるように、ここでも判定し直す。 */
const passed = (j) => j.chars.every((c) =>
  !!c.rank && c.rank.mine <= c.rank.best * (1 + MARGIN) &&
  c.cover >= COVER &&
  c.excess <= EXCESS &&
  c.each.filter((f) => f < STROKE).length <= Math.floor(c.each.length * WEAK));

/* ---- 乱数（毎回おなじ結果になるようにする） ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/* ---- 手書きのブレを作る ---- */
const densify = (pts, step) => KanjiPad._densify(pts, step);

/**
 * ある画を「人が書いた線」にする。
 *  shape … 字の形そのもののズレ
 *  finger … 指のブレ（画面 px から座標に直したもの）
 *  端は行き過ぎ・届かずのどちらもある。
 */
function handwrite(median, r, o) {
  const pts = densify(median, 14);
  const n = pts.length;
  const ox = gauss(r) * o.shape, oy = gauss(r) * o.shape;
  const amp = Math.abs(gauss(r)) * o.shape * 0.8;
  const f1 = 1 + r() * 3, f2 = 1 + r() * 3, p1 = r() * 6.3, p2 = r() * 6.3;
  const cut0 = Math.min(Math.round(n * Math.abs(gauss(r)) * 0.04), n - 2);
  const cut1 = Math.max(n - 1 - Math.round(n * Math.abs(gauss(r)) * 0.04), 1);
  const out = [];
  for (let i = cut0; i <= cut1; i++) {
    const t = i / (n - 1);
    out.push([
      pts[i][0] + ox + amp * Math.sin(f1 * t * 6.3 + p1) + gauss(r) * o.finger,
      pts[i][1] + oy + amp * Math.sin(f2 * t * 6.3 + p2) + gauss(r) * o.finger
    ]);
  }
  return out.length >= 2 ? out : pts.slice();
}

/** 単語ぜんぶを書いたことにする。文字ごとに位置と大きさもずらし、画をつなげたり分けたりする。 */
function writeWord(chars, r, o) {
  const out = [];
  chars.forEach((ch, ci) => {
    const cx = ci * 1024 + 512, cy = 512;
    const s = 1 + gauss(r) * o.scale;
    const dx = gauss(r) * o.place, dy = gauss(r) * o.place;
    const put = (line) => line.map((p) => [cx + (p[0] - cx) * s + dx, cy + (p[1] - cy) * s + dy]);

    let pending = null;                     /* つなげ書きの途中の線 */
    const lines = KANJI[ch].m;
    lines.forEach((median, si) => {
      const screen = median.map((p) => [p[0] + ci * 1024, 900 - p[1]]);
      let line = handwrite(screen, r, o);

      if (r() < o.split && line.length >= 6) {       /* 1画を2回に分けて書く */
        const k = 2 + Math.floor(r() * (line.length - 4));
        out.push(put(line.slice(0, k + 1)));
        line = line.slice(k);
      }
      if (pending) { line = pending.concat(line); pending = null; }
      if (si < lines.length - 1 && r() < o.join) {   /* 次の画とつなげて書く */
        pending = line;
        return;
      }
      out.push(put(line));
    });
    if (pending) out.push(put(pending));
  });
  return out;
}

/** でたらめな線を、正解の画数と同じ本数だけ引く */
function scribble(nChars, nStrokes, r) {
  const out = [];
  for (let i = 0; i < nStrokes; i++) {
    const ci = Math.floor(r() * nChars);
    const a = [ci * 1024 + 100 + r() * 800, 100 + r() * 800];
    const b = [ci * 1024 + 100 + r() * 800, 100 + r() * 800];
    out.push(densify([a, b], 20).map((p) => [p[0] + gauss(r) * 8, p[1] + gauss(r) * 8]));
  }
  return out;
}

/* ---- 検証 ---- */
const names = [...new Set(PREFECTURES.filter((p) => p.write).map((p) => p.name))];
const byLen = { 2: names.filter((n) => n.length === 2), 3: names.filter((n) => n.length === 3) };

/* ブレの想定。finger は 1マスの画面サイズから座標に直す（横 355px に N マス） */
const LEVELS = [
  { tag: 'ていねい', shape: 26, fingerPx: 1.6, scale: 0.03, place: 22, join: 0.05, split: 0.03 },
  { tag: 'ふつう  ', shape: 42, fingerPx: 2.6, scale: 0.06, place: 36, join: 0.15, split: 0.08 },
  { tag: 'ざつ    ', shape: 60, fingerPx: 3.6, scale: 0.09, place: 52, join: 0.30, split: 0.15 }
];
const TRIALS = 8;

function run(tol, nChars, lv) {
  const r = mulberry32(12345 + nChars * 7 + Math.round(tol * 10));
  const list = byLen[nChars];
  const o = { ...lv, finger: lv.fingerPx * nChars * 1024 / 355 };
  let ok = 0, n = 0, sumCover = 0, sumExcess = 0, sumWeak = 0, top = 0, nc = 0;
  let falseOther = 0, falseScribble = 0, nFalse = 0;
  const share = (a, b) => a.split('').some((c) => b.indexOf(c) >= 0);

  for (let t = 0; t < TRIALS; t++) {
    for (const name of list) {
      const chars = name.split('');
      const j = KanjiPad._judge(writeWord(chars, r, o), chars, tol);
      n++; if (passed(j)) ok++;
      j.chars.forEach((c) => {
        sumCover += c.cover; sumExcess += c.excess;
        sumWeak += c.each.filter((f) => f < STROKE).length / c.each.length;
        if (c.rank && c.rank.mine <= c.rank.best * (1 + MARGIN)) top++;
        nc++;
      });

      /* 1文字を共有する県名（山口/山形 など）はいちばん間違えやすいので、必ず混ぜる */
      const others = list.filter((x) => x !== name);
      const hard = others.filter((x) => share(x, name));
      const pool = hard.length && t % 2 === 0 ? hard : others;
      const other = pool[Math.floor(r() * pool.length)];
      nFalse++;
      if (passed(KanjiPad._judge(writeWord(other.split(''), r, o), chars, tol))) falseOther++;
      const nStrokes = chars.reduce((a, c) => a + KANJI[c].m.length, 0);
      if (passed(KanjiPad._judge(scribble(nChars, nStrokes, r), chars, tol))) falseScribble++;
    }
  }
  return {
    ok: ok / n, cover: sumCover / nc, excess: sumExcess / nc, weak: sumWeak / nc,
    top: top / nc,
    other: falseOther / nFalse, scribble: falseScribble / nFalse
  };
}

const TOLS = process.argv.slice(2).map(Number);

console.log('単語=正解になった率、なぞれ/はみ出し=正しく書いたときの平均、'
          + '別の字・でたらめ=まちがって通した率');
console.log('合格の線: なぞれ >= ' + COVER + ' / はみ出し <= ' + EXCESS
          + ' / 抜けた画（' + STROKE + '未満）が画数の ' + WEAK + ' 以下'
          + ' / 似ている順で一番から ' + MARGIN + ' 以内\n');
for (const t of (TOLS.length ? TOLS : [null])) {
  console.log(t === null ? 'いまの js/kanji.js の設定' : 'TOL = ' + t);
  for (const n of [2, 3]) {
    const tol = t === null ? KanjiPad._tolFor(n) : t * (KanjiPad._tolFor(n) / KanjiPad._tolFor(1));
    for (const lv of LEVELS) {
      const x = run(tol, n, lv);
      console.log(
        '  ' + n + '文字 tol=' + tol.toFixed(0) + '  ' + lv.tag +
        '  単語 ' + (x.ok * 100).toFixed(1).padStart(5) + '%' +
        '  なぞれ ' + x.cover.toFixed(3) +
        '  はみ出し ' + x.excess.toFixed(3) +
        '  抜け ' + x.weak.toFixed(3) +
        '  一番 ' + (x.top * 100).toFixed(1).padStart(5) + '%' +
        '  別の字 ' + (x.other * 100).toFixed(1).padStart(4) + '%' +
        '  でたらめ ' + (x.scribble * 100).toFixed(1).padStart(4) + '%');
    }
  }
  console.log('');
}
