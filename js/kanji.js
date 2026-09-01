/* 漢字を書く欄と、その判定。
   ・単語ぜんぶを横に並んだマスに、好きな順で一気に書く。
   ・書いた線はそのまま残す。お手本の形にすり替えない。
   ・判定は「✓ 答える」を押したときに、書いた線ぜんぶと正解の形を突き合わせる。
   ・書き順も画の本数も見ない。字の形が合っているかだけを見る。 */
(function (global) {
  'use strict';

  var VB = 1024;              /* 筆画データの座標系（1文字ぶん 1024 四方） */
  var BASE = 900;             /* データは y が上向き。画面の y = BASE - データの y */

  /* 判定のものさし（1024 四方の座標での距離と割合）。
     tools/check-kanji.mjs で測って決めた。

     1画ずつ対応をつける見かたはやめた。指で書くと2画をつなげたり、1画を2回に
     分けたりするのがふつうで、本数をそろえさせると、正しく書いていても
     不正解になってしまうため（お手本をなぞっても不正解になっていた原因）。
     かわりに、本数にも書き順にも左右されない次の3つで見る。
       なぞれている割合 … お手本の形のうち、書いた線が近くを通っている割合
       抜けた画         … 1画ずつ見て、ほとんど通っていない画の数
       はみ出している割合 … 書いた線のうち、お手本のどこからも遠い部分の割合
     つなげ書きでできる渡りの線は はみ出し に出るだけで、なぞれている割合は落ちない。 */
  var TOL = 65;               /* お手本からどれだけ離れてよいか */
  var COVER_MIN = 0.80;       /* 字ぜんぶで、なぞれている割合がこれ以上 */
  var STROKE_MIN = 0.50;      /* 1画ずつ見て、なぞれている割合がこれ未満なら「抜けた画」 */
  var WEAK_RATIO = 0.10;      /* 抜けた画を、画数の何割まで見のがすか */
  var EXCESS_MAX = 0.45;      /* はみ出している割合が、これ以下なら合格 */
  /* ものさしだけでは「城」と「崎」のような似た字を分けられないので、
     書いた字が 101字のうちどれにいちばん似ているかも見る。
     いちばん近い字より、これ以上悪くなければ答えとみなす。 */
  var MARGIN = 0.20;
  var NORM = 256;             /* 形をくらべるときの大きさ（重心と、ちらばりをそろえる） */
  var MAP = 48;               /* 距離の表の細かさ（MAP×MAP マス） */
  var SPAN = 4 * NORM;        /* 表がカバーする範囲（-2NORM 〜 +2NORM） */
  /* マスが増えると1マスが画面上で小さくなり、同じ指のブレが座標では大きく出る。
     そのぶんだけ、離れてよい距離を文字数に応じてゆるめる。 */
  var SPREAD = 0.25;
  var STEP = 16;              /* 線を点に均すときの間隔 */

  function tolFor(nChars) { return TOL * (1 + SPREAD * (nChars - 1)); }

  /* ---------------------------------------------------------------- *
   * 線と点の計算
   * ---------------------------------------------------------------- */
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /** 線を、だいたい step ごとの点に均す。点の多い少ないで割合がぶれないようにするため。 */
  function densify(pts, step) {
    if (pts.length < 2) return [pts[0].slice()];
    var out = [pts[0].slice()];
    for (var i = 1; i < pts.length; i++) {
      var a = out[out.length - 1], b = pts[i];
      var n = Math.max(1, Math.round(dist(a, b) / step));
      for (var k = 1; k <= n; k++) {
        out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
    }
    return out;
  }

  /**
   * 「この点の近くに点があるか」を何度も聞くための升目。
   * 総当たりだと点の数の掛け算になるので、cell ごとの箱に入れて近所だけ見る。
   * @param {number} cell 箱の大きさ。これ以下の半径でしか聞けない。
   */
  function grid(points, cell) {
    var box = Object.create(null);
    for (var i = 0; i < points.length; i++) {
      var k = Math.floor(points[i][0] / cell) + ',' + Math.floor(points[i][1] / cell);
      (box[k] || (box[k] = [])).push(points[i]);
    }
    return function near(p, r) {
      var gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), r2 = r * r;
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var b = box[(gx + dx) + ',' + (gy + dy)];
          if (!b) continue;
          for (var i = 0; i < b.length; i++) {
            var ex = b[i][0] - p[0], ey = b[i][1] - p[1];
            if (ex * ex + ey * ey <= r2) return true;
          }
        }
      }
      return false;
    };
  }

  function meanOf(pts) {
    var x = 0, y = 0;
    for (var i = 0; i < pts.length; i++) { x += pts[i][0]; y += pts[i][1]; }
    return [x / pts.length, y / pts.length];
  }
  function spreadOf(pts, c) {
    var v = 0;
    for (var i = 0; i < pts.length; i++) {
      v += (pts[i][0] - c[0]) * (pts[i][0] - c[0]) + (pts[i][1] - c[1]) * (pts[i][1] - c[1]);
    }
    return v / pts.length;
  }

  /**
   * 「お手本をどれだけ動かし、どれだけ拡げれば、書いた字に重なるか」を出す。
   * 書き順にも画の本数にも左右されないよう、点の重心とちらばりだけで決める。
   * 字が小さめ・右寄りといった書きぐせは、判定をゆるめるのではなくここで吸収する。
   */
  function cloudFit(ref, user) {
    if (user.length < 12) return null;
    var cr = meanOf(ref), cu = meanOf(user);
    var vr = spreadOf(ref, cr), vu = spreadOf(user, cu);
    if (!(vr > 0) || !(vu > 0)) return null;
    var s = Math.min(1.25, Math.max(0.8, Math.sqrt(vu / vr)));
    return { s: s, dx: cu[0] - s * cr[0], dy: cu[1] - s * cr[1] };
  }
  function moveBy(pts, f) {
    return pts.map(function (p) { return [f.s * p[0] + f.dx, f.s * p[1] + f.dy]; });
  }

  function ratioNear(pts, near, r) {
    var n = 0;
    for (var i = 0; i < pts.length; i++) if (near(pts[i], r)) n++;
    return pts.length ? n / pts.length : 0;
  }

  /* ---------------------------------------------------------------- *
   * 字の形くらべ
   *   「答えの字にどれだけ近いか」だけでは、似た字（城と崎など）を分けられない。
   *   そこで、書いた字が 101字のうちどれにいちばん似ているかを見る。
   *   大きさと位置は先にそろえるので、小さく書いても右に寄っても結果は変わらない。
   * ---------------------------------------------------------------- */

  /** 重心を原点に、ちらばりを NORM にそろえる。大きさと位置のちがいを消すため。 */
  function normalize(pts) {
    var c = meanOf(pts), v = spreadOf(pts, c);
    if (!(v > 0)) return null;
    var k = NORM / Math.sqrt(v);
    return pts.map(function (p) { return [(p[0] - c[0]) * k, (p[1] - c[1]) * k]; });
  }

  /**
   * マス目に「いちばん近い線までの距離」を書き込んだ表を作る。
   * 毎回すべての点どうしを比べると重いので、表を1度作って引くだけにする。
   * （となりのマスから足していく、ふつうの距離変換）
   */
  function distMap(pts) {
    var step = SPAN / MAP, big = SPAN;
    var d = new Float32Array(MAP * MAP);
    var i, x, y;
    for (i = 0; i < d.length; i++) d[i] = big;
    for (i = 0; i < pts.length; i++) {
      x = Math.round((pts[i][0] + SPAN / 2) / step);
      y = Math.round((pts[i][1] + SPAN / 2) / step);
      if (x >= 0 && x < MAP && y >= 0 && y < MAP) d[y * MAP + x] = 0;
    }
    var diag = step * Math.SQRT2;
    function relax(x1, y1, x2, y2) {
      var a = d[y1 * MAP + x1] + (x1 === x2 || y1 === y2 ? step : diag);
      if (a < d[y2 * MAP + x2]) d[y2 * MAP + x2] = a;
    }
    for (y = 0; y < MAP; y++) for (x = 0; x < MAP; x++) {
      if (x > 0) relax(x - 1, y, x, y);
      if (y > 0) relax(x, y - 1, x, y);
      if (x > 0 && y > 0) relax(x - 1, y - 1, x, y);
      if (x < MAP - 1 && y > 0) relax(x + 1, y - 1, x, y);
    }
    for (y = MAP - 1; y >= 0; y--) for (x = MAP - 1; x >= 0; x--) {
      if (x < MAP - 1) relax(x + 1, y, x, y);
      if (y < MAP - 1) relax(x, y + 1, x, y);
      if (x < MAP - 1 && y < MAP - 1) relax(x + 1, y + 1, x, y);
      if (x > 0 && y < MAP - 1) relax(x - 1, y + 1, x, y);
    }
    return d;
  }
  function lookup(d, p) {
    var step = SPAN / MAP;
    var x = Math.round((p[0] + SPAN / 2) / step), y = Math.round((p[1] + SPAN / 2) / step);
    if (x < 0 || x >= MAP || y < 0 || y >= MAP) return SPAN;
    return d[y * MAP + x];
  }
  function meanLookup(pts, d) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) s += lookup(d, pts[i]);
    return s / pts.length;
  }
  /** 2つの形のへだたり。片側だけだと「一部しか書いていない」を見のがすので、両方向を平均する。 */
  function shapeGap(a, ma, b, mb) {
    return 0.5 * meanLookup(a, mb) + 0.5 * meanLookup(b, ma);
  }

  /** 1文字ぶんのお手本を、くらべられる形にして覚えておく（毎回作り直さない） */
  var shapeCache = {};
  function shapeOf(ch) {
    if (shapeCache[ch]) return shapeCache[ch];
    var pts = [];
    global.KANJI[ch].m.forEach(function (median) {
      densify(median.map(function (p) { return [p[0], BASE - p[1]]; }), STEP)
        .forEach(function (p) { pts.push(p); });
    });
    var np = normalize(pts);
    return (shapeCache[ch] = np ? { pts: np, map: distMap(np) } : null);
  }

  /**
   * 書いた字が、101字のうちどれにいちばん似ているかを見る。
   * @returns {{mine:number, best:number, bestCh:string}} へだたり。小さいほど似ている。
   */
  function ranking(inkPts, ch) {
    var a = normalize(inkPts);
    if (!a) return null;
    var ma = distMap(a);
    var mine = Infinity, best = Infinity, bestCh = '';
    for (var k in global.KANJI) {
      var t = shapeOf(k);
      if (!t) continue;
      var g = shapeGap(a, ma, t.pts, t.map);
      if (k === ch) mine = g;
      if (g < best) { best = g; bestCh = k; }
    }
    return { mine: mine, best: best, bestCh: bestCh };
  }

  /** 正解の形（各画の中心線）を、マスを横に並べた画面座標の点の集まりにする。画ごとに分けて持つ。 */
  function refCloud(ch, ci) {
    return global.KANJI[ch].m.map(function (median) {
      return densify(median.map(function (p) { return [p[0] + ci * VB, BASE - p[1]]; }), STEP);
    });
  }
  function flat(lists) {
    var out = [];
    lists.forEach(function (l) { l.forEach(function (p) { out.push(p); }); });
    return out;
  }

  /**
   * 書いた線ぜんぶと、正解の形を突き合わせる。
   *
   * 見るのは3つ。どれも画の本数や書き順に左右されない。
   *   なぞれている割合 … 字ぜんぶで、お手本の近くを線が通っている割合
   *   抜けた画         … 1画ずつ見て、ほとんど通っていない画の数
   *   はみ出し         … 書いた線のうち、お手本のどこからも遠い部分の割合
   *
   * 「抜けた画」を別に数えるのは、割合の合計だけだと、短い画をまるごと
   * 書き落としても気づけないため。逆に、2画をつなげて書いたときにできる
   * 渡りの線は はみ出し に出るだけで、なぞれている割合は落ちない。
   *
   * @param {Array<Array<[number,number]>>} strokes 書いた線（画面座標）
   * @param {Array<string>} chars 正解の文字
   * @param {number} tol お手本からどれだけ離れてよいか
   */
  function judge(strokes, chars, tol) {
    var n = chars.length;
    var refs = chars.map(refCloud);

    var ink = [];
    strokes.forEach(function (s) {
      densify(s, STEP).forEach(function (p) { ink.push(p); });
    });
    /* 書いた点を、どのマスのものとして数えるか。マスをまたぐ線は途中で分かれる。 */
    var inkBy = chars.map(function () { return []; });
    ink.forEach(function (p) {
      inkBy[Math.max(0, Math.min(n - 1, Math.floor(p[0] / VB)))].push(p);
    });

    var nearInk = grid(ink, tol);

    /* 文字ごとに、書かれた位置と大きさへお手本を寄せてから見る。
       寄せてよくならなければ、寄せないほうを使う。 */
    refs = refs.map(function (ref, ci) {
      var f = cloudFit(flat(ref), inkBy[ci]);
      if (!f) return ref;
      var moved = ref.map(function (line) { return moveBy(line, f); });
      return ratioNear(flat(moved), nearInk, tol) > ratioNear(flat(ref), nearInk, tol) ? moved : ref;
    });

    /* はみ出しは、そのマスのお手本だけでなく単語ぜんぶのお手本から見る。
       となりのマスへはみ出した線を、それだけで罰しないため。 */
    var nearRef = grid(flat(refs.map(flat)), tol);

    var out = chars.map(function (ch, ci) {
      var each = refs[ci].map(function (line) { return ratioNear(line, nearInk, tol); });
      var cover = ratioNear(flat(refs[ci]), nearInk, tol);
      var excess = 1 - ratioNear(inkBy[ci], nearRef, tol);
      var weak = 0;
      each.forEach(function (f) { if (f < STROKE_MIN) weak++; });
      var rank = inkBy[ci].length ? ranking(inkBy[ci], ch) : null;
      var nearest = rank ? rank.mine <= rank.best * (1 + MARGIN) : false;
      return {
        ch: ch, ci: ci, cover: cover, excess: excess, weak: weak, each: each,
        rank: rank, nearest: nearest,
        ok: nearest &&
            cover >= COVER_MIN &&
            excess <= EXCESS_MAX &&
            weak <= Math.floor(each.length * WEAK_RATIO)
      };
    });
    var ok = true;
    out.forEach(function (c) { if (!c.ok) ok = false; });
    return { ok: ok, chars: out };
  }

  /* ---------------------------------------------------------------- *
   * 表示
   * ---------------------------------------------------------------- */
  var FLIP = 'translate(0,' + BASE + ') scale(1,-1)';   /* 1文字ぶんの反転 */
  function cellTransform(i) { return 'translate(' + (i * VB) + ',0) ' + FLIP; }

  function linePoints(line) {
    return line.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  }

  function svgEl(inner, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 ' + VB + ' ' + VB + '" ' +
           'xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  }

  /** いちらん・結果でつかう小さな1文字 */
  function charSVG(ch, cls) {
    var d = global.KANJI[ch];
    if (!d) return svgEl('', cls);
    var paths = d.s.map(function (p) { return '<path class="k-on" d="' + p + '"/>'; }).join('');
    return svgEl('<g transform="' + FLIP + '">' + paths + '</g>', cls);
  }

  /** 文字ごとに輪郭パスをまとめて出す。pick(ci) が false の文字は出さない。 */
  function overlay(chars, cls, pick) {
    return chars.map(function (ch, ci) {
      if (pick && !pick(ci)) return '';
      var paths = global.KANJI[ch].s.map(function (p) {
        return '<path class="' + cls + '" d="' + p + '"/>';
      }).join('');
      return '<g transform="' + cellTransform(ci) + '">' + paths + '</g>';
    }).join('');
  }

  /* ---------------------------------------------------------------- *
   * 本体
   * ---------------------------------------------------------------- */
  /**
   * @param {object} o
   *   pad      … 書く欄を入れる要素
   *   chars    … 書かせる文字の配列（例 ['愛','知']）
   *   suffix   … 書かせない末尾（例 '県'）。無ければ ''
   *   guide    … お手本を薄く出すか
   *   onChange … 書いた線が増減したとき
   */
  function create(o) {
    var chars = o.chars.filter(function (c) { return global.KANJI[c]; });
    if (!chars.length) return null;

    var N = chars.length;
    var W = N * VB;
    var tol = tolFor(N);

    var strokes = [];        /* 書いた線。消さずにそのまま残す */
    var hints = 0;
    var finished = false;
    var judged = null;       /* 答え合わせのあとの結果 */
    var drawing = null, points = [];
    var svg, inkG, liveG, markG;

    /* ---- 骨組みは一度だけ作る ---- */
    function build() {
      var grid = '';
      for (var i = 0; i < N; i++) {
        var x = i * VB;
        grid += '<rect x="' + (x + 8) + '" y="8" width="' + (VB - 16) + '" height="' + (VB - 16) + '" rx="24"/>' +
                '<line x1="' + (x + VB / 2) + '" y1="8" x2="' + (x + VB / 2) + '" y2="' + (VB - 8) + '"/>' +
                '<line x1="' + (x + 8) + '" y1="' + VB / 2 + '" x2="' + (x + VB - 8) + '" y2="' + VB / 2 + '"/>';
      }

      o.pad.innerHTML =
        '<svg class="k-pad" viewBox="0 0 ' + W + ' ' + VB + '" style="aspect-ratio:' + N + ' / 1" ' +
             'xmlns="http://www.w3.org/2000/svg">' +
          '<g class="k-grid">' + grid + '</g>' +
          (o.guide ? overlay(chars, 'k-guide') : '') +
          '<g class="k-mark"></g>' +
          '<g class="k-ink"></g>' +
          '<g class="k-live"></g>' +
        '</svg>' +
        (o.suffix ? '<span class="k-suffix">' + o.suffix + '</span>' : '');

      svg = o.pad.querySelector('.k-pad');
      markG = svg.querySelector('.k-mark');
      inkG = svg.querySelector('.k-ink');
      liveG = svg.querySelector('.k-live');
      bind();
    }

    function paintInk() {
      inkG.innerHTML = strokes.map(function (line) {
        return '<polyline class="k-ink-line" points="' + linePoints(line) + '"/>';
      }).join('');
    }
    function paintLive() {
      liveG.innerHTML = points.length < 1 ? '' :
        '<polyline class="k-ink-line is-live" points="' + linePoints(points) + '"/>';
    }

    /* ---- 指の動き ---- */
    function bind() {
      function toPad(e) {
        var m = svg.getScreenCTM();
        if (!m) return null;
        var pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        var p = pt.matrixTransform(m.inverse());
        return [p.x, p.y];
      }

      svg.addEventListener('pointerdown', function (e) {
        if (finished) return;
        e.preventDefault();
        svg.setPointerCapture(e.pointerId);
        drawing = e.pointerId;
        var p = toPad(e);
        points = p ? [p] : [];
        paintLive();
      });
      svg.addEventListener('pointermove', function (e) {
        if (drawing !== e.pointerId) return;
        e.preventDefault();
        var p = toPad(e);
        if (!p) return;
        var last = points[points.length - 1];
        if (!last || dist(last, p) > 6) { points.push(p); paintLive(); }
      });
      function up(e) {
        if (drawing !== e.pointerId) return;
        drawing = null;
        var p = toPad(e);
        if (p && (!points.length || dist(points[points.length - 1], p) > 0.5)) points.push(p);
        if (points.length) strokes.push(points);
        points = [];
        liveG.innerHTML = '';
        paintInk();
        report();
      }
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);

      /* 長押しのメニューと、線をつかんで運ぶ操作を止める。
         書いているとちゅうに出てくると、その指の動きが線にならなくなるため。 */
      svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      svg.addEventListener('dragstart', function (e) { e.preventDefault(); });
      svg.addEventListener('selectstart', function (e) { e.preventDefault(); });
    }

    function report() {
      if (o.onChange) o.onChange({ strokes: strokes.length, hints: hints });
    }

    /* ---- 外から使う操作 ---- */
    function clear() {
      if (finished) return;
      strokes = [];
      paintInk(); report();
    }
    function undo() {
      if (finished || !strokes.length) return;
      strokes.pop();
      paintInk(); report();
    }
    /** お手本をひと目だけ見せる */
    function hint() {
      if (finished) return;
      hints++;
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = overlay(chars, 'k-hint');
      svg.insertBefore(g, markG);
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 1200);
      report();
    }

    /** 答え合わせ。書いた線はそのまま。ちがっていた文字だけ正解の形を重ねて見せる。 */
    function submit() {
      if (judged) return judged;
      finished = true;
      var j = judge(strokes, chars, tol);
      if (!j.ok) {
        var bad = {};
        j.chars.forEach(function (c) { if (!c.ok) bad[c.ci] = true; });
        markG.innerHTML =
          overlay(chars, 'k-answer') +
          overlay(chars, 'k-missing', function (ci) { return !!bad[ci]; });
      }
      judged = { ok: j.ok, chars: j.chars, strokes: strokes.length, hints: hints };
      return judged;
    }

    /** 書いた線を消さずに、正解の形だけ重ねて見せる */
    function reveal() {
      finished = true;
      markG.innerHTML = overlay(chars, 'k-answer');
    }

    function isDone() { return finished; }

    build();
    report();
    return { clear: clear, undo: undo, hint: hint, submit: submit, reveal: reveal, isDone: isDone };
  }

  global.KanjiPad = {
    create: create,
    charSVG: charSVG,
    /* テスト用に中身も出しておく */
    _judge: judge,
    _tolFor: tolFor,
    _limits: function () {
      return { cover: COVER_MIN, stroke: STROKE_MIN, weak: WEAK_RATIO,
               excess: EXCESS_MAX, margin: MARGIN };
    },
    _densify: densify
  };
})(window);
