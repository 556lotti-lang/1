/* 推奨打牌エンジン
   出典: 共有ドキュメント「麻雀の局の進め方と戦術」
   - 一局を3フェーズに分け、評価軸を 序盤=打点 / 中盤=スピード / 終盤=安全度 と切り替える
   - 最序盤の孤立牌は「2枚切れ字牌 → オタ風 → 孤立1・9 → 役牌 → 孤立2・8 → 孤立5 → 孤立4・6 → 孤立3・7」
   - 6ブロック以上なら「辺張 < 余剰対子 < 外嵌張 < 内嵌張 < 両嵌 < 雀頭対子 < 両面 < 完成面子」の弱い順に払う
   - 押し引きは向聴数・打点・待ちの良さのマトリクスで判断し、オリと決めたら危険度序列に従う */
(function (global) {
  'use strict';
  var C = global.MJCore, Th = global.MJTheory, D = global.MJDanger;

  function tl(t) { return C.typeLabel(t); }
  function doraSet(view) {
    var s = {};
    for (var i = 0; i < view.doraInd.length; i++) s[C.doraFromIndicator(view.doraInd[i])] = 1;
    return s;
  }
  function isYakuhai(view, t) {
    return C.isDragon(t) || t === view.seatWind || t === view.roundWind;
  }
  function isMenzen(view) {
    for (var i = 0; i < view.melds.length; i++) {
      var m = view.melds[i];
      if (m.type === 'chi' || m.type === 'pon' || (m.type === 'kan' && !m.closed)) return false;
    }
    return true;
  }
  function seenOutside(view, counts, t) {
    return Math.max(0, (view.seen[t] || 0) - (counts[t] || 0));
  }

  /* ---------- 孤立牌かどうか ---------- */
  function isIsolated(counts, t) {
    if (counts[t] > 1) return false;
    if (C.isHonor(t)) return true;
    var r = t % 9 + 1, base = t - (r - 1);
    for (var d = -2; d <= 2; d++) {
      if (!d) continue;
      var rr = r + d;
      if (rr < 1 || rr > 9) continue;
      if (counts[base + rr - 1]) return false;
    }
    return true;
  }

  /* ---------- 孤立牌の切り順（小さいほど先に切る） ---------- */
  function isolatedPriority(view, counts, t) {
    if (C.isHonor(t)) {
      if (seenOutside(view, counts, t) >= 2) return { v: 0.0, why: '場に2枚以上見えている字牌。面子になる見込みがないので最優先で処理' };
      var seat = t === view.seatWind, round = t === view.roundWind;
      if (C.isDragon(t)) return { v: 3.1, why: '三元牌。重なれば1翻で、他家3人全員が使えるので自風より先' };
      if (seat && round) return { v: 3.3, why: 'ダブル役牌（場風かつ自風）。重なれば2翻なので最後まで残す' };
      if (round) return { v: 3.0, why: '場風牌。他家のダブル役牌になりうるので役牌の中では先に切る' };
      if (seat) return { v: 3.2, why: '自風牌。自分以外に使い道がないので役牌の中では最後' };
      // オタ風: 下家 → 対面 → 上家 の順
      var rel = 0;
      for (var k = 1; k <= 3; k++) {
        if (view.players[(view.me + k) % 4].seatWind === t) { rel = k; break; }
      }
      return {
        v: 1.0 + (rel ? (rel - 1) * 0.1 : 0.15),
        why: 'オタ風。重なっても役にならず断么九の邪魔にもなるので孤立1・9より先'
          + (rel === 1 ? '（下家の風は鳴かれても旨味がないので最優先）' : '')
      };
    }
    var r = t % 9 + 1;
    if (r === 1 || r === 9) return { v: 2.0, why: '孤立1・9。受け入れ3種11枚で、1回のツモでは両面にならない数牌の最弱' };
    if (r === 2 || r === 8) return { v: 4.0, why: '孤立2・8。受け入れ4種15枚で、両面変化は1種類だけ' };
    if (r === 5) return { v: 5.0, why: '孤立5。くっついても3-6/4-7という最も和了りにくい両面にしかならない' };
    if (r === 4 || r === 6) return { v: 5.5, why: '孤立4・6。受け入れ5種19枚' };
    return { v: 6.0, why: '孤立3・7。2や8を引くと1-4/6-9という最も和了りやすい両面になる最強の孤立牌' };
  }

  /* ---------- その牌が属するブロックの強さ ---------- */
  function tileRole(view, counts, t) {
    var n = counts[t];
    if (n >= 3) return { k: 'set', v: 8, label: '暗刻' };
    var r = t % 9 + 1, base = t - (r - 1), suit = t < 27;
    var best = null;
    function take(k, v, label) { if (!best || v > best.v) best = { k: k, v: v, label: label }; }

    if (suit) {
      var at = function (x) { return (x >= 1 && x <= 9) ? counts[base + x - 1] : 0; };
      // 完成順子
      if ((at(r - 2) && at(r - 1)) || (at(r - 1) && at(r + 1)) || (at(r + 1) && at(r + 2))) take('set', 8, '順子');
      // 両面 / 辺張
      if (at(r - 1) || at(r + 1)) {
        var lo = at(r - 1) ? r - 1 : r, hi = at(r + 1) ? r + 1 : r;
        if (lo === 1 && hi === 2) take('penchan', 1, '辺張(12)');
        else if (lo === 8 && hi === 9) take('penchan', 1, '辺張(89)');
        else take('ryanmen', 7, '両面');
      }
      // 嵌張 / 両嵌
      if (at(r - 2) || at(r + 2)) {
        var mid = at(r + 2) ? r + 1 : r - 1;
        if (at(r - 2) && at(r + 2)) take('ryankan', 5, '両嵌');
        else if (mid >= 3 && mid <= 7) take('kanchanIn', 4, '内嵌張');
        else take('kanchanOut', 3, '外嵌張');
      }
      // 4連形・中膨れ
      if ((at(r + 1) && at(r + 2) && at(r + 3)) || (at(r - 1) && at(r - 2) && at(r - 3))) take('ryankan', 5, '4連形');
      if (n === 2 && (at(r - 1) || at(r + 1))) take('ryankan', 5, '中膨れ');
    }
    if (n === 2) {
      var pairs = 0;
      for (var i = 0; i < 34; i++) if (counts[i] >= 2) pairs++;
      if (isYakuhai(view, t)) take('pairHead', 6.5, '役牌対子');
      else if (pairs <= 1) take('pairHead', 6, '雀頭候補');
      else take('pairExtra', 2, '余剰対子');
    }
    if (!best) {
      var ip = isolatedPriority(view, counts, t);
      return { k: 'isolated', v: ip.v * 0.6, label: '孤立牌', iso: ip };
    }
    return best;
  }

  /* ---------- 手役の見込み ---------- */
  function yakuPlan(view, counts) {
    var suitCount = [0, 0, 0], honor = 0, i, yaochu = false;
    for (i = 0; i < 34; i++) {
      if (!counts[i]) continue;
      if (C.isHonor(i)) honor += counts[i];
      else suitCount[C.suitOf(i)] += counts[i];
      if (C.isYaochu(i)) yaochu = true;
    }
    for (i = 0; i < view.melds.length; i++) {
      var m = view.melds[i], tt = m.tile;
      var cnt = m.type === 'chi' ? 3 : (m.type === 'kan' ? 4 : 3);
      if (C.isHonor(tt)) honor += cnt; else suitCount[C.suitOf(tt)] += cnt;
      if (C.isYaochu(tt) || (m.type === 'chi' && C.isYaochu(tt + 2))) yaochu = true;
    }
    var bestSuit = 0;
    for (i = 1; i < 3; i++) if (suitCount[i] > suitCount[bestSuit]) bestSuit = i;
    var go = Math.floor(view.turnCount / 4) + 1;
    var R = Th.SOME_RULE;
    var some = null;
    if (suitCount[bestSuit] >= R.chin && honor <= 1) some = { kind: 'chinitsu', suit: bestSuit, n: suitCount[bestSuit] };
    else if (suitCount[bestSuit] + honor >= 10 || suitCount[bestSuit] >= R.go) some = { kind: 'honitsu', suit: bestSuit, n: suitCount[bestSuit] };
    else if (suitCount[bestSuit] >= R.consider && honor >= 3) some = { kind: 'maybe', suit: bestSuit, n: suitCount[bestSuit] };
    // 撤退ライン
    if (some && go >= 5 && suitCount[bestSuit] < R.deadline5) some = null;
    if (some && go >= R.deadline12 && C.shanten(counts, view.melds.length) > 0) some = null;
    return { suitCount: suitCount, honor: honor, some: some, tanyao: !yaochu, bestSuit: bestSuit };
  }

  /* ---------- 打点の目安（翻） ---------- */
  function handValue(view, counts) {
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
    if (isMenzen(view)) han += 1;
    return han;
  }

  /* ---------- ブロック数 ---------- */
  function countBlocks(counts, melds) {
    var work = counts.slice(), bestSh = 99, bestBlocks = 0;
    function rec(start, sets, partials, hasPair) {
      var blocks = melds + sets + partials;
      var sh = 8 - 2 * (melds + sets) - partials;
      if (blocks === 5 && !hasPair) sh += 1;
      if (sh < bestSh) { bestSh = sh; bestBlocks = blocks; }
      else if (sh === bestSh && blocks > bestBlocks) bestBlocks = blocks;
      if (blocks >= 6) return;
      for (var i = start; i < 34; i++) {
        if (!work[i]) continue;
        if (work[i] >= 3) { work[i] -= 3; rec(i, sets + 1, partials, hasPair); work[i] += 3; }
        if (i < 27 && i % 9 <= 6 && work[i + 1] && work[i + 2]) {
          work[i]--; work[i + 1]--; work[i + 2]--; rec(i, sets + 1, partials, hasPair); work[i]++; work[i + 1]++; work[i + 2]++;
        }
        if (work[i] >= 2) { work[i] -= 2; rec(i, sets, partials + 1, true); work[i] += 2; }
        if (i < 27 && i % 9 <= 7 && work[i + 1]) { work[i]--; work[i + 1]--; rec(i, sets, partials + 1, hasPair); work[i]++; work[i + 1]++; }
        if (i < 27 && i % 9 <= 6 && work[i + 2]) { work[i]--; work[i + 2]--; rec(i, sets, partials + 1, hasPair); work[i]++; work[i + 2]++; }
      }
    }
    rec(0, 0, 0, false);
    return bestBlocks;
  }

  /* ---------- 推奨打牌 ---------- */
  function recommend(view, opts) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    if (C.sumCounts(counts) % 3 !== 2) return null;
    var allowed = null;
    if (opts && opts.discardable) {
      allowed = {};
      for (var i = 0; i < opts.discardable.length; i++) allowed[C.idToType(opts.discardable[i])] = 1;
    }
    var cands = C.discardOptions(counts, melds, view.seen);
    if (allowed) cands = cands.filter(function (c) { return allowed[c.tile]; });
    if (!cands.length) return null;

    var bestSh = cands[0].shanten;
    var pool = cands.filter(function (c) { return c.shanten === bestSh; });
    var maxUk = pool.reduce(function (m, c) { return Math.max(m, c.ukeire); }, 0);
    var go = Math.floor(view.turnCount / 4) + 1;
    var phase = Th.phaseOf(go);
    var ths = D.threats(view), foldThs = D.foldThreats(view, ths);
    var value = handValue(view, counts);
    var goodShape = bestSh === 0 ? maxUk >= 6 : maxUk >= 12;
    var risk = foldThs.length ? Th.allowedRisk(bestSh, goodShape, value >= 4, go, view.wallLeft) : 1;
    var plan = yakuPlan(view, counts);
    var blocks = countBlocks(counts, melds);
    var dora = doraSet(view);

    var info = {
      shanten: bestSh, maxUkeire: maxUk, go: go, phase: phase, blocks: blocks,
      value: value, goodShape: goodShape, risk: risk, plan: plan,
      threats: ths, foldThreats: foldThs
    };

    /* --- ベタオリ --- */
    if (foldThs.length && risk <= 0.015) {
      var safest = cands.slice().sort(function (a, b) {
        var da = D.estimate(view, a.tile, foldThs), db = D.estimate(view, b.tile, foldThs);
        if (da.rate !== db.rate) return da.rate - db.rate;
        return b.ukeire - a.ukeire;
      })[0];
      var dg = D.estimate(view, safest.tile, foldThs);
      var who = foldThs.map(function (t) { return (t.riichi ? 'リーチ' : t.melds + 'フーロ'); }).join('・');
      return Object.assign(info, {
        tile: safest.tile, ukeire: safest.ukeire, tiles: safest.tiles, mode: 'fold',
        rule: '危険度序列',
        reason: bestSh >= 2
          ? '二向聴以下は和了が遠すぎて放銃リスクに見合いません（' + who + '）。'
            + '手役への未練を断ち切り、危険度の低い順に機械的に切ります。'
            + tl(safest.tile) + 'は' + dg.label + '（推定放銃率' + Math.round(dg.rate * 100) + '%）。'
          : '押せる基準を超えているので撤退します。' + tl(safest.tile) + 'は' + dg.label + '。'
      });
    }

    /* --- 候補ごとの採点 --- */
    var w = phase.w;
    var scored = pool.map(function (c) {
      var role = tileRole(view, counts, c.tile);
      var after = counts.slice(); after[c.tile]--;
      var dgv = ths.length ? D.estimate(view, c.tile, ths).rate : 0;
      var s = 0;
      // スピード: 受け入れ枚数
      s += c.ukeire * w.speed;
      // 打点: 切ることで失う価値
      var vLoss = 0;
      if (dora[c.tile]) vLoss += 3.5;
      if (isYakuhai(view, c.tile) && counts[c.tile] >= 2) vLoss += 3.0;
      // 1枚持ちの役牌は孤立1・9より後に切る(重なればポンで1翻が確定し速度が上がるため)
      if (isYakuhai(view, c.tile) && counts[c.tile] === 1
        && seenOutside(view, counts, c.tile) < 2 && go <= 9) {
        vLoss += (c.tile === view.seatWind && c.tile === view.roundWind) ? 3.4
          : (c.tile === view.roundWind ? 2.2 : 2.8);
      }
      if (plan.some && !C.isHonor(c.tile) && C.suitOf(c.tile) === plan.some.suit) vLoss += 3.2;
      if (plan.some && C.isHonor(c.tile) && plan.some.kind !== 'chinitsu') vLoss += 1.0;
      if (plan.tanyao && !C.isYaochu(c.tile)) vLoss += 0.6;
      s -= vLoss * w.value;
      // 安全度
      s -= dgv * 100 * w.safety;
      // ブロック・孤立牌の序列（弱いものから切る）
      if (role.k === 'isolated') {
        // ブロックが足りていない間は孤立牌の切り順セオリーを重く見る
        s -= role.iso.v * (blocks >= 5 ? 0.3 : 1.2) * 1.1;
      } else {
        s -= role.v * 1.1;
      }
      return { c: c, role: role, score: s, danger: dgv, vLoss: vLoss };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored[0];

    // 最序盤の孤立牌は、資料の切り順（約9割で最適解）を優先して選ぶ
    if (phase.id === 'early' && top.role.k === 'isolated') {
      var isoC = scored.filter(function (x) {
        return x.role.k === 'isolated' && (maxUk - x.c.ukeire) <= 12;
      });
      if (isoC.length > 1) {
        isoC.sort(function (a, b) {
          if (a.role.iso.v !== b.role.iso.v) return a.role.iso.v - b.role.iso.v;
          return b.c.ukeire - a.c.ukeire;
        });
        var pick = isoC[0];
        if (!foldThs.length || D.estimate(view, pick.c.tile, foldThs).rate <= risk) top = pick;
      }
    }

    /* --- 理由の組み立て --- */
    var reason = '', rule = '受け入れ最大';
    var ukLoss = maxUk - top.c.ukeire;
    var weakBlock = { penchan: 1, pairExtra: 1, kanchanOut: 1, kanchanIn: 1 }[top.role.k];
    var offSuit = plan.some && plan.some.kind !== 'maybe'
      && !C.isHonor(top.c.tile) && C.suitOf(top.c.tile) !== plan.some.suit;

    if (offSuit) {
      rule = '染め手の手順';
      reason = (plan.some.kind === 'chinitsu' ? '清一色' : '混一色') + 'が見えています（同色'
        + plan.some.n + '枚）。不要スーツは「孤立牌 → ターツ → 対子」の順に処理します。'
        + tl(top.c.tile) + 'は' + (top.role.k === 'isolated' ? '不要スーツの孤立牌' : '不要スーツの' + top.role.label) + 'です。';
    } else if (top.role.k === 'isolated') {
      var isoList = scored.filter(function (x) { return x.role.k === 'isolated'; })
        .sort(function (a, b) { return a.role.iso.v - b.role.iso.v; });
      var isFirst = isoList.length > 0 && isoList[0].c.tile === top.c.tile;
      reason = blocks >= 5
        ? '5ブロックは足りているので、ブロックに入らない孤立牌から処理します。'
        : phase.name + '（' + phase.turns + '）は' + phase.axis + 'が最優先。';
      if (isFirst && isoList.length > 1) {
        rule = '孤立牌の切り順';
        reason += tl(top.c.tile) + 'は' + top.role.iso.why + '。'
          + '切り順は「2枚切れ字牌 → オタ風 → 孤立1・9 → 役牌 → 孤立2・8 → 孤立5 → 孤立4・6 → 孤立3・7」が基本です。';
      } else {
        rule = '余剰牌の整理';
        reason += tl(top.c.tile) + 'は受け入れを最も損なわない孤立牌で、切っても'
          + bestSh + '向聴のまま受け入れ' + top.c.ukeire + '枚を保てます。';
      }
    } else if (weakBlock && blocks >= 6) {
      rule = 'ブロック整理（6ブロック→5ブロック）';
      reason = '手牌は' + blocks + 'ブロックあります。弱いターツを外して強い5ブロックに絞るほうが、'
        + '一向聴での累計受け入れ（9種196枚 > 184枚）と守備の両面で優位です。'
        + tl(top.c.tile) + 'の' + top.role.label + 'が最も弱いブロックで、払う順は'
        + '「辺張 → 余剰対子 → 外嵌張 → 内嵌張 → 両嵌 → 両面」。';
    } else if (bestSh === 0) {
      rule = '聴牌維持';
      reason = '聴牌を維持します（待ち' + top.c.ukeire + '枚）。';
    } else if (blocks >= 6) {
      rule = '余剰牌の整理';
      reason = '手牌は' + blocks + 'ブロックあるので余剰牌を処理します。'
        + tl(top.c.tile) + 'を切っても' + bestSh + '向聴のままで、受け入れ' + top.c.ukeire + '枚を保てます。';
    } else {
      rule = '受け入れ最大';
      reason = phase.name + 'は' + phase.axis + 'を優先。'
        + tl(top.c.tile) + '切りで受け入れ' + top.c.ukeire + '枚（' + bestSh + '向聴）が最大です。';
    }

    // 安全度の注記
    if (foldThs.length) {
      var who2 = foldThs.map(function (t) { return (t.riichi ? 'リーチ' : t.melds + 'フーロ'); }).join('・');
      var dgt = D.estimate(view, top.c.tile, foldThs);
      if (dgt.rate <= 0.001) {
        reason += ' ' + who2 + 'に対して' + tl(top.c.tile) + 'は' + dgt.label + 'なので安全です。';
      } else {
        reason += ' ' + who2 + 'に対し放銃率' + Math.round(dgt.rate * 100) + '%（' + dgt.label + '）ですが、'
          + (bestSh === 0 ? '聴牌なので押す場面' : 'この手（' + bestSh + '向聴・'
            + (goodShape ? '好形' : '愚形') + '・打点目安' + value + '翻）で押せる基準'
            + Math.round(risk * 100) + '%の範囲内') + 'です。';
      }
    }
    // 受け入れを削ってでもこちらを選ぶ理由
    if (ukLoss >= 2) {
      var maxTile = pool.filter(function (c) { return c.ukeire === maxUk; })[0].tile;
      reason += ' 受け入れ最大は' + tl(maxTile) + '（' + maxUk + '枚、' + ukLoss + '枚差）ですが、'
        + (top.vLoss > 1.5 ? '打点と手役' : (foldThs.length ? '安全度' : '牌の価値')) + 'を加味してこちらを推奨します。';
    }

    return Object.assign(info, {
      tile: top.c.tile, ukeire: top.c.ukeire, tiles: top.c.tiles,
      mode: foldThs.length ? 'push' : 'efficiency',
      rule: rule, reason: reason, role: top.role,
      ranked: scored.slice(0, 5).map(function (x) {
        return { tile: x.c.tile, ukeire: x.c.ukeire, score: Math.round(x.score * 10) / 10, role: x.role.label };
      })
    });
  }

  global.MJDiscard = {
    recommend: recommend,
    tileRole: tileRole,
    isolatedPriority: isolatedPriority,
    isIsolated: isIsolated,
    yakuPlan: yakuPlan,
    handValue: handValue,
    countBlocks: countBlocks,
    doraSet: doraSet,
    isYakuhai: isYakuhai,
    isMenzen: isMenzen
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
