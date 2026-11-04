/* AI対局者
   押し引き・副露判断は共有ドキュメント「麻雀の上達法と必須スキル」の基準に準拠。
   危険度は src/danger.js（統計的危険度序列）を使用。 */
(function (global) {
  'use strict';
  var C = global.MJCore, D = global.MJDanger, Th = global.MJTheory;

  function doraSet(view) {
    var s = {};
    for (var i = 0; i < view.doraInd.length; i++) s[C.doraFromIndicator(view.doraInd[i])] = 1;
    return s;
  }
  function isYakuhai(view, t) {
    return C.isDragon(t) || t === view.seatWind || t === view.roundWind;
  }
  function isMenzenView(view) {
    for (var i = 0; i < view.melds.length; i++) {
      var m = view.melds[i];
      if (m.type === 'chi' || m.type === 'pon' || (m.type === 'kan' && !m.closed)) return false;
    }
    return true;
  }

  /* 手牌の打点目安(翻) */
  function handValue(view, counts, melds) {
    var dora = doraSet(view), han = 0, i, j;
    for (i = 0; i < 34; i++) {
      if (!counts[i]) continue;
      if (dora[i]) han += counts[i];
      if (isYakuhai(view, i) && counts[i] >= 3) han += 1;
    }
    for (i = 0; i < view.hand.length; i++) if (C.isRedId(view.hand[i])) han += 1;
    for (i = 0; i < view.melds.length; i++) {
      var m = view.melds[i];
      for (j = 0; j < m.tiles.length; j++) {
        var t = C.idToType(m.tiles[j]);
        if (dora[t]) han += 1;
        if (C.isRedId(m.tiles[j])) han += 1;
      }
      if ((m.type === 'pon' || m.type === 'kan') && isYakuhai(view, m.tile)) han += 1;
    }
    if (isMenzenView(view)) han += 1; // リーチ分
    return han;
  }

  /* 好形か: 最良打牌後の受け入れが広いか */
  function isGoodShape(cands, bestSh) {
    var best = 0;
    for (var i = 0; i < cands.length; i++) {
      if (cands[i].shanten === bestSh) best = Math.max(best, cands[i].ukeire);
    }
    return bestSh === 0 ? best >= 6 : best >= 12;
  }

  /* 孤立牌・ブロック価値（資料の序列に準拠） */
  function keepValue(view, counts, t, dora) {
    var v = Th.isolatedValue(t, view) * 0.5;
    if (dora[t]) v += 3.4;
    if (isYakuhai(view, t)) v += counts[t] >= 2 ? 2.6 : 0.8;
    if (!C.isHonor(t)) {
      var r = t % 9 + 1;
      // 連続形の一部なら残す価値が高い
      var base = t - (r - 1);
      var near = 0;
      if (r > 1 && counts[base + r - 2]) near++;
      if (r < 9 && counts[base + r]) near++;
      if (r > 2 && counts[base + r - 3]) near += 0.5;
      if (r < 8 && counts[base + r + 1]) near += 0.5;
      v += near * 0.8;
      if (counts[t] >= 2) v += 1.2;
    }
    return v;
  }

  function openYakuPotential(view, counts, melds) {
    var i, allSimple = true, suitCount = {}, honor = 0;
    for (i = 0; i < 34; i++) {
      if (!counts[i]) continue;
      if (C.isYaochu(i)) allSimple = false;
      if (C.isHonor(i)) honor += counts[i];
      else suitCount[C.suitOf(i)] = (suitCount[C.suitOf(i)] || 0) + counts[i];
    }
    for (i = 0; i < melds.length; i++) {
      var m = melds[i];
      if (m.type === 'pon' || m.type === 'kan') {
        if (isYakuhai(view, m.tile)) return { ok: true, why: '役牌' };
        if (C.isYaochu(m.tile)) allSimple = false;
      } else if (C.isYaochu(m.tile) || C.isYaochu(m.tile + 2)) allSimple = false;
    }
    if (allSimple && view.rule.kuitan !== false) return { ok: true, why: '断么九' };
    var keys = Object.keys(suitCount);
    if (keys.length === 1 && suitCount[keys[0]] + honor >= 7) return { ok: true, why: '混一色' };
    return { ok: false, why: null };
  }

  /* 手牌に残る両面ターツの数 */
  function ryanmenCount(counts) {
    var n = 0;
    for (var s = 0; s < 3; s++) {
      for (var r = 1; r <= 8; r++) {
        var a = s * 9 + r - 1, b = a + 1;
        if (counts[a] && counts[b] && r >= 2 && r <= 7) n++;
      }
    }
    return n;
  }

  /* ---------- 打牌選択 ---------- */
  function chooseDiscard(view, opts, strength) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var dora = doraSet(view);
    var cands = C.discardOptions(counts, melds, view.seen);
    var allowedTiles = {};
    for (var i = 0; i < opts.discardable.length; i++) allowedTiles[C.idToType(opts.discardable[i])] = 1;
    cands = cands.filter(function (c) { return allowedTiles[c.tile]; });
    if (!cands.length) return opts.discardable[opts.discardable.length - 1];

    var bestSh = cands[0].shanten;
    var maxUk = 0;
    for (i = 0; i < cands.length; i++) if (cands[i].shanten === bestSh) maxUk = Math.max(maxUk, cands[i].ukeire);

    var ths = D.threats(view);
    var foldThs = D.foldThreats(view, ths);
    var go = Math.floor(view.turnCount / 4) + 1;
    var value = handValue(view, counts, melds);
    var good = isGoodShape(cands, bestSh);
    var risk = foldThs.length ? Th.allowedRisk(bestSh, good, value >= 4, go, view.wallLeft) : 1;
    var fold = foldThs.length > 0 && risk <= 0.015;
    if (strength === 'easy' && fold && Math.random() < 0.3) fold = false;

    var scored = cands.map(function (c) {
      var dg = ths.length ? D.estimate(view, c.tile, ths) : { rate: 0 };
      var score;
      if (fold) {
        score = -dg.rate * 1000 + c.ukeire * 0.03;
        if (C.isHonor(c.tile)) score += 0.3;
      } else {
        score = -(c.shanten - bestSh) * 60;
        score += c.ukeire * 1.0 + c.tiles.length * 0.4;
        score -= keepValue(view, counts, c.tile, dora) * 2.0;
        score -= dg.rate * 30;
        score -= Math.max(0, dg.rate - risk) * 600; // 許容放銃率を超える押しは強く抑制
        if (strength === 'easy') score += (Math.random() - 0.5) * 8;
      }
      return { c: c, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var pickType = scored[0].c.tile;
    var ids = opts.discardable.filter(function (id) { return C.idToType(id) === pickType; });
    ids.sort(function (a, b) { return (C.isRedId(a) ? 1 : 0) - (C.isRedId(b) ? 1 : 0); });
    return ids[0];
  }

  /* ---------- controller ---------- */
  function create(opt) {
    opt = opt || {};
    var strength = opt.strength || 'normal';

    function turnAction(view, opts) {
      if (opts.canTsumo) return { type: 'tsumo' };
      if (opts.canKyuushu && Math.random() < 0.8) return { type: 'kyuushu' };

      var counts = C.countsFromIds(view.hand);
      var melds = view.melds.length;
      var ths = D.threats(view);

      // カン
      if (opts.kans.length && !ths.length) {
        for (var i = 0; i < opts.kans.length; i++) {
          var k = opts.kans[i];
          var before = C.discardOptions(counts, melds, view.seen)[0];
          var after = counts.slice();
          if (k.kind === 'ankan') after[k.tile] -= 4; else after[k.tile] -= 1;
          var mm = melds + (k.kind === 'ankan' ? 1 : 0);
          var afterSh = C.sumCounts(after) % 3 === 2
            ? C.discardOptions(after, mm, view.seen)[0].shanten : C.shanten(after, mm);
          if (afterSh <= before.shanten && (view.riichi || afterSh <= 1 || isYakuhai(view, k.tile))) {
            return { type: 'kan', kind: k.kind, tile: k.tile };
          }
        }
      }

      // 立直: 先制聴牌なら即リーチが基本(愚形でも和了率53%/放銃率11%)
      if (opts.canRiichi) {
        var best = null;
        for (var r = 0; r < opts.riichiTiles.length; r++) {
          var t = C.idToType(opts.riichiTiles[r]);
          var cc = counts.slice(); cc[t]--;
          var u = C.ukeire(cc, melds, view.seen);
          if (!best || u.total > best.total) best = { total: u.total, id: opts.riichiTiles[r] };
        }
        var ok = true;
        // 追いかけで待ちが極端に細い場合のみ見送り
        if (ths.length && best.total <= 2) ok = false;
        if (strength === 'easy' && Math.random() < 0.15) ok = false;
        if (ok) return { type: 'riichi', tile: best.id };
      }

      return { type: 'discard', tile: chooseDiscard(view, opts, strength) };
    }

    function callAction(view, o) {
      if (o.canRon) return { type: 'ron' };
      var counts = C.countsFromIds(view.hand);
      var melds = view.melds.length;
      var curSh = C.shanten(counts, melds);
      var menzen = isMenzenView(view);
      var ths = D.threats(view);
      var go = Math.floor(view.turnCount / 4) + 1;

      // 自手に価値がなく他家が仕掛けている局面は撤退
      if (ths.length && curSh >= 2) return { type: 'pass' };

      function after(usedTypes) {
        var cc = counts.slice();
        for (var j = 0; j < usedTypes.length; j++) {
          if (cc[usedTypes[j]] <= 0) return null;
          cc[usedTypes[j]]--;
        }
        var mm = melds + 1, rem = C.sumCounts(cc) % 3;
        if (rem === 1) return { shanten: C.shanten(cc, mm), ukeire: 0, counts: cc, melds: mm };
        if (rem !== 2) return null;
        var b = C.discardOptions(cc, mm, view.seen)[0];
        return b ? { shanten: b.shanten, ukeire: b.ukeire, counts: cc, melds: mm } : null;
      }
      // 鳴いた後の打点目安(リーチ分を除く)
      function openValue(cc, extraMeld) {
        var v = handValue(view, cc, melds) - (menzen ? 1 : 0);
        if (extraMeld && isYakuhai(view, o.tile)) v += 1;
        return v;
      }
      var yakuhai = isYakuhai(view, o.tile);
      var keishiki = go >= 14 || view.wallLeft <= 8; // 終盤の形式聴牌取り

      // ポン: 役牌は1鳴きが原則
      if (o.canPon) {
        var ap = after([o.tile, o.tile]);
        if (ap) {
          var pot = openYakuPotential(view, ap.counts, view.melds.concat([{ type: 'pon', tile: o.tile }]));
          var val = openValue(ap.counts, true);
          if (yakuhai && ap.shanten <= curSh && (val >= 2 || ap.shanten <= 1 || keishiki)) {
            return { type: 'pon', tiles: o.ponTiles };
          }
          if (pot.ok && ap.shanten < curSh && (val >= 2 || keishiki) && (!menzen || ap.shanten <= 1)) {
            return { type: 'pon', tiles: o.ponTiles };
          }
        }
      }
      // 大明槓は役牌のみ
      if (o.canKan && yakuhai) {
        var ak = after([o.tile, o.tile, o.tile]);
        if (ak && ak.shanten <= curSh) return { type: 'kan', tiles: o.kanTiles };
      }
      // チー: 役の確定性と打点下限、唯一の両面は残す
      if (o.chi.length) {
        var bestChi = null;
        var ryBefore = ryanmenCount(counts);
        for (var ci = 0; ci < o.chi.length; ci++) {
          var ch = o.chi[ci];
          var ac = after(ch.types);
          if (!ac) continue;
          var pot3 = openYakuPotential(view, ac.counts, view.melds.concat([{ type: 'chi', tile: Math.min(o.tile, ch.types[0]) }]));
          if (!pot3.ok) continue;                       // 役が見えないチーはしない
          var v3 = openValue(ac.counts, false);
          if (v3 < 2 && !keishiki && ac.shanten > 0) continue;  // 打点の下限
          if (menzen && curSh <= 1 && ac.shanten > 0) continue; // 門前の良い手は崩さない
          if (ac.shanten >= curSh) continue;
          var ryAfter = ryanmenCount(ac.counts);
          if (ryBefore > 0 && ryAfter === 0 && ac.shanten > 0) continue; // 唯一の両面を消す鳴きはスルー
          if (!bestChi || ac.ukeire > bestChi.uk) bestChi = { tiles: ch.tiles, uk: ac.ukeire };
        }
        if (bestChi) return { type: 'chi', tiles: bestChi.tiles };
      }
      return { type: 'pass' };
    }

    return { turnAction: turnAction, callAction: callAction, isAI: true, strength: strength };
  }

  global.MJAI = {
    create: create,
    chooseDiscard: chooseDiscard,
    handValue: handValue,
    isGoodShape: isGoodShape,
    keepValue: keepValue,
    openYakuPotential: openYakuPotential,
    ryanmenCount: ryanmenCount,
    doraSet: doraSet,
    isYakuhaiType: isYakuhai,
    isMenzenView: isMenzenView,
    // 旧API互換
    tileDanger: function (view, type) { return D.estimate(view, type).rate; },
    anyThreat: function (view) { return D.threats(view).length > 0; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
