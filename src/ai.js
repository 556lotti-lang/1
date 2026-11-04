/* AI対局者: 牌効率 + 押し引き(ベタオリ/危険度) */
(function (global) {
  'use strict';
  var C = global.MJCore;

  /* ---------- 安全度 ---------- */
  function isGenbutsu(view, p, type) {
    var pd = view.players[p], i, q, d;
    for (i = 0; i < pd.discards.length; i++) if (C.idToType(pd.discards[i].id) === type) return true;
    if (pd.riichiTurn != null && pd.riichiTurn >= 0) {
      for (q = 0; q < 4; q++) {
        var ds = view.players[q].discards;
        for (i = 0; i < ds.length; i++) {
          d = ds[i];
          if (d.turn >= pd.riichiTurn && C.idToType(d.id) === type) return true;
        }
      }
    }
    return false;
  }

  function hasSuji(view, p, type) {
    if (type >= 27) return false;
    var r = type % 9, base = type - r;
    var pd = view.players[p];
    function discarded(t) {
      for (var i = 0; i < pd.discards.length; i++) if (C.idToType(pd.discards[i].id) === t) return true;
      return false;
    }
    var low = r >= 3 ? discarded(base + r - 3) : false;
    var high = r <= 5 ? discarded(base + r + 3) : false;
    if (r >= 3 && r <= 5) return low && high;  // 中張は両筋
    return low || high;
  }

  // 0(安全) 〜 1(危険)
  function tileDanger(view, type) {
    var danger = 0;
    for (var p = 0; p < 4; p++) {
      if (p === view.me) continue;
      var pd = view.players[p];
      var threat = 0;
      if (pd.riichi) threat = 1;
      else {
        var openMelds = pd.melds.length;
        if (openMelds >= 2 && view.turnCount >= 24) threat = 0.35;
        else if (openMelds >= 3) threat = 0.4;
      }
      if (!threat) continue;
      if (isGenbutsu(view, p, type)) continue;
      var base;
      if (type >= 27) {
        var seen = view.seen[type] || 0;
        base = seen >= 3 ? 0.08 : (seen >= 2 ? 0.16 : 0.3);
      } else {
        var r = type % 9 + 1;
        base = [0, 0.33, 0.45, 0.52, 0.62, 0.66, 0.62, 0.52, 0.45, 0.33][r];
        if (hasSuji(view, p, type)) base *= 0.55;
      }
      danger = Math.max(danger, base * threat);
    }
    return danger;
  }

  function anyThreat(view) {
    for (var p = 0; p < 4; p++) {
      if (p === view.me) continue;
      if (view.players[p].riichi) return true;
      if (view.players[p].melds.length >= 3 && view.turnCount >= 20) return true;
    }
    return false;
  }

  /* ---------- 手牌評価 ---------- */
  function doraSet(view) {
    var s = {};
    for (var i = 0; i < view.doraInd.length; i++) s[C.doraFromIndicator(view.doraInd[i])] = 1;
    return s;
  }
  function isYakuhai(view, t) {
    return C.isDragon(t) || t === view.seatWind || t === view.roundWind;
  }

  // 面子手の価値ヒューリスティック(ドラ/役牌の保持)
  function keepValue(view, counts, t, dora) {
    var v = 0;
    if (dora[t]) v += 3.2;
    if (isYakuhai(view, t)) v += counts[t] >= 2 ? 2.4 : 0.9;
    if (C.isHonor(t)) {
      if (counts[t] === 1 && !isYakuhai(view, t)) v -= 0.6;
    } else {
      var r = t % 9 + 1;
      v += (r >= 3 && r <= 7) ? 0.35 : 0.1;
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
        if (isYakuhai(view, m.tile)) return true;
        if (C.isYaochu(m.tile)) allSimple = false;
      } else if (C.isYaochu(m.tile) || C.isYaochu(m.tile + 2)) allSimple = false;
    }
    if (allSimple && view.rule.kuitan !== false) return true;
    var keys = Object.keys(suitCount);
    if (keys.length === 1 && suitCount[keys[0]] + honor >= 7) return true; // 混一色
    return false;
  }

  /* ---------- 打牌選択 ---------- */
  function chooseDiscard(view, opts, strength) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var dora = doraSet(view);
    var cands = C.discardOptions(counts, melds, view.seen);
    var allowed = {};
    for (var i = 0; i < opts.discardable.length; i++) allowed[C.idToType(opts.discardable[i])] = 1;
    cands = cands.filter(function (c) { return allowed[c.tile]; });
    if (!cands.length) return opts.discardable[opts.discardable.length - 1];

    var bestSh = cands[0].shanten;
    var maxUk = 0;
    for (i = 0; i < cands.length; i++) if (cands[i].shanten === bestSh) maxUk = Math.max(maxUk, cands[i].ukeire);

    var threat = anyThreat(view);
    var go = Math.floor(view.turnCount / 4); // 巡目
    var fold = false;
    if (threat && strength !== 'easy') {
      if (bestSh >= 3) fold = true;
      else if (bestSh === 2 && go >= 4) fold = true;
      else if (bestSh === 1 && go >= 13) fold = true;
    }

    var scored = cands.map(function (c) {
      var danger = tileDanger(view, c.tile);
      var score;
      if (fold) {
        score = -danger * 100 + c.ukeire * 0.02 - (C.isHonor(c.tile) ? 0 : 0);
      } else {
        score = -(c.shanten - bestSh) * 60;
        score += c.ukeire * 1.0;
        score += (c.tiles.length) * 0.4;
        // 残す牌の価値 = 切る牌の価値のマイナス
        score -= keepValue(view, counts, c.tile, dora) * 2.2;
        if (dora[c.tile]) score -= 2;
        score -= danger * (threat ? 26 : 2);
        if (strength === 'easy') score += (Math.random() - 0.5) * 8;
      }
      return { c: c, score: score, danger: danger };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var pickType = scored[0].c.tile;
    // 同種なら赤牌は残す
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
      var threat = anyThreat(view);

      // カン判断
      if (opts.kans.length && !threat) {
        for (var i = 0; i < opts.kans.length; i++) {
          var k = opts.kans[i];
          var before = C.discardOptions(counts, melds, view.seen)[0];
          var after = counts.slice();
          if (k.kind === 'ankan') after[k.tile] -= 4; else after[k.tile] -= 1;
          var afterSh = C.sumCounts(after) % 3 === 2
            ? C.discardOptions(after, melds + (k.kind === 'ankan' ? 1 : 0), view.seen)[0].shanten
            : C.shanten(after, melds + (k.kind === 'ankan' ? 1 : 0));
          if (afterSh <= before.shanten && (view.riichi || afterSh <= 1 || C.isDragon(k.tile) || isYakuhai(view, k.tile))) {
            return { type: 'kan', kind: k.kind, tile: k.tile };
          }
        }
      }

      // 立直判断
      if (opts.canRiichi) {
        var best = null;
        for (var r = 0; r < opts.riichiTiles.length; r++) {
          var t = C.idToType(opts.riichiTiles[r]);
          var cc = counts.slice(); cc[t]--;
          var u = C.ukeire(cc, melds, view.seen);
          if (!best || u.total > best.total) best = { total: u.total, id: opts.riichiTiles[r] };
        }
        var ok = true;
        if (threat && best.total <= 3) ok = false;
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
      var menzen = true;
      for (var i = 0; i < view.melds.length; i++) {
        var m = view.melds[i];
        if (m.type === 'chi' || m.type === 'pon' || (m.type === 'kan' && !m.closed)) menzen = false;
      }
      var threat = anyThreat(view);
      if (threat && curSh >= 2) return { type: 'pass' };

      // usedTypes = 手牌から面子に使う牌(鳴いた牌は含まない)
      function evalAfter(usedTypes) {
        var cc = counts.slice();
        for (var j = 0; j < usedTypes.length; j++) {
          if (cc[usedTypes[j]] <= 0) return null;
          cc[usedTypes[j]]--;
        }
        var mm = melds + 1;
        var rem = C.sumCounts(cc) % 3;
        if (rem === 1) { // 槓(嶺上牌を引く前)
          return { shanten: C.shanten(cc, mm), ukeire: C.ukeire(cc, mm, view.seen).total, counts: cc, melds: mm };
        }
        if (rem !== 2) return null;
        var best = C.discardOptions(cc, mm, view.seen)[0];
        return best ? { shanten: best.shanten, ukeire: best.ukeire, counts: cc, melds: mm } : null;
      }

      // ポン
      if (o.canPon) {
        var after = evalAfter([o.tile, o.tile]);
        if (after) {
          var yakuhai = C.isDragon(o.tile) || o.tile === view.seatWind || o.tile === view.roundWind;
          var pot = openYakuPotential(view, after.counts, view.melds.concat([{ type: 'pon', tile: o.tile }]));
          if (yakuhai && after.shanten <= curSh) return { type: 'pon', tiles: o.ponTiles };
          if (!menzen && after.shanten < curSh && pot) return { type: 'pon', tiles: o.ponTiles };
          if (after.shanten <= 1 && after.shanten < curSh && pot) return { type: 'pon', tiles: o.ponTiles };
        }
      }
      // 大明槓
      if (o.canKan) {
        var yk = C.isDragon(o.tile) || o.tile === view.seatWind || o.tile === view.roundWind;
        if (yk) {
          var a2 = evalAfter([o.tile, o.tile, o.tile]);
          if (a2 && a2.shanten <= curSh) return { type: 'kan', tiles: o.kanTiles };
        }
      }
      // チー
      if (o.chi.length) {
        var bestChi = null;
        for (var ci = 0; ci < o.chi.length; ci++) {
          var ch = o.chi[ci];
          var a3 = evalAfter(ch.types);
          if (!a3) continue;
          var pot3 = openYakuPotential(view, a3.counts, view.melds.concat([{ type: 'chi', tile: Math.min(o.tile, ch.types[0]) }]));
          if (!pot3) continue;
          if (menzen && curSh <= 1 && a3.shanten > 0) continue;
          if (a3.shanten < curSh && (a3.shanten <= 1 || !menzen)) {
            if (!bestChi || a3.ukeire > bestChi.uk) bestChi = { tiles: ch.tiles, uk: a3.ukeire };
          }
        }
        if (bestChi) return { type: 'chi', tiles: bestChi.tiles };
      }
      return { type: 'pass' };
    }

    return { turnAction: turnAction, callAction: callAction, isAI: true, strength: strength };
  }

  global.MJAI = {
    create: create,
    tileDanger: tileDanger,
    isGenbutsu: isGenbutsu,
    hasSuji: hasSuji,
    anyThreat: anyThreat,
    chooseDiscard: chooseDiscard,
    doraSet: doraSet,
    isYakuhaiType: isYakuhai
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
