/* 漢字を書く欄と、その判定。
   ・単語ぜんぶを横に並んだマスに、好きな順で一気に書く。
   ・書いた線はそのまま残す。お手本の形にすり替えない。
   ・判定は「✓ 答える」を押したときに、書いた線の集合と正解の画の集合を突き合わせる。
   ・書き順は採点しない。 */
(function (global) {
  'use strict';

  var VB = 1024;              /* 筆画データの座標系（1文字ぶん 1024 四方） */
  var BASE = 900;             /* データは y が上向き。画面の y = BASE - データの y */

  /* 判定のしきい値（1024 四方の座標での距離）。tools/check-kanji.mjs で測って決めた。
     手書きのブレを作って数えたところ、この値で
       ・ふつうに書いた単語は 99% 通る（雑に書いても 89%）
       ・別の県名を書いたものは 97% はじく、でたらめな線は 99% はじく
     お手本のあり・なしでしきい値は変えない。お手本が見えているほうが易しい設定なので、
     そこだけ厳しくすると理屈が逆になるため。 */
  var ACCEPT = 210;
  /* マスが増えると1マスが画面上で小さくなり、同じ指のブレが座標では大きく出る。
     そのぶんだけ、しきい値を文字数に応じてゆるめる。 */
  var SPREAD = 0.35;
  /* どの画にも使われなかった線を、何本まで見のがすか（正解の画数に対する割合）。
     これが無いと「山口」のつもりで「山形」を書いても通ってしまう。 */
  var EXTRA_RATIO = 0.15;
  var SAMPLES = 24;           /* 比べるときに線を何点に均すか */

  function acceptFor(nChars) { return ACCEPT * (1 + SPREAD * (nChars - 1)); }
  function extraCapFor(nStrokes) { return Math.max(1, Math.floor(nStrokes * EXTRA_RATIO)); }

  /* ---------------------------------------------------------------- *
   * 線の計算
   * ---------------------------------------------------------------- */
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  function polyLen(pts) {
    var n = 0;
    for (var i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
    return n;
  }

  /** 線を等間隔の n 点に均す。点の多い少ないで判定がぶれないようにするため。 */
  function resample(pts, n) {
    if (pts.length === 1 || polyLen(pts) === 0) {
      var out = [];
      for (var q = 0; q < n; q++) out.push(pts[0].slice());
      return out;
    }
    var total = polyLen(pts), step = total / (n - 1);
    var res = [pts[0].slice()], acc = 0, i = 1, cur = pts[0];
    while (res.length < n && i < pts.length) {
      var d = dist(cur, pts[i]);
      if (acc + d >= step && d > 0) {
        var t = (step - acc) / d;
        var p = [cur[0] + (pts[i][0] - cur[0]) * t, cur[1] + (pts[i][1] - cur[1]) * t];
        res.push(p); cur = p; acc = 0;
      } else { acc += d; cur = pts[i]; i++; }
    }
    while (res.length < n) res.push(pts[pts.length - 1].slice());
    return res;
  }

  function distToSeg(p, a, b) {
    var x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      var t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    return Math.hypot(p[0] - x, p[1] - y);
  }

  function meanDistToPoly(pts, poly) {
    var sum = 0;
    for (var i = 0; i < pts.length; i++) {
      var best = Infinity;
      for (var j = 1; j < poly.length; j++) {
        var d = distToSeg(pts[i], poly[j - 1], poly[j]);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum / pts.length;
  }

  /** 書いた線と、お手本の画がどれだけ違うか。小さいほど近い。 */
  function cost(user, median) {
    var a = meanDistToPoly(user, median);
    var b = meanDistToPoly(median, user);
    /* 端と端。向きは問わないので、順・逆の近いほうを取る */
    var e1 = dist(user[0], median[0]) + dist(user[user.length - 1], median[median.length - 1]);
    var e2 = dist(user[0], median[median.length - 1]) + dist(user[user.length - 1], median[0]);
    return 0.35 * a + 0.35 * b + 0.3 * (Math.min(e1, e2) / 2);
  }

  /** 線を囲む四角。遠い組み合わせを先に外すのに使う。 */
  function bbox(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][0] < x0) x0 = pts[i][0];
      if (pts[i][0] > x1) x1 = pts[i][0];
      if (pts[i][1] < y0) y0 = pts[i][1];
      if (pts[i][1] > y1) y1 = pts[i][1];
    }
    return [x0, y0, x1, y1];
  }
  /** 四角どうしのすき間。これより小さい cost にはならないので、しきい値より広ければ計算しない。 */
  function boxGap(a, b) {
    var dx = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2]));
    var dy = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
    return Math.hypot(dx, dy);
  }

  /**
   * 書いた線の集合と、正解の画の集合を突き合わせる。
   * 書き順は見ないので、いちばん近い組から順に取っていく（1本は1画にしか使わない）。
   *
   * 一度取れた組から「その文字をどのくらいの大きさで、どこに書いたか」を割り出し、
   * お手本のほうをそこに合わせ直して、もう一度突き合わせる（合わせて増えたときだけ採用）。
   * こうすると、字が小さめ・右寄りといった書きぐせを、判定のゆるさではなく
   * 位置合わせのほうで吸収できる。
   *
   * @param {Array<Array<[number,number]>>} userStrokes 書いた線（画面座標）
   * @param {Array<{ci:number, si:number, pts:Array}>} refs 正解の画（画面座標）
   * @param {number} accept しきい値
   * @returns {{pairs:Array<number>, hit:Array<boolean>, matched:number}}
   *   pairs[画の番号] = 使った線の番号（無ければ -1）、hit[線の番号] = 使われたか
   */
  function matchAll(userStrokes, refs, accept) {
    var u = userStrokes.map(function (s) { return resample(s, SAMPLES); });
    var ub = u.map(bbox);
    var r0 = refs.map(function (x) { return resample(x.pts, SAMPLES); });

    /* 文字ごとに画の番号をまとめておく */
    var chars = [];
    refs.forEach(function (x, i) {
      (chars[x.ci] || (chars[x.ci] = [])).push(i);
    });

    var pairs = refs.map(function () { return -1; });
    var hit = userStrokes.map(function () { return false; });

    /** 近い組から順に取る。すでに使った画・線は飛ばす。 */
    function greedy(refIdx, r, rb) {
      var costs = [];
      refIdx.forEach(function (ri) {
        if (pairs[ri] >= 0) return;
        for (var ui = 0; ui < u.length; ui++) {
          if (hit[ui] || boxGap(ub[ui], rb[ri]) > accept) continue;
          var c = cost(u[ui], r[ri]);
          if (c <= accept) costs.push([c, ri, ui]);
        }
      });
      costs.sort(function (a, b) { return a[0] - b[0]; });
      var n = 0;
      costs.forEach(function (c) {
        if (pairs[c[1]] >= 0 || hit[c[2]]) return;
        pairs[c[1]] = c[2]; hit[c[2]] = true; n++;
      });
      return n;
    }

    var rb0 = r0.map(bbox);
    var order = [];
    for (var i = 0; i < refs.length; i++) order.push(i);
    greedy(order, r0, rb0);

    /* 文字ごとに位置と大きさを合わせ直して、もう一度 */
    chars.forEach(function (idx) {
      var got = idx.filter(function (ri) { return pairs[ri] >= 0; });
      if (!got.length || got.length === idx.length) return;

      var f = fit(got.map(function (ri) { return r0[ri]; }),
                  got.map(function (ri) { return u[pairs[ri]]; }));
      if (!f) return;

      var r1 = r0.slice(), rb1 = rb0.slice();
      idx.forEach(function (ri) {
        r1[ri] = apply(r0[ri], f);
        rb1[ri] = bbox(r1[ri]);
      });

      /* 合わせ直したうえで取り直す。減ってしまったら元に戻す。 */
      var keepPairs = pairs.slice(), keepHit = hit.slice();
      var before = got.length;
      idx.forEach(function (ri) {
        if (pairs[ri] >= 0) { hit[pairs[ri]] = false; pairs[ri] = -1; }
      });
      var after = greedy(idx, r1, rb1);
      if (after < before) { pairs = keepPairs; hit = keepHit; }
    });

    var matched = 0;
    pairs.forEach(function (p) { if (p >= 0) matched++; });
    return { pairs: pairs, hit: hit, matched: matched };
  }

  /**
   * 取れた組から「お手本をどれだけ動かし、どれだけ拡げれば、書いた字に重なるか」を出す。
   * 向きや書き順に左右されないよう、点の重心とちらばりだけで決める。
   */
  function fit(refList, userList) {
    var cr = centroidOf(refList), cu = centroidOf(userList);
    var vr = spreadOf(refList, cr), vu = spreadOf(userList, cu);
    if (!(vr > 0)) return null;
    var s = Math.sqrt(vu / vr);
    if (refList.length < 2) s = 1;                 /* 1本だけでは大きさは決められない */
    s = Math.min(1.3, Math.max(0.75, s));
    return { s: s, dx: cu[0] - s * cr[0], dy: cu[1] - s * cr[1] };
  }
  function apply(pts, f) {
    return pts.map(function (p) { return [f.s * p[0] + f.dx, f.s * p[1] + f.dy]; });
  }
  function centroidOf(list) {
    var x = 0, y = 0, n = 0;
    list.forEach(function (pts) {
      for (var i = 0; i < pts.length; i++) { x += pts[i][0]; y += pts[i][1]; n++; }
    });
    return [x / n, y / n];
  }
  function spreadOf(list, c) {
    var v = 0, n = 0;
    list.forEach(function (pts) {
      for (var i = 0; i < pts.length; i++) {
        v += (pts[i][0] - c[0]) * (pts[i][0] - c[0]) + (pts[i][1] - c[1]) * (pts[i][1] - c[1]);
        n++;
      }
    });
    return v / n;
  }

  /** 正解の画を、マスを横に並べた画面座標に置き直す。 */
  function refStrokes(chars) {
    var out = [];
    chars.forEach(function (ch, ci) {
      var ox = ci * VB;
      global.KANJI[ch].m.forEach(function (median, si) {
        out.push({
          ci: ci, si: si,
          pts: median.map(function (p) { return [p[0] + ox, BASE - p[1]]; })
        });
      });
    });
    return out;
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

  /** いちらん・結果でつかう小さな1文字。upTo を渡すとその画だけ濃くする。 */
  function charSVG(ch, cls, upTo) {
    var d = global.KANJI[ch];
    if (!d) return svgEl('', cls);
    var paths = d.s.map(function (p, i) {
      var on = upTo == null || upTo[i];
      return '<path class="' + (on ? 'k-on' : 'k-off') + '" d="' + p + '"/>';
    }).join('');
    return svgEl('<g transform="' + FLIP + '">' + paths + '</g>', cls);
  }

  /** 文字ごとに輪郭パスをまとめて出す。pick(ci,si) が false の画は出さない。 */
  function overlay(chars, cls, pick) {
    return chars.map(function (ch, ci) {
      var paths = global.KANJI[ch].s.map(function (p, si) {
        return (!pick || pick(ci, si)) ? '<path class="' + cls + '" d="' + p + '"/>' : '';
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
    var refs = refStrokes(chars);
    var accept = acceptFor(N);

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
      var guide = o.guide ? overlay(chars, 'k-guide') : '';

      o.pad.innerHTML =
        '<svg class="k-pad" viewBox="0 0 ' + W + ' ' + VB + '" style="aspect-ratio:' + N + ' / 1" ' +
             'xmlns="http://www.w3.org/2000/svg">' +
          '<g class="k-grid">' + grid + '</g>' +
          guide +
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
    }

    function report() {
      if (o.onChange) o.onChange({ strokes: strokes.length, hints: hints });
    }

    /* ---- 外から使う操作 ---- */
    function clear() {
      if (finished) return;
      strokes = [];
      markG.innerHTML = '';
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

    /**
     * 答え合わせ。書いた線はそのまま。足りなかった画だけ上に重ねて見せる。
     */
    function submit() {
      if (judged) return judged;
      finished = true;
      var m = matchAll(strokes, refs, accept);
      var miss = {};
      refs.forEach(function (x, i) {
        if (m.pairs[i] < 0) miss[x.ci + ':' + x.si] = true;
      });
      var extras = 0;
      m.hit.forEach(function (h) { if (!h) extras++; });
      var cap = extraCapFor(refs.length);
      var ok = m.matched === refs.length && extras <= cap;
      if (!ok) {
        markG.innerHTML =
          overlay(chars, 'k-answer') +
          overlay(chars, 'k-missing', function (ci, si) { return miss[ci + ':' + si]; });
      }
      judged = {
        ok: ok, matched: m.matched, total: refs.length,
        strokes: strokes.length, extras: extras, extraCap: cap, hints: hints
      };
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
    _matchAll: matchAll,
    _refStrokes: refStrokes,
    _acceptFor: acceptFor,
    _extraCapFor: extraCapFor,
    _cost: cost,
    _resample: resample
  };
})(window);
