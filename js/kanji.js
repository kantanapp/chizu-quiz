/* 漢字をなぞって書く欄と、その判定。
   ・書き順は採点しない。どの画から書いてもよい。
   ・指でなぞった線を、まだ書かれていない画の「中心線」と照らし合わせ、
     いちばん近いものに当てはめる。近いものが無ければ書き直し。 */
(function (global) {
  'use strict';

  var VB = 1024;              /* 筆画データの座標系（1024 四方） */
  var FLIP = 'translate(0,900) scale(1,-1)';   /* データは y が上向きなので反転する */

  /* 判定のしきい値（1024 四方の座標での距離）。
     お手本が見えているときは線がぶれにくいので厳しめ、
     お手本なしで書くときは大きくずれる前提でゆるめにする。
     数値は tools/ の検証で決めた（正しい画は 99% 以上通り、
     でたらめな線は 9 割方はじく）。 */
  var ACCEPT_GUIDED = 75;
  var ACCEPT_FREE = 95;
  var SAMPLES = 24;           /* 比べるときに線を何点に均すか */

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
    if (pts.length === 1) { var out = []; for (var q = 0; q < n; q++) out.push(pts[0].slice()); return out; }
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

  /** なぞった線と、お手本の画がどれだけ違うか。小さいほど近い。 */
  function cost(user, median) {
    var a = meanDistToPoly(user, median);
    var b = meanDistToPoly(median, user);
    /* 端と端。向きは問わないので、順・逆の近いほうを取る */
    var e1 = dist(user[0], median[0]) + dist(user[user.length - 1], median[median.length - 1]);
    var e2 = dist(user[0], median[median.length - 1]) + dist(user[user.length - 1], median[0]);
    return 0.35 * a + 0.35 * b + 0.3 * (Math.min(e1, e2) / 2);
  }

  /**
   * なぞった線を、まだ書かれていない画に当てはめる。
   * 書き順は見ないので、残っている画すべてと比べていちばん近いものを選ぶ。
   * @returns {number} 画の番号。当てはまらなければ -1
   */
  function match(userPts, medians, doneFlags, accept) {
    if (userPts.length < 2) return -1;
    var user = resample(userPts, SAMPLES);
    var best = -1, bestCost = Infinity;

    for (var i = 0; i < medians.length; i++) {
      if (doneFlags[i]) continue;
      var c = cost(user, resample(medians[i], SAMPLES));
      if (c < bestCost) { bestCost = c; best = i; }
    }
    return bestCost <= (accept || ACCEPT_GUIDED) ? best : -1;
  }

  /* ---------------------------------------------------------------- *
   * 表示
   * ---------------------------------------------------------------- */
  function svgEl(inner, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 ' + VB + ' ' + VB + '" ' +
           'xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  }

  function charSVG(ch, cls, upTo) {
    var d = global.KANJI[ch];
    if (!d) return svgEl('', cls);
    var paths = d.s.map(function (p, i) {
      var on = upTo == null || upTo[i];
      return '<path class="' + (on ? 'k-on' : 'k-off') + '" d="' + p + '"/>';
    }).join('');
    return svgEl('<g transform="' + FLIP + '">' + paths + '</g>', cls);
  }

  /* ---------------------------------------------------------------- *
   * 本体
   * ---------------------------------------------------------------- */
  /**
   * @param {object} o
   *   strip    … 文字の並びを出す要素
   *   pad      … 書く欄
   *   chars    … 書かせる文字の配列（例 ['新','潟']）
   *   suffix   … 書かせない末尾（例 '県'）。無ければ ''
   *   guide    … お手本を薄く出すか
   *   onChange … 進み具合が変わったとき
   *   onComplete … 全部書けたとき
   */
  function create(o) {
    var chars = o.chars.filter(function (c) { return global.KANJI[c]; });
    if (!chars.length) return null;

    var state = chars.map(function (c) {
      return { ch: c, done: global.KANJI[c].m.map(function () { return false; }), left: global.KANJI[c].m.length };
    });
    var accept = o.guide ? ACCEPT_GUIDED : ACCEPT_FREE;
    var at = 0, mistakes = 0, hints = 0, finished = false;
    var drawing = null, points = [];

    /* ---- 文字の並び ---- */
    function renderStrip() {
      var html = '';
      for (var i = 0; i < state.length; i++) {
        var cls = 'k-cell' + (i === at ? ' is-active' : '') + (state[i].left === 0 ? ' is-done' : '');
        html += '<span class="' + cls + '">' + charSVG(state[i].ch, 'k-mini', state[i].done) + '</span>';
      }
      if (o.suffix) html += '<span class="k-suffix">' + o.suffix + '</span>';
      o.strip.innerHTML = html;
    }

    /* ---- 書く欄 ---- */
    function renderPad() {
      var s = state[at], d = global.KANJI[s.ch];
      var guide = o.guide
        ? d.s.map(function (p, i) { return s.done[i] ? '' : '<path class="k-guide" d="' + p + '"/>'; }).join('')
        : '';
      var done = d.s.map(function (p, i) {
        return s.done[i] ? '<path class="k-ink" d="' + p + '"/>' : '';
      }).join('');
      o.pad.innerHTML =
        '<svg class="k-pad" viewBox="0 0 ' + VB + ' ' + VB + '" xmlns="http://www.w3.org/2000/svg">' +
          '<g class="k-grid">' +
            '<rect x="8" y="8" width="' + (VB - 16) + '" height="' + (VB - 16) + '" rx="24"/>' +
            '<line x1="' + VB / 2 + '" y1="8" x2="' + VB / 2 + '" y2="' + (VB - 8) + '"/>' +
            '<line x1="8" y1="' + VB / 2 + '" x2="' + (VB - 8) + '" y2="' + VB / 2 + '"/>' +
          '</g>' +
          '<g class="k-space" transform="' + FLIP + '">' +
            guide + done + '<g class="k-live"></g>' +
          '</g>' +
        '</svg>';
      bind(o.pad.querySelector('.k-pad'));
    }

    /* ---- 指の動き ---- */
    function bind(svg) {
      var space = svg.querySelector('.k-space');
      var live = svg.querySelector('.k-live');

      function toData(e) {
        var m = space.getScreenCTM();
        if (!m) return null;
        var pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        var p = pt.matrixTransform(m.inverse());
        return [p.x, p.y];
      }
      function paint() {
        live.innerHTML = points.length < 2 ? '' :
          '<polyline class="k-live-line" points="' +
          points.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
      }

      svg.addEventListener('pointerdown', function (e) {
        if (finished) return;
        e.preventDefault();
        svg.setPointerCapture(e.pointerId);
        drawing = e.pointerId;
        var p = toData(e);
        points = p ? [p] : [];
        paint();
      });
      svg.addEventListener('pointermove', function (e) {
        if (drawing !== e.pointerId) return;
        e.preventDefault();
        var p = toData(e);
        if (!p) return;
        var last = points[points.length - 1];
        if (!last || dist(last, p) > 6) { points.push(p); paint(); }
      });
      function up(e) {
        if (drawing !== e.pointerId) return;
        drawing = null;
        var pts = points; points = [];
        settle(svg, live, pts);
      }
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    }

    /* ---- 判定 ---- */
    function settle(svg, live, pts) {
      var s = state[at];
      var idx = match(pts, global.KANJI[s.ch].m, s.done, accept);
      if (idx < 0) {
        mistakes++;
        live.innerHTML = '<polyline class="k-live-line is-ng" points="' +
          pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
        setTimeout(function () { live.innerHTML = ''; }, 260);
        report();
        return;
      }
      live.innerHTML = '';
      s.done[idx] = true;
      s.left--;
      renderPad();
      renderStrip();
      report();

      if (s.left === 0) {
        if (at < state.length - 1) {
          setTimeout(function () { at++; renderPad(); renderStrip(); }, 320);
        } else if (!finished) {
          finished = true;
          setTimeout(function () {
            if (o.onComplete) o.onComplete({ mistakes: mistakes, hints: hints });
          }, 380);
        }
      }
    }

    function report() {
      if (!o.onChange) return;
      var total = 0, done = 0;
      state.forEach(function (s) { total += s.done.length; done += s.done.length - s.left; });
      o.onChange({ done: done, total: total, mistakes: mistakes, hints: hints });
    }

    /* ---- 外から使う操作 ---- */
    function clear() {
      var s = state[at];
      s.done = s.done.map(function () { return false; });
      s.left = s.done.length;
      renderPad(); renderStrip(); report();
    }
    function hint() {
      var s = state[at];
      var i = s.done.indexOf(false);
      if (i < 0) return;
      hints++;
      var svg = o.pad.querySelector('.k-pad');
      var space = svg.querySelector('.k-space');
      var flash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      flash.setAttribute('class', 'k-hint');
      flash.setAttribute('d', global.KANJI[s.ch].s[i]);
      space.appendChild(flash);
      setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 1100);
      report();
    }
    function reveal() {
      state.forEach(function (s) {
        s.done = s.done.map(function () { return true; });
        s.left = 0;
      });
      at = state.length - 1;
      finished = true;
      renderPad(); renderStrip(); report();
    }
    function isDone() { return finished; }

    renderStrip();
    renderPad();
    report();
    return { clear: clear, hint: hint, reveal: reveal, isDone: isDone };
  }

  global.KanjiPad = {
    create: create,
    charSVG: charSVG,
    /* テスト用に中身も出しておく */
    _match: match,
    _cost: cost,
    _resample: resample
  };
})(window);
