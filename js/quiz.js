/* 出題ロジック（画面には触らない） */
(function (global) {
  'use strict';

  var REGIONS = [
    { id: 'world',          ja: '世界ぜんぶ',  en: 'World' },
    { id: 'asia',           ja: 'アジア',      en: 'Asia' },
    { id: 'europe',         ja: 'ヨーロッパ',  en: 'Europe' },
    { id: 'africa',         ja: 'アフリカ',    en: 'Africa' },
    { id: 'north-america',  ja: '北アメリカ',  en: 'North America' },
    { id: 'south-america',  ja: '南アメリカ',  en: 'South America' },
    { id: 'oceania',        ja: 'オセアニア',  en: 'Oceania' }
  ];

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /** 国旗の絵文字（🇯🇵 など）。ISO 2文字コードを地域指示記号に変換する。 */
  function flagEmoji(a2) {
    return String.fromCodePoint(
      0x1F1E6 + a2.charCodeAt(0) - 65,
      0x1F1E6 + a2.charCodeAt(1) - 65
    );
  }

  /** 表記設定にあわせた国名 */
  function label(country, lang) {
    if (lang === 'en') return country.en;
    if (lang === 'both') return country.ja + ' / ' + country.en;
    return country.ja;
  }

  /** 条件にあう国を集める */
  function pool(opts) {
    return global.COUNTRIES.filter(function (c) {
      if (c.level > opts.level) return false;
      if (opts.region !== 'world' && c.region !== opts.region) return false;
      if (opts.needMap && !c.hasMap) return false;
      return true;
    });
  }

  /**
   * まちがいの選択肢を選ぶ。
   * 同じ大州の国を優先し、足りなければ範囲を広げる（オセアニアのように
   * 国数が少ない大州でも必ず4択がそろうように）。
   */
  function distractors(answer, opts, n) {
    var taken = {}, out = [];
    taken[answer.a2] = true;

    var tiers = [
      global.COUNTRIES.filter(function (c) {
        return c.region === answer.region && c.level <= opts.level;
      }),
      global.COUNTRIES.filter(function (c) { return c.region === answer.region; }),
      global.COUNTRIES.filter(function (c) { return c.level <= opts.level; }),
      global.COUNTRIES
    ];

    for (var t = 0; t < tiers.length && out.length < n; t++) {
      var cands = shuffle(tiers[t]);
      for (var i = 0; i < cands.length && out.length < n; i++) {
        if (taken[cands[i].a2]) continue;
        taken[cands[i].a2] = true;
        out.push(cands[i]);
      }
    }
    return out;
  }

  /**
   * 問題を作る。
   * @param {{mode:'map'|'flag'|'mix', region:string, level:number, count:number}} opts
   * @returns {Array<{kind:'map'|'flag', answer:object, choices:object[]}>}
   */
  function build(opts) {
    var needMap = opts.mode === 'map';
    var base = pool({ region: opts.region, level: opts.level, needMap: needMap });
    if (!base.length) return [];

    var picked = shuffle(base);
    var wanted = Math.min(opts.count, picked.length);
    picked = picked.slice(0, wanted);

    return picked.map(function (answer) {
      var kind = opts.mode;
      if (kind === 'mix') kind = (answer.hasMap && Math.random() < 0.5) ? 'map' : 'flag';
      if (kind === 'map' && !answer.hasMap) kind = 'flag';
      var choices = shuffle([answer].concat(distractors(answer, opts, 3)));
      return { kind: kind, answer: answer, choices: choices };
    });
  }

  /** 復習用：まちがえた国だけで問題を作り直す */
  function rebuild(wrongCountries, opts) {
    return shuffle(wrongCountries).map(function (answer) {
      var kind = opts.mode === 'mix'
        ? (answer.hasMap && Math.random() < 0.5 ? 'map' : 'flag')
        : opts.mode;
      if (kind === 'map' && !answer.hasMap) kind = 'flag';
      return {
        kind: kind,
        answer: answer,
        choices: shuffle([answer].concat(distractors(answer, opts, 3)))
      };
    });
  }

  global.Quiz = {
    REGIONS: REGIONS,
    build: build,
    rebuild: rebuild,
    pool: pool,
    label: label,
    flagEmoji: flagEmoji,
    shuffle: shuffle,
    pick: pick
  };
})(window);
