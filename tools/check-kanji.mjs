/* 漢字の判定（js/kanji.js の matchAll）のしきい値を測るための検証。
   手書きのブレを作り出して「正しく書いたのに落ちる率」と
   「ちがう字・でたらめな線を通してしまう率」を数える。

   使い方: node tools/check-kanji.mjs [accept倍率...]
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = {};
require('../data/kanji.js');
require('../data/prefectures.js');
require('../js/kanji.js');
const { KANJI, PREFECTURES, KanjiPad } = globalThis.window;

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
function densify(pts, step) {
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

/**
 * ある画を「人が書いた線」にする。
 *  shape … 字の形そのもののズレ（1024 座標での大きさ）
 *  finger … 指のブレ（画面 px）。マスが小さいほど座標では大きく効く
 */
function handwrite(median, r, o) {
  const pts = densify(median, 14);
  const n = pts.length;
  const ox = gauss(r) * o.shape, oy = gauss(r) * o.shape;
  const amp = Math.abs(gauss(r)) * o.shape * 0.8;
  const f1 = 1 + r() * 3, f2 = 1 + r() * 3, p1 = r() * 6.3, p2 = r() * 6.3;
  const cut0 = Math.round(n * Math.abs(gauss(r)) * 0.03);
  const cut1 = n - 1 - Math.round(n * Math.abs(gauss(r)) * 0.03);
  const out = [];
  for (let i = Math.min(cut0, n - 2); i <= Math.max(cut1, 1); i++) {
    const t = i / (n - 1);
    out.push([
      pts[i][0] + ox + amp * Math.sin(f1 * t * 6.3 + p1) + gauss(r) * o.finger,
      pts[i][1] + oy + amp * Math.sin(f2 * t * 6.3 + p2) + gauss(r) * o.finger
    ]);
  }
  return out.length >= 2 ? out : pts.slice();
}

/** 単語ぜんぶを書いたことにする。文字ごとに位置と大きさも少しずらす。 */
function writeWord(chars, r, o) {
  const strokes = [];
  chars.forEach((ch, ci) => {
    const cx = ci * 1024 + 512, cy = 512;
    const s = 1 + gauss(r) * o.scale;
    const dx = gauss(r) * o.place, dy = gauss(r) * o.place;
    KANJI[ch].m.forEach((median) => {
      const screen = median.map((p) => [p[0] + ci * 1024, 900 - p[1]]);
      const line = handwrite(screen, r, o);
      strokes.push(line.map((p) => [cx + (p[0] - cx) * s + dx, cy + (p[1] - cy) * s + dy]));
    });
  });
  return strokes;
}

/** でたらめな線を、正解と同じ本数だけ引く */
function scribble(nChars, nStrokes, r) {
  const out = [];
  for (let i = 0; i < nStrokes; i++) {
    const ci = Math.floor(r() * nChars);
    const x0 = ci * 1024 + 100 + r() * 800, y0 = 100 + r() * 800;
    const x1 = ci * 1024 + 100 + r() * 800, y1 = 100 + r() * 800;
    out.push(densify([[x0, y0], [x1, y1]], 20).map((p) => [p[0] + gauss(r) * 8, p[1] + gauss(r) * 8]));
  }
  return out;
}

/* ---- 検証 ---- */
const names = [...new Set(PREFECTURES.filter((p) => p.write).map((p) => p.name))];
const byLen = { 2: names.filter((n) => n.length === 2), 3: names.filter((n) => n.length === 3) };

/* ブレの想定。finger は 1マスの画面サイズから座標に直す（横 355px に N マス） */
const LEVELS = [
  { tag: 'ていねい', shape: 26, fingerPx: 1.6, scale: 0.03, place: 22 },
  { tag: 'ふつう  ', shape: 40, fingerPx: 2.4, scale: 0.05, place: 34 },
  { tag: 'ざつ    ', shape: 56, fingerPx: 3.4, scale: 0.07, place: 48 }
];
const TRIALS = 8;

/** js/kanji.js の submit() と同じ合否。cap は「よけいな線」の本数まで見るほう。 */
const passed = (m) => {
  let extras = 0;
  m.hit.forEach((h) => { if (!h) extras++; });
  return {
    all: m.matched === m.pairs.length,
    cap: m.matched === m.pairs.length && extras <= KanjiPad._extraCapFor(m.pairs.length)
  };
};

function run(accept, nChars, lv) {
  const r = mulberry32(12345 + nChars * 7 + Math.round(accept));
  const list = byLen[nChars];
  const o = { shape: lv.shape, finger: lv.fingerPx * nChars * 1024 / 355, scale: lv.scale, place: lv.place };
  let okWord = 0, okWordCap = 0, nWord = 0, okStroke = 0, nStroke = 0;
  let falseScribble = 0, falseOther = 0, falseOtherCap = 0, nFalse = 0;

  /* 1文字を共有する県名（山口/山形 など）はいちばん間違えやすいので、必ず入れる */
  const share = (a, b) => a.split('').some((c) => b.indexOf(c) >= 0);

  for (let t = 0; t < TRIALS; t++) {
    for (const name of list) {
      const chars = name.split('');
      const refs = KanjiPad._refStrokes(chars);
      const m = KanjiPad._matchAll(writeWord(chars, r, o), refs, accept);
      const p = passed(m);
      nWord++; if (p.all) okWord++; if (p.cap) okWordCap++;
      okStroke += m.matched; nStroke += refs.length;

      const others = list.filter((x) => x !== name);
      const hard = others.filter((x) => share(x, name));
      const pool = hard.length && t % 2 === 0 ? hard : others;
      const other = pool[Math.floor(r() * pool.length)];
      nFalse++;
      const w = passed(KanjiPad._matchAll(writeWord(other.split(''), r, o), refs, accept));
      if (w.all) falseOther++;
      if (w.cap) falseOtherCap++;
      const sc = passed(KanjiPad._matchAll(scribble(nChars, refs.length, r), refs, accept));
      if (sc.cap) falseScribble++;
    }
  }
  return {
    word: okWord / nWord, wordCap: okWordCap / nWord, stroke: okStroke / nStroke,
    scribble: falseScribble / nFalse, other: falseOther / nFalse, otherCap: falseOtherCap / nFalse
  };
}

/* 引数なしなら、いま js/kanji.js に入っている設定をそのまま測る。
   引数を渡すと、その値をしきい値の基準（ACCEPT）にして測り直す。 */
const BASES = process.argv.slice(2).map(Number);

console.log('単語=全画そろった率、画=1画あたり通った率、でたらめ・別の字=まちがって通した率\n');
for (const base of (BASES.length ? BASES : [null])) {
  console.log(base === null ? 'いまの js/kanji.js の設定' : 'ACCEPT = ' + base);
  for (const n of [2, 3]) {
    const accept = base === null
      ? KanjiPad._acceptFor(n)
      : base * (KanjiPad._acceptFor(n) / KanjiPad._acceptFor(1));
    for (const lv of LEVELS) {
      const x = run(accept, n, lv);
      console.log(
        '  ' + n + '文字 accept=' + accept.toFixed(0) + '  ' + lv.tag +
        '  単語 ' + (x.word * 100).toFixed(1).padStart(5) + '%' +
        '  画 ' + (x.stroke * 100).toFixed(1).padStart(5) + '%' +
        '  でたらめ ' + (x.scribble * 100).toFixed(1).padStart(4) + '%' +
        '  別の字 ' + (x.other * 100).toFixed(1).padStart(4) + '%' +
        ' →よけい線制限 ' + (x.otherCap * 100).toFixed(1).padStart(4) + '%');
    }
  }
  console.log('');
}
