/* 地図の描画（ミラー図法・SVG）
   世界地図の見た目を、教科書の地図帳に近いミラー円筒図法でそろえている。 */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;

  /** 緯度 → SVG の y（下が正）。ミラー図法。 */
  function projY(lat) {
    var p = Math.max(-89, Math.min(89, lat)) * DEG;
    return -1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * p)) / DEG;
  }

  /* 大州ごとの表示範囲。lon/lat の [西, 南, 東, 北]。
     オセアニアは日付変更線をまたぐので、経度 200 まで取る。 */
  var VIEWS = {
    world:           [-180, -57, 180, 83],
    asia:            [25, -12, 152, 57],
    europe:          [-26, 33, 62, 72],
    africa:          [-20, -37, 54, 39],
    'north-america': [-172, 4, -50, 76],
    'south-america': [-84, -57, -32, 14],
    oceania:         [110, -50, 200, 3]
  };

  /* 日付変更線をまたぐ地図でも国が切れないよう、
     同じ図形を経度 -360 / 0 / +360 の位置に置いて、
     表示範囲に入るものだけ描く。 */
  var OFFSETS = [-360, 0, 360];

  /* 表示範囲を、余白が出すぎない程度だけ広げる上限 */
  var MAX_STRETCH = 1.6;

  var pathCache = Object.create(null);

  function pathFor(n3, offset) {
    var key = n3 + '|' + offset;
    if (pathCache[key]) return pathCache[key];
    var shape = global.GEO[n3];
    if (!shape) return '';
    var d = '';
    for (var i = 0; i < shape.p.length; i++) {
      var ring = shape.p[i];
      for (var j = 0; j < ring.length; j++) {
        d += (j ? 'L' : 'M') + (ring[j][0] + offset).toFixed(2) +
             ' ' + projY(ring[j][1]).toFixed(2);
      }
      d += 'Z';
    }
    pathCache[key] = d;
    return d;
  }

  /** その図形が表示範囲と重なるか */
  function intersects(b, box, offset) {
    return b[2] + offset >= box[0] && b[0] + offset <= box[2] &&
           b[3] >= box[1] && b[1] <= box[3];
  }

  /** 図形の中心（描画座標）。小さい国に印をつけるのに使う。 */
  function centerOf(n3, offset) {
    var b = global.GEO[n3].b;
    return {
      x: (b[0] + b[2]) / 2 + offset,
      y: (projY(b[1]) + projY(b[3])) / 2,
      w: b[2] - b[0],
      h: Math.abs(projY(b[1]) - projY(b[3]))
    };
  }

  /**
   * 地図を描く。
   * @param {SVGElement} svg
   * @param {string} viewName  VIEWS のキー
   * @param {string|null} targetN3  強調表示する国（ccn3）
   * @param {Element} boxEl  使える表示領域（この中に収まる大きさで描く）
   */
  function render(svg, viewName, targetN3, boxEl) {
    var box = VIEWS[viewName] || VIEWS.world;

    var vx = box[0];
    var vy = projY(box[3]);
    var vw = box[2] - box[0];
    var vh = projY(box[1]) - vy;

    /* 画面の縦横比に近づける。広げすぎると地域が小さくなるので
       MAX_STRETCH までにとどめる。 */
    var rect = (boxEl || svg.parentNode).getBoundingClientRect();
    var boxW = rect.width || 320, boxH = rect.height || 240;
    var aspect = boxW / boxH;
    if (aspect > 0) {
      if (vw / vh < aspect) {
        var nw = Math.min(vh * aspect, vw * MAX_STRETCH);
        vx -= (nw - vw) / 2; vw = nw;
      } else {
        var nh = Math.min(vw / aspect, vh * MAX_STRETCH);
        vy -= (nh - vh) / 2; vh = nh;
      }
    }
    svg.setAttribute('viewBox', [vx, vy, vw, vh].join(' '));

    /* 海の余白が出ないよう、SVG 自体を地図とぴったり同じ形にする */
    var fit = Math.min(boxW / vw, boxH / vh);
    svg.style.width = Math.round(vw * fit) + 'px';
    svg.style.height = Math.round(vh * fit) + 'px';

    /* 重なり判定は経度だけ広げた範囲で行う */
    var lonBox = [vx, box[1] - 90, vx + vw, box[3] + 90];

    var land = '', target = '', mark = '';
    for (var n3 in global.GEO) {
      var shape = global.GEO[n3];
      for (var o = 0; o < OFFSETS.length; o++) {
        var off = OFFSETS[o];
        if (!intersects(shape.b, lonBox, off)) continue;
        var d = pathFor(n3, off);
        if (!d) continue;
        if (n3 === targetN3) target += '<path class="c-target" d="' + d + '"/>';
        else land += '<path d="' + d + '"/>';
      }
    }

    /* 画面に対して小さすぎる国は、丸い印で位置を示す */
    if (targetN3 && global.GEO[targetN3]) {
      var tb = global.GEO[targetN3].b;
      for (var q = 0; q < OFFSETS.length; q++) {
        if (!intersects(tb, lonBox, OFFSETS[q])) continue;
        var c = centerOf(targetN3, OFFSETS[q]);
        if (c.w < vw * 0.07 && c.h < vh * 0.07) {
          var r = Math.max(vw, vh) * 0.04;
          mark += '<circle class="c-mark" cx="' + c.x.toFixed(2) + '" cy="' + c.y.toFixed(2) +
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

  /** その国を含む大州の表示名 */
  function viewForRegion(region) {
    return VIEWS[region] ? region : 'world';
  }

  /* ---------------------------------------------------------------- *
   * 指でのドラッグ・ピンチ操作
   * ---------------------------------------------------------------- */
  function attachGestures(svg, getLayer) {
    var k = 1, tx = 0, ty = 0;
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
      layer.style.setProperty('--k', k);
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
          var pt = svg.createSVGPoint();
          pt.x = m.x; pt.y = m.y;
          var ctm = svg.getScreenCTM();
          if (ctm) {
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
    render: render,
    viewForRegion: viewForRegion,
    attachGestures: attachGestures,
    VIEWS: VIEWS
  };
})(window);
