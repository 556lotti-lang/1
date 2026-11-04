/* 役判定 / 符計算 / 点数計算 */
(function (global) {
  'use strict';
  var C = global.MJCore;

  function ceil100(x) { return Math.ceil(x / 100) * 100; }

  function limitName(han, yakuman) {
    if (yakuman > 0) return yakuman === 1 ? '役満' : yakuman + '倍役満';
    if (han >= 13) return '数え役満';
    if (han >= 11) return '三倍満';
    if (han >= 8) return '倍満';
    if (han >= 6) return '跳満';
    if (han >= 5) return '満貫';
    return '';
  }

  function basePoints(han, fu, yakuman) {
    if (yakuman > 0) return 8000 * yakuman;
    if (han >= 13) return 8000;
    if (han >= 11) return 6000;
    if (han >= 8) return 4000;
    if (han >= 6) return 3000;
    if (han >= 5) return 2000;
    var b = fu * Math.pow(2, 2 + han);
    return Math.min(b, 2000);
  }

  // 支払い計算
  function payments(base, isDealer, isTsumo) {
    if (isTsumo) {
      if (isDealer) {
        var e = ceil100(base * 2);
        return { total: e * 3, fromEach: e };
      }
      var d = ceil100(base * 2), o = ceil100(base);
      return { total: d + o * 2, fromDealer: d, fromOther: o };
    }
    var t = ceil100(base * (isDealer ? 6 : 4));
    return { total: t };
  }

  function isYakuhaiPair(t, seat, round) {
    return C.isDragon(t) || t === seat || t === round;
  }

  // melds -> blocks
  function meldBlocks(melds) {
    var out = [];
    for (var i = 0; i < melds.length; i++) {
      var m = melds[i];
      if (m.type === 'chi') out.push({ kind: 'shuntsu', tile: m.tile, open: true, kan: false });
      else if (m.type === 'pon') out.push({ kind: 'kotsu', tile: m.tile, open: true, kan: false });
      else out.push({ kind: 'kotsu', tile: m.tile, open: !m.closed, kan: true });
    }
    return out;
  }

  function allTileCounts(concealed, melds) {
    var c = concealed.slice();
    for (var i = 0; i < melds.length; i++) {
      var m = melds[i];
      if (m.type === 'chi') { c[m.tile]++; c[m.tile + 1]++; c[m.tile + 2]++; }
      else if (m.type === 'pon') c[m.tile] += 3;
      else c[m.tile] += 4;
    }
    return c;
  }

  function countDora(allCounts, doraList) {
    var n = 0;
    for (var i = 0; i < doraList.length; i++) n += allCounts[doraList[i]] || 0;
    return n;
  }

  /* ---- 候補(分解 + 待ち)ごとの役計算 ---- */

  function evalCandidate(cand, o) {
    var blocks = cand.blocks, pair = cand.pair, wait = cand.wait;
    var yaku = [], han = 0, yakuman = 0;
    var i, b;
    var menzen = o.menzen;
    var allC = cand.allCounts;

    function add(name, h) { yaku.push({ name: name, han: h }); han += h; }
    function addYakuman(name, mult) { yaku.push({ name: name, han: 0, yakuman: mult }); yakuman += mult; }

    var shuntsu = [], kotsu = [], ankoCount = 0, kanCount = 0;
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (b.kind === 'shuntsu') shuntsu.push(b);
      else {
        kotsu.push(b);
        if (!b.open) ankoCount++;
      }
      if (b.kan) kanCount++;
    }

    // 牌構成情報
    var suits = {}, hasHonor = false, hasTerminal = false, allYaochu = true, allSimple = true;
    for (i = 0; i < 34; i++) {
      if (!allC[i]) continue;
      if (C.isHonor(i)) { hasHonor = true; suits[3] = 1; }
      else suits[C.suitOf(i)] = 1;
      if (C.isTerminal(i)) hasTerminal = true;
      if (C.isYaochu(i)) allSimple = false; else allYaochu = false;
    }
    var suitKinds = Object.keys(suits).filter(function (k) { return k !== '3'; });

    // --- 役満 ---
    if (cand.type === 'kokushi') {
      if (cand.kokushi13) addYakuman('国士無双十三面', 2);
      else addYakuman('国士無双', 1);
    } else {
      // 四暗刻
      if (ankoCount === 4) {
        if (wait === 'tanki') addYakuman('四暗刻単騎', 2);
        else addYakuman('四暗刻', 1);
      }
      // 大三元 / 小三元
      var dragonKotsu = 0;
      for (i = 0; i < kotsu.length; i++) if (C.isDragon(kotsu[i].tile)) dragonKotsu++;
      if (dragonKotsu === 3) addYakuman('大三元', 1);
      // 四喜和
      var windKotsu = 0;
      for (i = 0; i < kotsu.length; i++) if (C.isWind(kotsu[i].tile)) windKotsu++;
      if (windKotsu === 4) addYakuman('大四喜', 2);
      else if (windKotsu === 3 && C.isWind(pair)) addYakuman('小四喜', 1);
      // 字一色
      if (allYaochu && !hasTerminal && suitKinds.length === 0) addYakuman('字一色', 1);
      // 清老頭
      if (allYaochu && !hasHonor && kotsu.length === 4) addYakuman('清老頭', 1);
      // 緑一色
      var greenOk = true;
      for (i = 0; i < 34; i++) {
        if (!allC[i]) continue;
        if (!(i === 19 || i === 20 || i === 21 || i === 23 || i === 25 || i === 32)) { greenOk = false; break; }
      }
      if (greenOk) addYakuman('緑一色', 1);
      // 四槓子
      if (kanCount === 4) addYakuman('四槓子', 1);
      // 九蓮宝燈
      if (menzen && suitKinds.length === 1 && !hasHonor) {
        var s = +suitKinds[0], ok = true, extra = -1;
        for (i = 0; i < 9; i++) {
          var need = (i === 0 || i === 8) ? 3 : 1;
          var v = allC[s * 9 + i];
          if (v < need) { ok = false; break; }
          if (v === need + 1) { if (extra >= 0) { ok = false; break; } extra = i; }
          else if (v !== need) { ok = false; break; }
        }
        if (ok && extra >= 0) {
          var baseC = allC.slice(); baseC[o.winTile]--;
          var pure = true;
          for (i = 0; i < 9; i++) {
            var nd = (i === 0 || i === 8) ? 3 : 1;
            if (baseC[s * 9 + i] !== nd) { pure = false; break; }
          }
          if (pure) addYakuman('純正九蓮宝燈', 2); else addYakuman('九蓮宝燈', 1);
        }
      }
      if (o.isTenhou && menzen) addYakuman('天和', 1);
      if (o.isChiihou && menzen) addYakuman('地和', 1);
    }

    if (yakuman > 0) {
      return { yaku: yaku, han: 0, fu: 0, yakuman: yakuman, wait: wait, blocks: blocks, pair: pair };
    }

    // --- 通常役 ---
    if (o.isDoubleRiichi) add('ダブル立直', 2);
    else if (o.isRiichi) add('立直', 1);
    if (o.isIppatsu) add('一発', 1);
    if (o.isTsumo && menzen) add('門前清自摸和', 1);
    if (o.isHaitei) add('海底摸月', 1);
    if (o.isHoutei) add('河底撈魚', 1);
    if (o.isRinshan) add('嶺上開花', 1);
    if (o.isChankan) add('槍槓', 1);

    if (cand.type === 'chiitoi') {
      add('七対子', 2);
    }

    // 平和
    var pinfu = false;
    if (cand.type === 'standard' && menzen && shuntsu.length === 4 &&
      !isYakuhaiPair(pair, o.seatWind, o.roundWind) && wait === 'ryanmen') {
      pinfu = true; add('平和', 1);
    }

    // 断么九
    if (allSimple && (menzen || o.kuitan !== false)) add('断么九', 1);

    // 役牌
    if (cand.type !== 'chiitoi') {
      for (i = 0; i < kotsu.length; i++) {
        var kt = kotsu[i].tile;
        if (C.isDragon(kt)) add('役牌 ' + C.typeLabel(kt), 1);
        else if (kt === o.roundWind) add('場風 ' + C.typeLabel(kt), 1);
        if (kt === o.seatWind) add('自風 ' + C.typeLabel(kt), 1);
      }
    }

    // 一盃口 / 二盃口
    if (menzen && cand.type === 'standard') {
      var cnt = {};
      for (i = 0; i < shuntsu.length; i++) cnt[shuntsu[i].tile] = (cnt[shuntsu[i].tile] || 0) + 1;
      var peiko = 0;
      for (var k in cnt) peiko += Math.floor(cnt[k] / 2);
      if (peiko >= 2) add('二盃口', 3);
      else if (peiko === 1) add('一盃口', 1);
    }

    // 三色同順
    if (cand.type === 'standard') {
      var byRank = {};
      for (i = 0; i < shuntsu.length; i++) {
        var t = shuntsu[i].tile;
        if (t >= 27) continue;
        var r = t % 9, su = Math.floor(t / 9);
        byRank[r] = byRank[r] || {};
        byRank[r][su] = 1;
      }
      for (var rk in byRank) {
        if (Object.keys(byRank[rk]).length === 3) { add('三色同順', menzen ? 2 : 1); break; }
      }
      // 一気通貫
      var bySuit = {};
      for (i = 0; i < shuntsu.length; i++) {
        var tt = shuntsu[i].tile;
        if (tt >= 27) continue;
        var s2 = Math.floor(tt / 9), r2 = tt % 9;
        bySuit[s2] = bySuit[s2] || {};
        bySuit[s2][r2] = 1;
      }
      for (var sk in bySuit) {
        if (bySuit[sk][0] && bySuit[sk][3] && bySuit[sk][6]) { add('一気通貫', menzen ? 2 : 1); break; }
      }
      // 三色同刻
      var kByRank = {};
      for (i = 0; i < kotsu.length; i++) {
        var kt2 = kotsu[i].tile;
        if (kt2 >= 27) continue;
        var kr = kt2 % 9;
        kByRank[kr] = (kByRank[kr] || 0) + 1;
      }
      for (var kr2 in kByRank) if (kByRank[kr2] === 3) { add('三色同刻', 2); break; }
    }

    // 対々和 / 三暗刻 / 三槓子
    if (cand.type === 'standard') {
      if (kotsu.length === 4) add('対々和', 2);
      if (ankoCount === 3) add('三暗刻', 2);
      if (kanCount === 3) add('三槓子', 2);
      // 小三元
      var dk = 0;
      for (i = 0; i < kotsu.length; i++) if (C.isDragon(kotsu[i].tile)) dk++;
      if (dk === 2 && C.isDragon(pair)) add('小三元', 2);
    }

    // 混老頭 / 混全帯么九 / 純全帯么九
    if (allYaochu) {
      add('混老頭', 2);
    } else if (cand.type === 'standard') {
      var allHaveYaochu = C.isYaochu(pair);
      if (allHaveYaochu) {
        for (i = 0; i < blocks.length; i++) {
          b = blocks[i];
          if (b.kind === 'kotsu') { if (!C.isYaochu(b.tile)) { allHaveYaochu = false; break; } }
          else {
            var r3 = b.tile % 9;
            if (!(r3 === 0 || r3 === 6)) { allHaveYaochu = false; break; }
          }
        }
      }
      if (allHaveYaochu) {
        if (hasHonor) add('混全帯么九', menzen ? 2 : 1);
        else add('純全帯么九', menzen ? 3 : 2);
      }
    }

    // 混一色 / 清一色
    if (suitKinds.length === 1) {
      if (hasHonor) add('混一色', menzen ? 3 : 2);
      else add('清一色', menzen ? 6 : 5);
    }

    if (han === 0) {
      return null; // 役なし
    }

    // --- 符 ---
    var fu;
    if (cand.type === 'chiitoi') {
      fu = 25;
    } else {
      fu = 20;
      for (i = 0; i < blocks.length; i++) {
        b = blocks[i];
        if (b.kind !== 'kotsu') continue;
        var yc = C.isYaochu(b.tile);
        var f;
        if (b.kan) f = b.open ? (yc ? 16 : 8) : (yc ? 32 : 16);
        else f = b.open ? (yc ? 4 : 2) : (yc ? 8 : 4);
        fu += f;
      }
      if (isYakuhaiPair(pair, o.seatWind, o.roundWind)) fu += 2;
      if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
      if (menzen && !o.isTsumo) fu += 10;
      if (o.isTsumo && !pinfu) fu += 2;
      if (pinfu) fu = o.isTsumo ? 20 : 30;
      else if (fu === 20) fu = 30; // 喰い平和形
      fu = Math.ceil(fu / 10) * 10;
    }

    return { yaku: yaku, han: han, fu: fu, yakuman: 0, wait: wait, blocks: blocks, pair: pair, pinfu: pinfu };
  }

  /* ---- 候補列挙 ---- */

  function buildCandidates(o) {
    var concealed = o.concealed, melds = o.melds || [], winTile = o.winTile;
    var mb = meldBlocks(melds);
    var allC = allTileCounts(concealed, melds);
    var out = [];

    // 国士無双
    if (C.isKokushiAgari(concealed, melds.length)) {
      var k13 = concealed[winTile] === 1; // 和了牌が単独 => 13面待ち
      out.push({ type: 'kokushi', blocks: [], pair: winTile, wait: 'tanki', allCounts: allC, kokushi13: k13 });
    }
    // 七対子
    if (C.isChiitoiAgari(concealed, melds.length)) {
      out.push({ type: 'chiitoi', blocks: [], pair: winTile, wait: 'tanki', allCounts: allC });
    }
    // 通常形
    var parses = C.parseStandard(concealed, melds.length);
    for (var pi = 0; pi < parses.length; pi++) {
      var p = parses[pi];
      var seen = {};
      // 雀頭待ち
      if (p.pair === winTile) {
        out.push({
          type: 'standard', pair: p.pair, wait: 'tanki', allCounts: allC,
          blocks: mb.concat(p.sets.map(function (s) { return { kind: s.kind, tile: s.tile, open: false, kan: false }; }))
        });
      }
      for (var si = 0; si < p.sets.length; si++) {
        var s = p.sets[si];
        var wait = null;
        if (s.kind === 'kotsu') {
          if (s.tile === winTile) wait = 'shanpon';
        } else {
          var sr = s.tile % 9 + 1, wr = winTile % 9 + 1;
          if (C.suitOf(s.tile) === C.suitOf(winTile) && winTile < 27) {
            if (wr === sr + 1) wait = 'kanchan';
            else if (wr === sr) wait = (sr === 7) ? 'penchan' : 'ryanmen';
            else if (wr === sr + 2) wait = (sr === 1) ? 'penchan' : 'ryanmen';
          }
        }
        if (!wait) continue;
        var sig = s.kind + ':' + s.tile + ':' + wait;
        if (seen[sig]) continue;
        seen[sig] = 1;
        var blocks = mb.slice();
        for (var sj = 0; sj < p.sets.length; sj++) {
          var ss = p.sets[sj];
          var openFlag = false;
          if (sj === si && ss.kind === 'kotsu' && !o.isTsumo) openFlag = true; // ロンの明刻
          blocks.push({ kind: ss.kind, tile: ss.tile, open: openFlag, kan: false });
        }
        out.push({ type: 'standard', pair: p.pair, wait: wait, allCounts: allC, blocks: blocks });
      }
    }
    return out;
  }

  function score(o) {
    o = o || {};
    o.melds = o.melds || [];
    o.dora = o.dora || [];
    o.ura = o.ura || [];
    var menzen = true;
    for (var i = 0; i < o.melds.length; i++) {
      var m = o.melds[i];
      if (m.type === 'chi' || m.type === 'pon' || (m.type === 'kan' && !m.closed)) menzen = false;
    }
    o.menzen = menzen;

    var cands = buildCandidates(o);
    if (!cands.length) return null;

    var doraCount = 0, uraCount = 0, red = o.redCount || 0;
    var allC = allTileCounts(o.concealed, o.melds);
    doraCount = countDora(allC, o.dora);
    if (o.isRiichi || o.isDoubleRiichi) uraCount = countDora(allC, o.ura);

    var best = null;
    for (var ci = 0; ci < cands.length; ci++) {
      var r = evalCandidate(cands[ci], o);
      if (!r) continue;
      var han = r.han, yaku = r.yaku.slice();
      if (r.yakuman === 0) {
        if (doraCount) { yaku.push({ name: 'ドラ' + doraCount, han: doraCount }); han += doraCount; }
        if (red) { yaku.push({ name: '赤ドラ' + red, han: red }); han += red; }
        if (uraCount) { yaku.push({ name: '裏ドラ' + uraCount, han: uraCount }); han += uraCount; }
      }
      var base = basePoints(han, r.fu, r.yakuman);
      var pay = payments(base, !!o.isDealer, !!o.isTsumo);
      var cand = {
        han: han, fu: r.fu, yakuman: r.yakuman, yaku: yaku, wait: r.wait,
        base: base, points: pay.total, pay: pay, name: limitName(han, r.yakuman),
        blocks: r.blocks, pair: r.pair, menzen: menzen
      };
      if (!best || cand.points > best.points ||
        (cand.points === best.points && (cand.han > best.han ||
          (cand.han === best.han && cand.fu > best.fu)))) best = cand;
    }
    return best;
  }

  global.MJScore = {
    score: score,
    basePoints: basePoints,
    payments: payments,
    limitName: limitName,
    ceil100: ceil100
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
