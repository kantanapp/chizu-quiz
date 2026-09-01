/* 画面の組み立てと進行 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE_SETTINGS = 'chizu-quiz:settings:v2';
  var STORE_RECORDS  = 'chizu-quiz:records:v1';

  var DEFAULTS = {
    area: 'world',
    /* 世界 */
    mode: 'map', region: 'world', level: 1, lang: 'ja', count: 10,
    /* 日本 */
    jmode: 'jmap', jregion: 'all', jlabel: 'kanji', jcount: 10, guide: 'on'
  };

  /* 地図の見え方。押すたびに 寄り → 地方全体 → 全体 と切り替わる */
  var VIEW_STEPS = ['fit', 'region', 'whole'];

  var settings = load(STORE_SETTINGS, DEFAULTS);
  var state = null;      // 進行中のクイズ
  var gestures = null;   // 地図の指操作
  var pad = null;        // 漢字を書く欄

  /* ---------------------------------------------------------------- *
   * 保存
   * ---------------------------------------------------------------- */
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      var out = JSON.parse(JSON.stringify(fallback));
      if (!raw) return out;
      var v = JSON.parse(raw);
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
      var one = ctx.measureText('🇬').width;
      var two = ctx.measureText('🇬🇧').width;
      return two > 0 && two < one * 1.6;
    } catch (e) { return false; }
  })();

  function flagHTML(country) {
    if (FLAG_EMOJI_OK) return Quiz.flagEmoji(country.a2);
    return '<img src="https://flagcdn.com/w320/' + country.a2.toLowerCase() +
           '.png" alt="' + country.ja + 'の国旗" loading="lazy">';
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
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

  var isJapan = function () { return settings.area === 'japan'; };

  /* ---------------------------------------------------------------- *
   * ホーム画面の設定 UI
   * ---------------------------------------------------------------- */
  function buildRegionOptions() {
    var html = '';
    Quiz.REGIONS.forEach(function (r) {
      html += '<button type="button" role="radio" data-value="' + r.id + '">' + r.ja + '</button>';
    });
    $('opts-region').innerHTML = html;

    html = '';
    Quiz.JP_REGIONS.forEach(function (r) {
      html += '<button type="button" role="radio" data-value="' + r.id + '">' + r.ja + '</button>';
    });
    $('opts-jregion').innerHTML = html;
  }

  function syncSettingsUI() {
    $('set-world').hidden = isJapan();
    $('set-japan').hidden = !isJapan();
    /* 漢字を書く問題があるときだけ、お手本の設定を出す */
    $('field-guide').hidden = !(settings.jmode === 'jwrite' || settings.jmode === 'mix');

    var groups = document.querySelectorAll('#settings .opts');
    for (var i = 0; i < groups.length; i++) {
      var key = groups[i].dataset.key;
      var btns = groups[i].querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        btns[j].setAttribute('aria-checked',
          String(settings[key]) === btns[j].dataset.value ? 'true' : 'false');
      }
    }
    updatePoolNote();
    updateRecord();
  }

  function regionLabel(id) {
    var all = Quiz.REGIONS.concat(Quiz.JP_REGIONS);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].ja;
    return id;
  }
  function levelLabel(lv) { return { 1: '基本', 2: '標準', 3: 'すべて' }[lv] || ''; }

  function updatePoolNote() {
    if (isJapan()) {
      var jn = Quiz.jpPool({
        region: settings.jregion, needMap: true,
        needWrite: settings.jmode === 'jwrite'
      }).length;
      var note = regionLabel(settings.jregion) + 'で ' + jn + '県が対象です。';
      if (jn < settings.jcount) note += ' 全部で ' + jn + '問になります。';
      if (settings.jmode === 'jwrite' || settings.jmode === 'mix') {
        note += settings.guide === 'on'
          ? ' 漢字はお手本をなぞって書きます。'
          : ' 漢字はお手本なしで書きます。';
      }
      $('pool-note').textContent = note;
      return;
    }
    [1, 2, 3].forEach(function (lv) {
      $('lv' + lv + '-count').textContent =
        Quiz.pool({ region: settings.region, level: lv, needMap: false }).length + 'か国';
    });
    var needMap = settings.mode === 'map';
    var n = Quiz.pool({ region: settings.region, level: settings.level, needMap: needMap }).length;
    var t = regionLabel(settings.region) + '・' + levelLabel(settings.level) + 'で ' + n + 'か国が対象です。';
    if (needMap) t += '（地図に描けない小さな国はのぞきます）';
    if (n < settings.count) t += ' 全部で ' + n + '問になります。';
    $('pool-note').textContent = t;
  }

  /* ---------------------------------------------------------------- *
   * 記録
   * ---------------------------------------------------------------- */
  function recordKey() {
    return isJapan()
      ? ['jp', settings.jmode, settings.jregion, settings.jcount, settings.guide].join('|')
      : ['w', settings.mode, settings.region, settings.level, settings.count].join('|');
  }
  function updateRecord() {
    var r = loadRaw(STORE_RECORDS, {})[recordKey()];
    if (!r) { $('record').hidden = true; return; }
    $('record').hidden = false;
    $('record-body').textContent =
      'ベスト ' + r.best + '%（' + r.plays + '回ちょうせん／前回 ' + r.last + '%）';
  }
  function saveRecord(pct) {
    var recs = loadRaw(STORE_RECORDS, {});
    var r = recs[recordKey()] || { best: 0, plays: 0, last: 0 };
    r.plays += 1;
    r.last = pct;
    if (pct > r.best) r.best = pct;
    recs[recordKey()] = r;
    save(STORE_RECORDS, recs);
  }

  /* ---------------------------------------------------------------- *
   * クイズの進行
   * ---------------------------------------------------------------- */
  function startQuiz(questions) {
    if (!questions.length) {
      alert('この条件では問題が作れません。範囲を変えてください。');
      return;
    }
    state = { questions: questions, i: 0, correct: 0, wrong: [], answered: false, viewStep: 0 };
    show('screen-quiz');
    renderQuestion();
  }

  function currentQ() { return state.questions[state.i]; }
  var isJpKind = function (kind) { return kind.charAt(0) === 'j'; };

  function renderQuestion() {
    var q = currentQ();
    state.answered = false;
    state.viewStep = 0;
    if (pad) pad = null;

    $('q-index').textContent = (state.i + 1) + ' / ' + state.questions.length;
    $('q-score').textContent = '◯ ' + state.correct;
    $('progress-fill').style.width = (state.i / state.questions.length * 100) + '%';
    $('feedback').hidden = true;

    var write = q.kind === 'jwrite';
    $('writebox').hidden = !write;
    $('choices').hidden = write;
    $('stage').classList.toggle('is-compact', write);

    /* 選択肢を先に並べてから地図を描く（残りの高さから大きさを決めるため） */
    if (!write) renderChoices(q);

    if (q.kind === 'flag') {
      $('prompt').textContent = 'この国旗はどこの国？';
      $('stage-map').hidden = true;
      $('stage-flag').hidden = false;
      $('flag').innerHTML = flagHTML(q.answer);
    } else {
      $('prompt').textContent =
        q.kind === 'map'    ? 'オレンジ色の国はどこ？' :
        q.kind === 'jmap'   ? 'オレンジ色の県はどこ？' :
        q.kind === 'jcap'   ? 'この県の県庁所在地は？' :
                              'オレンジ色の県を漢字で書こう';
      $('stage-map').hidden = false;
      $('stage-flag').hidden = true;
      drawMap();
    }

    if (write) startWriting(q);
  }

  function drawMap() {
    var q = currentQ();
    var svg = $('map');
    var a = WorldMap.atlas(isJpKind(q.kind) ? 'japan' : 'world');
    var id = isJpKind(q.kind) ? q.answer.code : q.answer.n3;
    var region = q.answer.region;
    var step = VIEW_STEPS[state.viewStep];
    var view = step === 'fit'    ? WorldMap.fitView(a, id)
             : step === 'region' ? WorldMap.regionView(a, region)
             :                     WorldMap.wholeView(a);
    WorldMap.render(svg, a, view, id, $('stage-map'));
    if (!gestures) {
      gestures = WorldMap.attachGestures(svg, function () { return svg.querySelector('.c-layer'); });
    }
    gestures.reset();

    /* ボタンには「次に何が見えるか」を出す */
    var next = VIEW_STEPS[(state.viewStep + 1) % VIEW_STEPS.length];
    $('btn-view').textContent =
      next === 'fit'    ? '🔍 寄って見る' :
      next === 'region' ? '🗺️ ' + regionLabel(region) + '全体' :
                          (isJpKind(q.kind) ? '🗾 日本全体' : '🌏 世界地図');
    $('btn-reset').hidden = true;
  }

  function choiceText(q, c) {
    if (isJpKind(q.kind)) {
      return q.kind === 'jcap' ? Quiz.jpCapLabel(c, settings.jlabel)
                               : Quiz.jpLabel(c, settings.jlabel);
    }
    return Quiz.label(c, settings.lang);
  }

  function renderChoices(q) {
    var box = $('choices');
    box.innerHTML = '';
    q.choices.forEach(function (choice) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = isJpKind(q.kind) ? choice.code : choice.a2;
      if (!isJpKind(q.kind) && settings.lang === 'both') {
        b.innerHTML = escapeHTML(choice.ja) + '<span class="en">' + escapeHTML(choice.en) + '</span>';
      } else {
        b.textContent = choiceText(q, choice);
      }
      b.addEventListener('click', function () { answer(choice, b); });
      box.appendChild(b);
    });
  }

  function answerId(q, c) { return isJpKind(q.kind) ? c.code : c.a2; }

  function answer(choice, btn) {
    if (state.answered) return;
    var q = currentQ();
    var ok = answerId(q, choice) === answerId(q, q.answer);
    var btns = $('choices').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    btn.classList.add(ok ? 'is-ok' : 'is-ng');
    if (!ok) {
      for (var j = 0; j < btns.length; j++) {
        if (btns[j].dataset.id === answerId(q, q.answer)) btns[j].classList.add('is-ok');
      }
    }
    finishQuestion(ok, '');
  }

  /** 問題を締める。ok=正解、note=フィードバックに足す一言 */
  function finishQuestion(ok, note) {
    if (state.answered) return;
    state.answered = true;
    var q = currentQ();

    if (ok) state.correct++;
    else state.wrong.push({ kind: q.kind, answer: q.answer });
    $('q-score').textContent = '◯ ' + state.correct;

    var name, sub;
    if (isJpKind(q.kind)) {
      var p = q.answer;
      if (q.kind === 'jcap') {
        name = (ok ? '' : '正解は ') + p.capFull;
        sub = p.full + 'の県庁所在地・' + p.capYomi;
      } else {
        name = (ok ? '' : '正解は ') + p.full;
        sub = p.yomi + '　/　県庁所在地 ' + p.capFull;
      }
    } else {
      name = (ok ? '' : '正解は ') + q.answer.ja;
      sub = q.answer.en + '　/　' + regionLabel(q.answer.region);
    }
    if (note) sub += '　/　' + note;

    $('fb-mark').textContent = ok ? '◯' : '✕';
    $('fb-mark').className = 'feedback-mark ' + (ok ? 'ok' : 'ng');
    $('fb-name').textContent = name;
    $('fb-sub').textContent = sub;
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
   * 漢字を書く問題
   * ---------------------------------------------------------------- */
  function startWriting(q) {
    pad = KanjiPad.create({
      strip: $('k-strip'),
      pad: $('k-pad'),
      chars: q.answer.name.split(''),
      suffix: q.answer.suffix,
      guide: settings.guide === 'on',
      onComplete: function (r) {
        var note = r.hints ? 'ヒント ' + r.hints + '回' : '';
        finishQuestion(true, note);
      }
    });
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
      pct >= 50  ? 'あと少し。まちがえたところを見直そう。' :
                   'まずは「いちらん」で見てからもう一度。';

    $('wrong-box').hidden = state.wrong.length === 0;
    $('btn-review').hidden = state.wrong.length === 0;

    var html = '';
    state.wrong.forEach(function (w) {
      if (isJpKind(w.kind)) {
        var p = w.answer;
        var main = w.kind === 'jcap' ? p.full + ' → ' + p.capFull : p.full;
        var sub = w.kind === 'jcap' ? p.capYomi : p.yomi;
        html += '<li><span class="cflag">' + KanjiPad.charSVG(p.name.charAt(0), 'k-chip') + '</span>' +
                '<span class="cname">' + escapeHTML(main) +
                '<span class="en">' + escapeHTML(sub) + '</span></span></li>';
      } else {
        html += '<li><span class="cflag">' + flagHTML(w.answer) + '</span>' +
                '<span class="cname">' + escapeHTML(w.answer.ja) +
                '<span class="en">' + escapeHTML(w.answer.en) + '</span></span></li>';
      }
    });
    $('wrong-list').innerHTML = html;
    show('screen-result');
  }

  /* ---------------------------------------------------------------- *
   * いちらん
   * ---------------------------------------------------------------- */
  function openList() {
    $('list-title').textContent = isJapan()
      ? regionLabel(settings.jregion) + 'の都道府県'
      : regionLabel(settings.region) + '（' + levelLabel(settings.level) + '）';
    $('list-search').value = '';
    $('list-search').placeholder = isJapan() ? '県名でさがす' : '国名でさがす（日本語 / English）';
    renderList('');
    show('screen-list');
  }

  function renderList(query) {
    var q = query.trim().toLowerCase();
    var html = '';

    if (isJapan()) {
      Quiz.jpPool({ region: settings.jregion })
        .filter(function (p) {
          return !q || (p.full + p.yomi + p.capFull + p.capYomi).toLowerCase().indexOf(q) >= 0;
        })
        .forEach(function (p) {
          html += '<li><span class="cflag">' + KanjiPad.charSVG(p.name.charAt(0), 'k-chip') + '</span>' +
                  '<span class="cname">' + escapeHTML(p.full) +
                  '<span class="en">' + escapeHTML(p.yomi) + '</span></span>' +
                  '<span class="cregion">' + escapeHTML(p.capFull) +
                  (p.diff ? '' : '<br>（県名と同じ）') + '</span></li>';
        });
    } else {
      Quiz.pool({ region: settings.region, level: settings.level, needMap: false })
        .filter(function (c) {
          return !q || (c.ja + c.en + c.a2).toLowerCase().indexOf(q) >= 0;
        })
        .sort(function (a, b) { return a.ja.localeCompare(b.ja, 'ja'); })
        .forEach(function (c) {
          html += '<li><span class="cflag">' + flagHTML(c) + '</span>' +
                  '<span class="cname">' + escapeHTML(c.ja) +
                  '<span class="en">' + escapeHTML(c.en) + '</span></span>' +
                  (settings.region === 'world'
                    ? '<span class="cregion">' + regionLabel(c.region) + '</span>' : '') +
                  '</li>';
        });
    }
    $('country-list').innerHTML = html || '<li><span class="cname">みつかりませんでした</span></li>';
  }

  /* ---------------------------------------------------------------- *
   * 出題を組み立てる
   * ---------------------------------------------------------------- */
  function buildQuestions() {
    return isJapan()
      ? Quiz.buildJapan({ mode: settings.jmode, region: settings.jregion, count: settings.jcount })
      : Quiz.build({ mode: settings.mode, region: settings.region,
                     level: settings.level, count: settings.count });
  }

  function rebuildWrong() {
    var jp = state.wrong.filter(function (w) { return isJpKind(w.kind); })
                        .map(function (w) { return w.answer; });
    if (isJapan()) {
      return Quiz.rebuildJapan(jp, { mode: settings.jmode, region: settings.jregion });
    }
    return Quiz.rebuild(state.wrong.map(function (w) { return w.answer; }),
                        { mode: settings.mode, region: settings.region, level: settings.level });
  }

  /* ---------------------------------------------------------------- *
   * イベント
   * ---------------------------------------------------------------- */
  function init() {
    buildRegionOptions();

    $('settings').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-value]');
      if (!btn) return;
      var key = btn.parentNode.dataset.key;
      var val = btn.dataset.value;
      settings[key] = (key === 'level' || key === 'count' || key === 'jcount') ? Number(val) : val;
      save(STORE_SETTINGS, settings);
      syncSettingsUI();
    });

    $('btn-start').addEventListener('click', function () { startQuiz(buildQuestions()); });
    $('btn-again').addEventListener('click', function () { startQuiz(buildQuestions()); });
    $('btn-review').addEventListener('click', function () { startQuiz(rebuildWrong()); });
    $('btn-home').addEventListener('click', function () { show('screen-home'); syncSettingsUI(); });

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
      state.viewStep = (state.viewStep + 1) % VIEW_STEPS.length;
      drawMap();
    });
    $('btn-reset').addEventListener('click', function () { if (gestures) gestures.reset(); });
    $('map').addEventListener('pointermove', function () {
      if (gestures) $('btn-reset').hidden = !gestures.isZoomed();
    });

    $('btn-k-clear').addEventListener('click', function () { if (pad) pad.clear(); });
    $('btn-k-hint').addEventListener('click', function () { if (pad) pad.hint(); });
    $('btn-k-answer').addEventListener('click', function () {
      if (!pad || state.answered) return;
      var r = pad.submit();
      var note = r.ok
        ? (r.hints ? 'ヒント ' + r.hints + '回' : '')
        : (r.written ? r.total + '画のうち ' + r.written + '画' : '');
      finishQuestion(r.ok, note);
    });

    /* 画面の向きが変わったら地図を描き直す */
    window.addEventListener('resize', function () {
      if (!state || !$('screen-quiz').classList.contains('is-active')) return;
      if (currentQ().kind !== 'flag') drawMap();
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
