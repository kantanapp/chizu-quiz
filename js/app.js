/* 画面の組み立てと進行 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE_SETTINGS = 'chizu-quiz:settings:v1';
  var STORE_RECORDS  = 'chizu-quiz:records:v1';

  var DEFAULTS = { mode: 'map', region: 'world', level: 1, lang: 'ja', count: 10 };

  var settings = load(STORE_SETTINGS, DEFAULTS);
  var state = null;      // 進行中のクイズ
  var gestures = null;   // 地図の指操作

  /* ---------------------------------------------------------------- *
   * 保存
   * ---------------------------------------------------------------- */
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return JSON.parse(JSON.stringify(fallback));
      var v = JSON.parse(raw);
      var out = JSON.parse(JSON.stringify(fallback));
      for (var k in fallback) if (k in v) out[k] = v[k];
      return out;
    } catch (e) { return JSON.parse(JSON.stringify(fallback)); }
  }
  /** そのまま読む（記録のように、あらかじめ決まった形がないもの用） */
  function loadRaw(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 無視 */ }
  }

  /* ---------------------------------------------------------------- *
   * 国旗（絵文字が使えない環境では画像にする）
   * ---------------------------------------------------------------- */
  var FLAG_EMOJI_OK = (function () {
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return false;
      ctx.font = '32px sans-serif';
      var one = ctx.measureText('🇬').width;                 /* 🇬 単体 */
      var two = ctx.measureText('🇬🇧').width;     /* 🇬🇧 */
      return two > 0 && two < one * 1.6;
    } catch (e) { return false; }
  })();

  function flagHTML(country) {
    if (FLAG_EMOJI_OK) return Quiz.flagEmoji(country.a2);
    return '<img src="https://flagcdn.com/w320/' + country.a2.toLowerCase() +
           '.png" alt="' + country.ja + 'の国旗" loading="lazy">';
  }

  /* ---------------------------------------------------------------- *
   * 画面切り替え
   * ---------------------------------------------------------------- */
  function show(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('is-active');
    $(id).classList.add('is-active');
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- *
   * ホーム画面の設定 UI
   * ---------------------------------------------------------------- */
  function buildRegionOptions() {
    var html = '';
    for (var i = 0; i < Quiz.REGIONS.length; i++) {
      var r = Quiz.REGIONS[i];
      html += '<button type="button" role="radio" data-value="' + r.id + '">' + r.ja + '</button>';
    }
    $('opts-region').innerHTML = html;
  }

  function syncSettingsUI() {
    var groups = document.querySelectorAll('#settings .opts');
    for (var i = 0; i < groups.length; i++) {
      var key = groups[i].dataset.key;
      var btns = groups[i].querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        var on = String(settings[key]) === btns[j].dataset.value;
        btns[j].setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    updatePoolNote();
    updateRecord();
  }

  function countFor(level) {
    return Quiz.pool({ region: settings.region, level: level, needMap: false }).length;
  }

  function updatePoolNote() {
    $('lv1-count').textContent = countFor(1) + 'か国';
    $('lv2-count').textContent = countFor(2) + 'か国';
    $('lv3-count').textContent = countFor(3) + 'か国';

    var needMap = settings.mode === 'map';
    var n = Quiz.pool({ region: settings.region, level: settings.level, needMap: needMap }).length;
    var regionName = regionLabel(settings.region);

    var note = regionName + '・' + levelLabel(settings.level) + 'で ' + n + 'か国が対象です。';
    if (needMap) note += '（地図に描けない小さな国はのぞきます）';
    if (n < settings.count) note += ' 全部で ' + n + '問になります。';
    $('pool-note').textContent = note;
  }

  function regionLabel(id) {
    for (var i = 0; i < Quiz.REGIONS.length; i++) {
      if (Quiz.REGIONS[i].id === id) return Quiz.REGIONS[i].ja;
    }
    return id;
  }
  function levelLabel(lv) { return { 1: '基本', 2: '標準', 3: 'すべて' }[lv] || ''; }
  function modeLabel(m) { return { map: '地図', flag: '国旗', mix: 'ミックス' }[m] || ''; }

  /* ---------------------------------------------------------------- *
   * 記録
   * ---------------------------------------------------------------- */
  function recordKey() {
    return [settings.mode, settings.region, settings.level, settings.count].join('|');
  }
  function updateRecord() {
    var recs = loadRaw(STORE_RECORDS, {});
    var r = recs[recordKey()];
    if (!r) { $('record').hidden = true; return; }
    $('record').hidden = false;
    $('record-body').textContent =
      'ベスト ' + r.best + '%（' + r.plays + '回ちょうせん／前回 ' + r.last + '%）';
  }
  function saveRecord(pct) {
    var recs = loadRaw(STORE_RECORDS, {});
    var key = recordKey();
    var r = recs[key] || { best: 0, plays: 0, last: 0 };
    r.plays += 1;
    r.last = pct;
    if (pct > r.best) r.best = pct;
    recs[key] = r;
    save(STORE_RECORDS, recs);
  }

  /* ---------------------------------------------------------------- *
   * クイズの進行
   * ---------------------------------------------------------------- */
  function startQuiz(questions) {
    if (!questions.length) {
      alert('この条件では問題が作れません。範囲かレベルを変えてください。');
      return;
    }
    state = { questions: questions, i: 0, correct: 0, wrong: [], answered: false, worldView: false };
    show('screen-quiz');
    renderQuestion();
  }

  function currentQ() { return state.questions[state.i]; }

  function renderQuestion() {
    var q = currentQ();
    state.answered = false;
    state.worldView = false;

    $('q-index').textContent = (state.i + 1) + ' / ' + state.questions.length;
    $('q-score').textContent = '◯ ' + state.correct;
    $('progress-fill').style.width = (state.i / state.questions.length * 100) + '%';

    /* 地図の大きさは残りの高さから計算するので、
       先に選択肢を並べてレイアウトを確定させてから描く。 */
    renderChoices(q);
    $('feedback').hidden = true;

    if (q.kind === 'map') {
      $('prompt').textContent = 'オレンジ色の国はどこ？';
      $('stage-map').hidden = false;
      $('stage-flag').hidden = true;
      drawMap();
    } else {
      $('prompt').textContent = 'この国旗はどこの国？';
      $('stage-map').hidden = true;
      $('stage-flag').hidden = false;
      $('flag').innerHTML = flagHTML(q.answer);
    }
  }

  function drawMap() {
    var q = currentQ();
    var svg = $('map');
    var view = state.worldView ? 'world' : WorldMap.viewForRegion(q.answer.region);
    WorldMap.render(svg, view, q.answer.n3, $('stage-map'));
    if (!gestures) {
      gestures = WorldMap.attachGestures(svg, function () { return svg.querySelector('.c-layer'); });
    }
    gestures.reset();
    $('btn-view').textContent = state.worldView
      ? '🔍 ' + regionLabel(q.answer.region) + 'で見る'
      : '🌏 世界で見る';
    $('btn-reset').hidden = true;
  }

  function renderChoices(q) {
    var box = $('choices');
    box.innerHTML = '';
    for (var i = 0; i < q.choices.length; i++) {
      (function (choice) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.a2 = choice.a2;
        if (settings.lang === 'both') {
          b.innerHTML = escapeHTML(choice.ja) + '<span class="en">' + escapeHTML(choice.en) + '</span>';
        } else {
          b.textContent = Quiz.label(choice, settings.lang);
        }
        b.addEventListener('click', function () { answer(choice, b); });
        box.appendChild(b);
      })(q.choices[i]);
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function answer(choice, btn) {
    if (state.answered) return;
    state.answered = true;

    var q = currentQ();
    var ok = choice.a2 === q.answer.a2;
    var btns = $('choices').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;

    btn.classList.add(ok ? 'is-ok' : 'is-ng');
    if (!ok) {
      /* 正解のボタンにも印をつける */
      for (var j = 0; j < btns.length; j++) {
        if (btns[j].dataset.a2 === q.answer.a2) btns[j].classList.add('is-ok');
      }
      state.wrong.push(q.answer);
    } else {
      state.correct++;
    }
    $('q-score').textContent = '◯ ' + state.correct;

    $('fb-mark').textContent = ok ? '◯' : '✕';
    $('fb-mark').className = 'feedback-mark ' + (ok ? 'ok' : 'ng');
    $('fb-name').textContent = (ok ? '' : '正解は ') + q.answer.ja;
    $('fb-sub').textContent = q.answer.en + '　/　' + regionLabel(q.answer.region);
    $('feedback').hidden = false;
    $('btn-next').textContent = (state.i + 1 >= state.questions.length) ? '結果を見る' : '次へ';
    $('btn-next').focus();
  }

  function next() {
    state.i++;
    if (state.i >= state.questions.length) { finish(); return; }
    renderQuestion();
  }

  /* ---------------------------------------------------------------- *
   * 結果
   * ---------------------------------------------------------------- */
  function finish() {
    var total = state.questions.length;
    var pct = Math.round(state.correct / total * 100);
    saveRecord(pct);

    $('score-pct').textContent = pct + '%';
    $('score-ring').style.borderColor =
      pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--accent)' : 'var(--ng)';
    $('score-raw').textContent = state.correct + ' / ' + total;
    $('result-msg').textContent =
      pct === 100 ? '全問正解！すごい 🎉' :
      pct >= 80  ? 'よくできました！' :
      pct >= 50  ? 'あと少し。まちがえた国を見直そう。' :
                   'まずは「国いちらん」で見てからもう一度。';

    var wrong = state.wrong;
    $('wrong-box').hidden = wrong.length === 0;
    $('btn-review').hidden = wrong.length === 0;

    var html = '';
    for (var i = 0; i < wrong.length; i++) {
      html += '<li><span class="cflag">' + flagHTML(wrong[i]) + '</span>' +
              '<span class="cname">' + escapeHTML(wrong[i].ja) +
              '<span class="en">' + escapeHTML(wrong[i].en) + '</span></span></li>';
    }
    $('wrong-list').innerHTML = html;

    show('screen-result');
  }

  /* ---------------------------------------------------------------- *
   * 国いちらん
   * ---------------------------------------------------------------- */
  function openList() {
    $('list-title').textContent =
      regionLabel(settings.region) + '（' + levelLabel(settings.level) + '）';
    $('list-search').value = '';
    renderList('');
    show('screen-list');
  }

  function renderList(query) {
    var q = query.trim().toLowerCase();
    var items = Quiz.pool({ region: settings.region, level: settings.level, needMap: false })
      .filter(function (c) {
        if (!q) return true;
        return c.ja.toLowerCase().indexOf(q) >= 0 ||
               c.en.toLowerCase().indexOf(q) >= 0 ||
               c.a2.toLowerCase().indexOf(q) >= 0;
      })
      .sort(function (a, b) { return a.ja.localeCompare(b.ja, 'ja'); });

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      html += '<li><span class="cflag">' + flagHTML(c) + '</span>' +
              '<span class="cname">' + escapeHTML(c.ja) +
              '<span class="en">' + escapeHTML(c.en) + '</span></span>' +
              (settings.region === 'world'
                 ? '<span class="cregion">' + regionLabel(c.region) + '</span>' : '') +
              '</li>';
    }
    $('country-list').innerHTML = html || '<li><span class="cname">みつかりませんでした</span></li>';
  }

  /* ---------------------------------------------------------------- *
   * イベント
   * ---------------------------------------------------------------- */
  function init() {
    buildRegionOptions();

    document.getElementById('settings').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-value]');
      if (!btn) return;
      var key = btn.parentNode.dataset.key;
      var val = btn.dataset.value;
      settings[key] = (key === 'level' || key === 'count') ? Number(val) : val;
      save(STORE_SETTINGS, settings);
      syncSettingsUI();
    });

    $('btn-start').addEventListener('click', function () {
      startQuiz(Quiz.build({
        mode: settings.mode,
        region: settings.region,
        level: settings.level,
        count: settings.count
      }));
    });

    $('btn-list').addEventListener('click', openList);
    $('btn-list-close').addEventListener('click', function () { show('screen-home'); });
    $('list-search').addEventListener('input', function () { renderList(this.value); });

    $('btn-next').addEventListener('click', next);
    $('btn-quit').addEventListener('click', function () {
      if (state && state.i > 0 && !confirm('とちゅうでやめますか？')) return;
      show('screen-home');
      syncSettingsUI();
    });

    $('btn-view').addEventListener('click', function () {
      state.worldView = !state.worldView;
      drawMap();
    });
    $('btn-reset').addEventListener('click', function () { if (gestures) gestures.reset(); });
    $('map').addEventListener('pointermove', function () {
      if (gestures) $('btn-reset').hidden = !gestures.isZoomed();
    });

    $('btn-again').addEventListener('click', function () {
      startQuiz(Quiz.build({
        mode: settings.mode, region: settings.region,
        level: settings.level, count: settings.count
      }));
    });
    $('btn-review').addEventListener('click', function () {
      startQuiz(Quiz.rebuild(state.wrong, {
        mode: settings.mode, region: settings.region, level: settings.level
      }));
    });
    $('btn-home').addEventListener('click', function () {
      show('screen-home');
      syncSettingsUI();
    });

    /* 画面の向きが変わったら地図を描き直す */
    window.addEventListener('resize', function () {
      if (state && !$('screen-quiz').classList.contains('is-active')) return;
      if (state && currentQ().kind === 'map') drawMap();
    });

    syncSettingsUI();

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 無視 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
