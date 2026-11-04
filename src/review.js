/* 検討エンジン: 1手ごとの採点とミス検出 / 局後レポート */
(function (global) {
  'use strict';
  var C = global.MJCore, AI = global.MJAI;

  function tl(t) { return C.typeLabel(t); }
  function tileListStr(tiles, max) {
    max = max || 7;
    var head = tiles.slice(0, max).map(function (x) { return tl(x.type) + (x.count != null ? '×' + x.count : ''); }).join('・');
    if (tiles.length > max) head += ' 他' + (tiles.length - max) + '種';
    return head;
  }
  function doraSet(view) {
    var s = {};
    for (var i = 0; i < view.doraInd.length; i++) s[C.doraFromIndicator(view.doraInd[i])] = 1;
    return s;
  }
  function isYakuhai(view, t) { return C.isDragon(t) || t === view.seatWind || t === view.roundWind; }

  // 保持価値(ドラ・役牌を切るのを少し嫌う)
  function keepPenalty(view, counts, t, dora) {
    var v = 0;
    if (dora[t]) v += 4;
    if (isYakuhai(view, t) && counts[t] >= 2) v += 4;
    else if (isYakuhai(view, t)) v += 1;
    return v;
  }

  function threatList(view) {
    var out = [];
    for (var p = 0; p < 4; p++) {
      if (p === view.me) continue;
      var pd = view.players[p];
      if (pd.riichi) out.push({ p: p, kind: 'riichi' });
      else if (pd.melds.length >= 3) out.push({ p: p, kind: 'melds' });
    }
    return out;
  }
  var SEAT_NAME = ['自分', '下家', '対面', '上家'];
  function rel(view, p) { return SEAT_NAME[(p - view.me + 4) % 4]; }

  function safeTilesAmong(view, ids) {
    var out = [];
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      var t = C.idToType(ids[i]);
      if (seen[t]) continue;
      seen[t] = 1;
      if (AI.tileDanger(view, t) < 0.05) out.push(t);
    }
    return out;
  }

  /* ---------- 打牌の分析 ---------- */
  function analyzeDiscard(view, opts, chosenId) {
    var chosen = C.idToType(chosenId);
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var dora = doraSet(view);
    var allowed = {};
    for (var i = 0; i < opts.discardable.length; i++) allowed[C.idToType(opts.discardable[i])] = 1;
    var cands = C.discardOptions(counts, melds, view.seen).filter(function (c) { return allowed[c.tile]; });
    if (!cands.length) return null;

    var bestSh = cands[0].shanten;
    var pool = cands.filter(function (c) { return c.shanten === bestSh; });
    var maxUk = 0;
    for (i = 0; i < pool.length; i++) maxUk = Math.max(maxUk, pool[i].ukeire);
    var ukBest = pool.filter(function (c) { return c.ukeire === maxUk; });

    // 価値補正つき推奨
    var scored = pool.map(function (c) {
      return { c: c, s: c.ukeire - keepPenalty(view, counts, c.tile, dora) };
    }).sort(function (a, b) { return b.s - a.s; });
    var recommend = scored[0].c;

    var mine = null;
    for (i = 0; i < cands.length; i++) if (cands[i].tile === chosen) mine = cands[i];
    if (!mine) return null;

    var threats = threatList(view);
    var hasRiichi = threats.some(function (x) { return x.kind === 'riichi'; });
    var dangerChosen = AI.tileDanger(view, chosen);
    var safeOpts = safeTilesAmong(view, opts.discardable);
    var go = Math.floor(view.turnCount / 4) + 1;

    var rec = {
      kind: 'discard',
      kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba,
      go: go, turnCount: view.turnCount,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)),
      drawn: view.drawn,
      chosen: chosen, chosenId: chosenId,
      shantenBefore: C.shanten(counts, melds),
      chosenShanten: mine.shanten, chosenUkeire: mine.ukeire, chosenTiles: mine.tiles,
      bestShanten: bestSh, bestUkeire: maxUk,
      ukBestTiles: ukBest.map(function (c) { return c.tile; }),
      recommend: recommend.tile, recommendUkeire: recommend.ukeire, recommendTiles: recommend.tiles,
      danger: dangerChosen, safeOptions: safeOpts,
      threats: threats, doraInd: view.doraInd.slice(),
      severity: null, category: null, comment: ''
    };

    var shLoss = mine.shanten - bestSh;
    var ukLoss = (mine.shanten === bestSh) ? (maxUk - mine.ukeire) : null;
    rec.shantenLoss = shLoss;
    rec.ukeireLoss = ukLoss;

    // --- 押し引き優先の判定 ---
    if (hasRiichi) {
      var who = threats.filter(function (x) { return x.kind === 'riichi'; })
        .map(function (x) { return rel(view, x.p); }).join('・');
      if (bestSh >= 2 && dangerChosen >= 0.35 && safeOpts.length > 0) {
        rec.severity = 'high'; rec.category = 'push';
        rec.comment = who + 'のリーチに対し、' + bestSh + '向聴から危険牌の' + tl(chosen) + 'を切っています。'
          + 'この手はもう和了が遠いのでベタオリが正着。現物が ' + safeOpts.map(tl).join('・') + ' にあります。';
        return rec;
      }
      if (bestSh <= 1 && dangerChosen >= 0.35) {
        var saferEqual = pool.filter(function (c) {
          return c.ukeire >= mine.ukeire && AI.tileDanger(view, c.tile) < dangerChosen - 0.15;
        });
        if (saferEqual.length) {
          rec.severity = 'low'; rec.category = 'push';
          rec.comment = '押すのは妥当ですが、同じ受け入れでより安全な ' + tl(saferEqual[0].c.tile)
            + ' がありました(' + tl(chosen) + 'は無筋)。';
          return rec;
        }
        rec.severity = null; rec.category = 'ok-push';
        rec.comment = bestSh === 0 ? 'テンパイなので押して問題なし。' : '1向聴の押し。危険牌だが許容範囲。';
        return rec;
      }
      if (dangerChosen < 0.05 && bestSh >= 2) {
        rec.severity = null; rec.category = 'ok-fold';
        rec.comment = 'リーチに対して現物を選択。正しいベタオリです。';
        return rec;
      }
    }

    // --- 牌効率の判定 ---
    if (shLoss > 0) {
      rec.severity = bestSh >= 3 ? 'mid' : 'high'; rec.category = 'shanten';
      rec.comment = tl(chosen) + 'を切るとシャンテン数が ' + bestSh + '向聴 → ' + mine.shanten
        + '向聴に後退します。' + tl(recommend.tile) + '切りなら' + bestSh + '向聴を維持（受け入れ'
        + recommend.ukeire + '枚: ' + tileListStr(recommend.tiles) + '）。';
      return rec;
    }
    if (ukLoss > 0) {
      var just = keepPenalty(view, counts, chosen, dora) === 0 ? '' : 'ドラ/役牌を残す意味はありますが、';
      var thMid = bestSh >= 3 ? 14 : 6, thLow = bestSh >= 3 ? 8 : 3;
      if (ukLoss >= thMid) {
        rec.severity = 'mid'; rec.category = 'efficiency';
        rec.comment = just + tl(chosen) + '切りは受け入れ' + mine.ukeire + '枚('
          + tileListStr(mine.tiles) + ')。' + tl(recommend.tile) + '切りなら' + recommend.ukeire + '枚('
          + tileListStr(recommend.tiles) + ')で' + ukLoss + '枚広いです。';
        return rec;
      }
      if (ukLoss >= thLow) {
        rec.severity = 'low'; rec.category = 'efficiency';
        rec.comment = tl(chosen) + '(受け' + mine.ukeire + '枚)より' + tl(recommend.tile)
          + '(受け' + recommend.ukeire + '枚)が' + ukLoss + '枚広い選択です。';
        return rec;
      }
      rec.severity = null; rec.category = 'near';
      rec.comment = 'ほぼ最適（最大より' + ukLoss + '枚だけ狭い選択）。';
      return rec;
    }
    rec.severity = null;
    rec.category = 'optimal';
    rec.comment = '最適打。' + (mine.shanten === 0 ? 'テンパイ維持。' : '受け入れ' + mine.ukeire + '枚で最大。');
    return rec;
  }

  /* ---------- 立直見送り ---------- */
  function analyzeRiichiSkip(view, opts, chosenId) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var t = C.idToType(chosenId);
    var cc = counts.slice(); cc[t]--;
    if (C.shanten(cc, melds) !== 0) return null; // テンパイを取っていない場合は別途
    var u = C.ukeire(cc, melds, view.seen);
    var threats = threatList(view);
    var rec = {
      kind: 'riichi-skip', kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba,
      go: Math.floor(view.turnCount / 4) + 1,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)),
      chosen: t, waits: C.waitsOf(cc, melds), ukeire: u.total,
      severity: null, category: 'riichi', comment: ''
    };
    var waitStr = rec.waits.map(tl).join('・');
    if (threats.some(function (x) { return x.kind === 'riichi'; })) {
      rec.severity = 'low';
      rec.comment = '他家リーチ中のダマテンは一つの選択。ただし ' + waitStr + '待ち(' + u.total + '枚)なら追いかけリーチも有力です。';
      return rec;
    }
    if (u.total >= 4) {
      rec.severity = 'mid';
      rec.comment = 'リーチ可能でしたが見送りました。' + waitStr + '待ち(残り' + u.total
        + '枚)はリーチして打点を上げるのが基本です（裏ドラ・一発も付く）。';
      return rec;
    }
    rec.severity = 'low';
    rec.comment = waitStr + '待ち(' + u.total + '枚)は細い待ちなので、ダマテンや手変わり待ちも有力です。';
    return rec;
  }

  /* ---------- 和了見逃し ---------- */
  function winMissRecord(view, kindLabel, result) {
    return {
      kind: 'win-miss', kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba,
      go: Math.floor(view.turnCount / 4) + 1,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)),
      severity: 'high', category: 'win-miss',
      comment: kindLabel + 'の和了を見逃しました（' + (result ? (result.yaku.map(function (y) { return y.name; }).join('・') + ' ' + result.points + '点') : '') + '）。'
        + (kindLabel === 'ロン' ? 'ロンを見逃すとフリテンになり、同じ待ちで和了できなくなります。' : '')
    };
  }

  /* ---------- 鳴きの分析 ---------- */
  function analyzeCall(view, o, action) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var cur = C.shanten(counts, melds);
    function after(usedTypes) {
      var cc = counts.slice();
      for (var i = 0; i < usedTypes.length; i++) { if (cc[usedTypes[i]] <= 0) return null; cc[usedTypes[i]]--; }
      if (C.sumCounts(cc) % 3 !== 2) return null;
      var b = C.discardOptions(cc, melds + 1, view.seen)[0];
      return b || null;
    }
    var rec = {
      kind: 'call', kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba,
      go: Math.floor(view.turnCount / 4) + 1,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)),
      tile: o.tile, action: action.type, severity: null, category: 'call', comment: ''
    };
    var menzen = true;
    for (var i = 0; i < view.melds.length; i++) {
      var m = view.melds[i];
      if (m.type === 'chi' || m.type === 'pon' || (m.type === 'kan' && !m.closed)) menzen = false;
    }
    if (action.type === 'pass') {
      var bestGain = null;
      if (o.canPon) {
        var ap = after([o.tile, o.tile]);
        if (ap && ap.shanten < cur) bestGain = { how: 'ポン', sh: ap.shanten };
      }
      for (var ci = 0; ci < o.chi.length; ci++) {
        var ac = after(o.chi[ci].types);
        if (ac && ac.shanten < cur && (!bestGain || ac.shanten < bestGain.sh)) bestGain = { how: 'チー', sh: ac.shanten };
      }
      if (bestGain && bestGain.sh === 0 && menzen) {
        rec.severity = 'low';
        rec.comment = tl(o.tile) + 'を' + bestGain.how + 'すればテンパイでした。門前を維持する判断も有力ですが、役が確定しているなら鳴いて good。';
      } else if (bestGain && !menzen) {
        rec.severity = 'mid';
        rec.comment = '既に鳴いている手なので、' + tl(o.tile) + 'を' + bestGain.how + 'して'
          + bestGain.sh + '向聴に進めるべきでした。';
      }
      return rec.severity ? rec : null;
    }
    // 鳴いた場合
    var used = action.type === 'chi' ? action.tiles.map(C.idToType)
      : (action.type === 'kan' ? [o.tile, o.tile, o.tile] : [o.tile, o.tile]);
    var af = after(used);
    if (af) {
      rec.afterShanten = af.shanten;
      if (af.shanten > cur) {
        rec.severity = 'high';
        rec.comment = 'この鳴きでシャンテン数が ' + cur + ' → ' + af.shanten + ' に後退しています。';
      } else if (af.shanten === cur) {
        rec.severity = 'mid';
        rec.comment = 'シャンテン数が進まない鳴きです（' + cur + '向聴のまま）。門前の価値を失うだけになりがちです。';
      } else if (menzen && af.shanten > 0) {
        var yakuhai = C.isDragon(o.tile) || o.tile === view.seatWind || o.tile === view.roundWind;
        if (!yakuhai) {
          rec.severity = 'low';
          rec.comment = '門前を崩す鳴きです。役(断么九・混一色など)が見えているか確認しましょう。';
        }
      }
    }
    return rec.severity ? rec : null;
  }

  /* ---------- 記録 ---------- */
  function createRecorder() {
    var records = [];
    var meta = { dealIns: [], wins: [], tenpai: 0, hands: 0, riichi: 0, lastHandStart: null };

    function push(r) { if (r) records.push(r); return r; }

    function report() {
      var discards = records.filter(function (r) { return r.kind === 'discard'; });
      var counted = discards.filter(function (r) { return r.category !== 'ok-fold' && r.category !== 'ok-push'; });
      var optimal = counted.filter(function (r) { return r.category === 'optimal' || r.category === 'near'; });
      var lossSum = 0, lossN = 0;
      counted.forEach(function (r) {
        if (r.ukeireLoss != null && r.shantenLoss === 0) { lossSum += r.ukeireLoss; lossN++; }
      });
      var mistakes = records.filter(function (r) { return r.severity; });
      var byCat = {};
      mistakes.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + 1; });

      var sev = { high: 0, mid: 0, low: 0 };
      mistakes.forEach(function (r) { sev[r.severity]++; });

      var rate = counted.length ? Math.round(optimal.length / counted.length * 100) : 0;
      var advice = [];
      if (!counted.length) advice.push('打牌データがありません。');
      else {
        if (rate >= 85) advice.push('牌効率は十分なレベルです（最適打率 ' + rate + '%）。次は押し引きと打点意識を磨きましょう。');
        else if (rate >= 70) advice.push('牌効率はおおむね良好（最適打率 ' + rate + '%）。受け入れ枚数を数える癖をつけると更に伸びます。');
        else advice.push('牌効率に改善余地があります（最適打率 ' + rate + '%）。「どの牌を切ると何枚受け入れられるか」を意識しましょう。');
      }
      if (byCat.shanten) advice.push('シャンテン戻し（手が後退する打牌）が ' + byCat.shanten + ' 回。ブロック（面子候補）を数えてから切る牌を決めましょう。');
      if (byCat.efficiency >= 3) advice.push('受け入れロスのある選択が ' + byCat.efficiency + ' 回。孤立牌より連続形（ターツ）を残すのが原則です。');
      if (byCat.push) advice.push('押し引きの判断ミスが ' + byCat.push + ' 回。2向聴以上でリーチを受けたら、まず現物を確認しましょう。');
      if (byCat['win-miss']) advice.push('和了見逃しが ' + byCat['win-miss'] + ' 回。ロン・ツモの表示は必ず確認しましょう。');
      if (byCat.riichi) advice.push('リーチ判断の指摘が ' + byCat.riichi + ' 回。良い待ちならリーチして打点を取るのが基本です。');
      if (byCat.call) advice.push('鳴き判断の指摘が ' + byCat.call + ' 回。鳴いた後の役とシャンテン数の変化を確認しましょう。');
      meta.dealIns.forEach(function (d) {
        if (d.avoidable) advice.push('第' + d.kyoku + '局の放銃は、現物があったので回避できた可能性があります。');
      });

      return {
        summary: {
          discardCount: counted.length,
          optimalCount: optimal.length,
          optimalRate: rate,
          avgUkeireLoss: lossN ? Math.round(lossSum / lossN * 10) / 10 : 0,
          mistakeCount: mistakes.length,
          severity: sev,
          byCategory: byCat,
          wins: meta.wins.length,
          dealIns: meta.dealIns.length,
          riichiCount: meta.riichi,
          hands: meta.hands
        },
        mistakes: mistakes.slice().sort(function (a, b) {
          var o = { high: 0, mid: 1, low: 2 };
          if (o[a.severity] !== o[b.severity]) return o[a.severity] - o[b.severity];
          return (a.kyoku - b.kyoku) || (a.go - b.go);
        }),
        records: records,
        meta: meta,
        advice: advice
      };
    }

    return {
      records: records, meta: meta, push: push, report: report,
      analyzeDiscard: analyzeDiscard, analyzeRiichiSkip: analyzeRiichiSkip,
      analyzeCall: analyzeCall, winMissRecord: winMissRecord,
      reset: function () { records.length = 0; meta.dealIns = []; meta.wins = []; meta.tenpai = 0; meta.hands = 0; meta.riichi = 0; }
    };
  }

  global.MJReview = {
    createRecorder: createRecorder,
    analyzeDiscard: analyzeDiscard,
    analyzeRiichiSkip: analyzeRiichiSkip,
    analyzeCall: analyzeCall,
    winMissRecord: winMissRecord,
    rel: rel,
    tileListStr: tileListStr
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
