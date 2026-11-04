/* 危険度モデル
   出典: 共有ドキュメント「麻雀の上達法と必須スキル」の危険度序列（推定放銃率）
   現物0% / 字牌4枚目〜1% / ノーチャンス・中スジ・字牌2枚見え3〜5% / 表スジ5%前後 /
   ワンチャンス・生牌字牌5〜8% / 片スジ・暗刻スジ8〜10% / 無スジ10〜15%
   裏スジ・間四間は加点しない（統計的に無スジと変わらないため）。
   またぎスジも加点しない（ノーヒント無スジよりむしろ安全）。
   例外として「序盤の5切れに対する1・9」のみ危険度を上げる。 */
(function (global) {
  'use strict';
  var C = global.MJCore;

  function discardTypes(pd) {
    var s = {};
    for (var i = 0; i < pd.discards.length; i++) s[C.idToType(pd.discards[i].id)] = true;
    return s;
  }

  // リーチ後に他家が通した牌も現物
  function genbutsuSet(view, p) {
    var pd = view.players[p];
    var s = discardTypes(pd);
    if (pd.riichiTurn != null && pd.riichiTurn >= 0) {
      for (var q = 0; q < 4; q++) {
        var ds = view.players[q].discards;
        for (var i = 0; i < ds.length; i++) {
          if (ds[i].turn >= pd.riichiTurn) s[C.idToType(ds[i].id)] = true;
        }
      }
    }
    return s;
  }

  // 壁: その牌で両面待ちを作れるか
  function wallInfo(seen, type) {
    var r = type % 9, base = type - r;
    function left(k) { return 4 - (seen[base + k] || 0); }
    var lower = (r >= 2) ? Math.min(left(r - 1), left(r - 2)) : 0; // (r-2,r-1)の両面
    var upper = (r <= 6) ? Math.min(left(r + 1), left(r + 2)) : 0; // (r+1,r+2)の両面
    var max = Math.max(lower, upper);
    return { noChance: max === 0, oneChance: max === 1 };
  }

  // 1人の他家に対する推定放銃率
  function against(view, p, type, opt) {
    opt = opt || {};
    var pd = view.players[p];
    var gen = opt.genbutsu || genbutsuSet(view, p);
    if (gen[type]) return { rate: 0, label: '現物', rank: 1 };

    var seen = view.seen;
    var myCounts = opt.myCounts || C.countsFromIds(view.hand);

    if (C.isHonor(type)) {
      var shown = Math.max(0, (seen[type] || 0) - 1); // これから切る1枚を除いた既出枚数
      if (shown >= 3) return { rate: 0.01, label: '字牌(4枚目)', rank: 2 };
      if (shown === 2) return { rate: 0.04, label: '字牌(2枚見え)', rank: 3 };
      if (shown === 1) return { rate: 0.055, label: '字牌(1枚見え)', rank: 5 };
      return { rate: 0.07, label: '生牌の字牌', rank: 5 };
    }

    var r = type % 9 + 1, base = type - (r - 1);
    var dis = opt.dis || discardTypes(pd);
    var sujiLow = r >= 4 && dis[base + (r - 3) - 1];
    var sujiHigh = r <= 6 && dis[base + (r + 3) - 1];

    var res;
    if (r >= 4 && r <= 6 && sujiLow && sujiHigh) res = { rate: 0.04, label: '中スジ', rank: 3 };
    else if ((r <= 3 && sujiHigh) || (r >= 7 && sujiLow)) res = { rate: 0.05, label: '表スジ', rank: 4 };
    else if (r >= 4 && r <= 6 && (sujiLow || sujiHigh)) res = { rate: 0.09, label: '片スジ', rank: 6 };
    else {
      var byRank = [0, 0.07, 0.09, 0.11, 0.13, 0.13, 0.13, 0.11, 0.09, 0.07][r];
      res = { rate: byRank, label: '無スジ', rank: 7 };
    }

    // 壁(ノーチャンス/ワンチャンス)は両面待ちを否定するので上書き
    var w = wallInfo(seen, type);
    if (w.noChance && res.rate > 0.035) res = { rate: 0.035, label: 'ノーチャンス(壁)', rank: 3 };
    else if (w.oneChance && res.rate > 0.06) res = { rate: 0.06, label: 'ワンチャンス', rank: 5 };

    // 序盤(1〜3巡目)に切られた数牌の外側は表スジ並みに安全
    if (res.rate > 0.05) {
      for (var i = 0; i < Math.min(3, pd.discards.length); i++) {
        var dt = C.idToType(pd.discards[i].id);
        if (dt >= 27 || C.suitOf(dt) !== C.suitOf(type)) continue;
        var dr = dt % 9 + 1;
        if ((dr <= 5 && r < dr) || (dr >= 5 && r > dr)) {
          res = { rate: 0.05, label: '序盤の捨て牌の外側', rank: 4 };
          break;
        }
      }
    }

    // 暗刻スジは通常のスジより危険
    if (res.label === '表スジ' || res.label === '中スジ' || res.label === '片スジ') {
      if ((r >= 4 && myCounts[base + (r - 3) - 1] >= 3) || (r <= 6 && myCounts[base + (r + 3) - 1] >= 3)) {
        res = { rate: res.rate * 1.3, label: res.label + '(暗刻スジ)', rank: 6 };
      }
    }
    // 序盤の5切れに対する1・9のみ危険度上昇（唯一統計的に有意な俗説）
    if ((r === 1 || r === 9) && res.rate >= 0.05) {
      for (var j = 0; j < Math.min(4, pd.discards.length); j++) {
        var t2 = C.idToType(pd.discards[j].id);
        if (t2 < 27 && C.suitOf(t2) === C.suitOf(type) && (t2 % 9) + 1 === 5) {
          res = { rate: res.rate * 1.3, label: res.label + '(序盤5切れ)', rank: res.rank };
          break;
        }
      }
    }
    return res;
  }

  // 脅威度(その家がテンパイしている確からしさ × 打点の重み)
  function threatWeight(view, p) {
    var pd = view.players[p];
    var go = Math.floor(view.turnCount / 4) + 1;
    if (pd.riichi) return 1;
    var m = pd.melds.length;
    if (m >= 3) return go >= 6 ? 0.75 : 0.5;
    if (m === 2) return go >= 7 ? 0.5 : 0.3;
    if (m === 1) return go >= 10 ? 0.3 : 0.15;
    return 0;
  }

  function threats(view) {
    var out = [];
    var go = Math.floor(view.turnCount / 4) + 1;
    var Th = global.MJTheory;
    for (var p = 0; p < 4; p++) {
      if (p === view.me) continue;
      var w = threatWeight(view, p);
      if (w <= 0) continue;
      var riichi = view.players[p].riichi;
      var nm = view.players[p].melds.length;
      // foldWorthy: ベタオリを検討すべき相手か
      // リーチは常に対象。副露手は「3フーロで即 / 2フーロは7巡目以降 / 1フーロは10巡目以降」(資料の守備モデル)
      var foldWorthy = riichi || (Th ? Th.foldLineVsMelds(nm, go) : nm >= 2);
      out.push({ p: p, weight: w, riichi: riichi, melds: nm, foldWorthy: foldWorthy });
    }
    return out;
  }
  function foldThreats(view, ths) {
    return (ths || threats(view)).filter(function (t) { return t.foldWorthy; });
  }

  // 全脅威に対する推定放銃率(最大)
  function estimate(view, type, ths) {
    ths = ths || threats(view);
    var best = { rate: 0, label: '安全', rank: 1, from: null };
    for (var i = 0; i < ths.length; i++) {
      var t = ths[i];
      var r = against(view, t.p, type);
      var eff = r.rate * t.weight;
      if (eff > best.rate) best = { rate: eff, label: r.label, rank: r.rank, from: t.p, raw: r.rate };
    }
    if (!ths.length) best.label = '脅威なし';
    else if (best.rate === 0) best.label = '現物';
    return best;
  }

  // 手牌の中の安全牌(現物)一覧
  function genbutsuInHand(view, ths) {
    ths = ths || threats(view);
    if (!ths.length) return [];
    var out = [], seenT = {};
    for (var i = 0; i < view.hand.length; i++) {
      var t = C.idToType(view.hand[i]);
      if (seenT[t]) continue;
      seenT[t] = 1;
      var safe = true;
      for (var j = 0; j < ths.length; j++) {
        if (against(view, ths[j].p, t).rate > 0) { safe = false; break; }
      }
      if (safe) out.push(t);
    }
    return out;
  }

  global.MJDanger = {
    estimate: estimate,
    foldThreats: foldThreats,
    against: against,
    threats: threats,
    threatWeight: threatWeight,
    genbutsuSet: genbutsuSet,
    genbutsuInHand: genbutsuInHand,
    wallInfo: wallInfo
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
