/* 地図の描画（SVG）
   世界地図と日本地図の2種類を「アトラス」として同じ仕組みで扱う。
   ・世界 … データは経度緯度。ミラー図法（教科書の地図帳に近い見た目）で投影する。
   ・日本 … jpn-atlas の座標がすでに平面なので、投影せずそのまま描く。 */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;

  /** 緯度 → 描画座標の y（下が正）。ミラー図法。 */
  function millerY(lat) {
    var p = Math.max(-89, Math.min(89, lat)) * DEG;
    return -1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * p)) / DEG;
  }
  function sameY(y) { return y; }

  /* ---------------------------------------------------------------- *
   * 表示範囲
   * ---------------------------------------------------------------- */

  /* 世界は lon/lat の [西, 南, 東, 北] で書き、描画座標に直して使う。
     オセアニアは日付変更線をまたぐので経度 200 まで取る。 */
  var WORLD_BOXES = {
    world:           [-180, -57, 180, 83],
    asia:            [25, -12, 152, 57],
    europe:          [-26, 33, 62, 72],
    africa:          [-20, -37, 54, 39],
    'north-america': [-172, 4, -50, 76],
    'south-america': [-84, -57, -32, 14],
    oceania:         [110, -50, 200, 3]
  };

  /* 日本は jpn-atlas の座標のまま [左, 上, 右, 下] */
  var JAPAN_VIEWS = {
    all:               [15, 0, 665, 635],
    'hokkaido-tohoku': [438, 0, 662, 292],
    kanto:             [418, 256, 502, 402],
    chubu:             [348, 216, 478, 356],
    kinki:             [318, 296, 407, 390],
    'chugoku-shikoku': [234, 277, 353, 408],
    'kyushu-okinawa':  [20, 319, 286, 635]
  };

  var WORLD_VIEWS = {};
  for (var k in WORLD_BOXES) {
    var b = WORLD_BOXES[k];
    WORLD_VIEWS[k] = [b[0], millerY(b[3]), b[2], millerY(b[1])];
  }

  /* ---------------------------------------------------------------- *
   * アトラス
   * ---------------------------------------------------------------- */
  var ATLASES = {
    world: {
      key: 'world',
      source: 'GEO',
      projY: millerY,
      /* 図形の bbox（lon/lat）→ 描画座標の [左, 上, 右, 下] */
      drawBox: function (b) { return [b[0], millerY(b[3]), b[2], millerY(b[1])]; },
      wrap: true,                       /* 日付変更線をまたぐので ±360 に複製する */
      views: WORLD_VIEWS,
      whole: 'world',
      fit: { k: 5, min: 38, max: 190 }
    },
    japan: {
      key: 'japan',
      source: 'JAPAN_GEO',
      projY: sameY,
      drawBox: function (b) { return b; },
      wrap: false,
      views: JAPAN_VIEWS,
      whole: 'all',
      fit: { k: 5, min: 90, max: 640 }
    }
  };

  function atlas(name) {
    var a = ATLASES[name] || ATLASES.world;
    if (!a.shapes) { a.shapes = global[a.source] || {}; a.boxCache = Object.create(null); }
    return a;
  }

  function drawBoxOf(a, id) {
    var hit = a.boxCache[id];
    if (!hit) hit = a.boxCache[id] = a.drawBox(a.shapes[id].b);
    return hit;
  }

  /* 表示範囲を画面の縦横比に近づけるとき、広げすぎない上限 */
  var MAX_STRETCH = 1.6;

  function wholeView(a) { return a.views[a.whole].slice(); }

  function regionView(a, region) {
    return (a.views[region] || a.views[a.whole]).slice();
  }

  /** その国・県に寄った表示。大きさの k 倍を一辺とする四角を切り出す。 */
  function fitView(a, id) {
    if (!a.shapes[id]) return wholeView(a);
    var b = drawBoxOf(a, id);
    var span = Math.max(b[2] - b[0], b[3] - b[1]) * a.fit.k;
    span = Math.max(a.fit.min, Math.min(a.fit.max, span));
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return [cx - span / 2, cy - span / 2, cx + span / 2, cy + span / 2];
  }

  /* ---------------------------------------------------------------- *
   * 描画
   * ---------------------------------------------------------------- */
  var pathCache = Object.create(null);

  function pathFor(a, id, offset) {
    var key = a.key + '|' + id + '|' + offset;
    if (pathCache[key]) return pathCache[key];
    var shape = a.shapes[id];
    if (!shape) return '';
    var d = '';
    for (var i = 0; i < shape.p.length; i++) {
      var ring = shape.p[i];
      for (var j = 0; j < ring.length; j++) {
        d += (j ? 'L' : 'M') + (ring[j][0] + offset).toFixed(2) +
             ' ' + a.projY(ring[j][1]).toFixed(2);
      }
      d += 'Z';
    }
    pathCache[key] = d;
    return d;
  }

  function intersects(box, view, offset) {
    return box[2] + offset >= view[0] && box[0] + offset <= view[2] &&
           box[3] >= view[1] && box[1] <= view[3];
  }

  /**
   * 地図を描く。
   * @param {SVGElement} svg
   * @param {object} a          アトラス（WorldMap.atlas('world') など）
   * @param {number[]} view     表示範囲 [左, 上, 右, 下]
   * @param {string|null} targetId  強調表示する国・県
   * @param {Element} boxEl     使える表示領域（この中に収まる大きさで描く）
   */
  function render(svg, a, view, targetId, boxEl) {
    var vx = view[0], vy = view[1];
    var vw = view[2] - view[0], vh = view[3] - view[1];

    /* 画面の縦横比に近づける。広げすぎると対象が小さくなるので上限を設ける。 */
    var rect = (boxEl || svg.parentNode).getBoundingClientRect();
    var boxW = rect.width || 320, boxH = rect.height || 240;
    var aspect = boxW / boxH;
    if (vw / vh < aspect) {
      var nw = Math.min(vh * aspect, vw * MAX_STRETCH);
      vx -= (nw - vw) / 2; vw = nw;
    } else {
      var nh = Math.min(vw / aspect, vh * MAX_STRETCH);
      vy -= (nh - vh) / 2; vh = nh;
    }
    svg.setAttribute('viewBox', [vx, vy, vw, vh].join(' '));

    /* 海の余白が出ないよう、SVG 自体を地図とぴったり同じ形にする */
    var fit = Math.min(boxW / vw, boxH / vh);
    svg.style.width = Math.round(vw * fit) + 'px';
    svg.style.height = Math.round(vh * fit) + 'px';

    var offsets = a.wrap ? [-360, 0, 360] : [0];
    var shown = [vx, vy, vx + vw, vy + vh];
    var land = '', target = '', mark = '';

    for (var id in a.shapes) {
      var box = drawBoxOf(a, id);
      for (var o = 0; o < offsets.length; o++) {
        if (!intersects(box, shown, offsets[o])) continue;
        var d = pathFor(a, id, offsets[o]);
        if (!d) continue;
        if (id === targetId) {
          /* 正解は、まわりを縁取ってから塗る。地の色から浮き上がって形が読みやすい。 */
          target += '<path class="c-halo" d="' + d + '"/>' +
                    '<path class="c-target" d="' + d + '"/>';
        } else {
          land += '<path d="' + d + '"/>';
        }
      }
    }

    /* 画面に対して小さすぎるときは、丸い印で位置を示す */
    if (targetId && a.shapes[targetId]) {
      var tb = drawBoxOf(a, targetId);
      for (var q = 0; q < offsets.length; q++) {
        if (!intersects(tb, shown, offsets[q])) continue;
        var w = tb[2] - tb[0], h = tb[3] - tb[1];
        if (w < vw * 0.07 && h < vh * 0.07) {
          var r = Math.max(vw, vh) * 0.04;
          var cx = (tb[0] + tb[2]) / 2 + offsets[q], cy = (tb[1] + tb[3]) / 2;
          mark += '<circle class="c-mark" cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) +
                  '" r="' + r.toFixed(2) + '" stroke-width="' + (r * 0.22).toFixed(2) + '"/>';
        }
        break;
      }
    }

    svg.innerHTML =
      '<g class="c-layer">' +
        '<g class="c-land">' + land + '</g>' + target + mark +
      '</g>';
    return svg.querySelector('.c-layer');
  }

  /* ---------------------------------------------------------------- *
   * 指でのドラッグ・ピンチ操作
   * ---------------------------------------------------------------- */
  function attachGestures(svg, getLayer) {
    var k = 1, tx = 0, ty = 0;
    /* 地図を長押ししたときに出る「コピー／調べる」を止める。指の動きが拡大縮小に使えなくなるため */
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    svg.addEventListener('dragstart', function (e) { e.preventDefault(); });

    var pointers = Object.create(null), count = 0;
    var last = null, lastDist = 0;

    function unitsPerPx() {
      var m = svg.getScreenCTM();
      return m && m.a ? 1 / m.a : 1;
    }
    function vb() { return svg.getAttribute('viewBox').split(' ').map(Number); }
    function clamp() {
      var v = vb();
      k = Math.max(1, Math.min(14, k));
      tx = Math.min(0, Math.max((1 - k) * v[2], tx));
      ty = Math.min(0, Math.max((1 - k) * v[3], ty));
    }
    function apply() {
      var layer = getLayer();
      if (!layer) return;
      clamp();
      layer.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + k + ')');
      svg.classList.toggle('is-zoomed', k > 1.02);
    }
    function reset() { k = 1; tx = 0; ty = 0; apply(); }

    function mid() {
      var xs = 0, ys = 0, n = 0;
      for (var id in pointers) { xs += pointers[id].x; ys += pointers[id].y; n++; }
      return { x: xs / n, y: ys / n };
    }
    function dist() {
      var a = [];
      for (var id in pointers) a.push(pointers[id]);
      if (a.length < 2) return 0;
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    }

    svg.addEventListener('pointerdown', function (e) {
      if (!pointers[e.pointerId]) count++;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      svg.setPointerCapture(e.pointerId);
      last = mid(); lastDist = dist();
    });

    svg.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var m = mid(), u = unitsPerPx();

      if (count >= 2) {
        var d = dist();
        if (lastDist > 0 && d > 0) {
          var ratio = d / lastDist;
          /* ピンチの中心を固定したまま拡大する */
          var ctm = svg.getScreenCTM();
          if (ctm) {
            var pt = svg.createSVGPoint();
            pt.x = m.x; pt.y = m.y;
            var p = pt.matrixTransform(ctm.inverse());
            tx = p.x - (p.x - tx) * ratio;
            ty = p.y - (p.y - ty) * ratio;
            k *= ratio;
          }
        }
        lastDist = d;
      }
      if (last) { tx += (m.x - last.x) * u; ty += (m.y - last.y) * u; }
      last = m;
      apply();
      if (k > 1.02) e.preventDefault();
    });

    function end(e) {
      if (pointers[e.pointerId]) { delete pointers[e.pointerId]; count--; }
      if (count <= 0) { count = 0; last = null; lastDist = 0; }
      else { last = mid(); lastDist = dist(); }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var ctm = svg.getScreenCTM();
      if (!ctm) return;
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var p = pt.matrixTransform(ctm.inverse());
      var ratio = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      tx = p.x - (p.x - tx) * ratio;
      ty = p.y - (p.y - ty) * ratio;
      k *= ratio;
      apply();
    }, { passive: false });

    return { reset: reset, apply: apply, isZoomed: function () { return k > 1.02; } };
  }

  global.WorldMap = {
    atlas: atlas,
    render: render,
    fitView: fitView,
    regionView: regionView,
    wholeView: wholeView,
    attachGestures: attachGestures
  };
})(window);
