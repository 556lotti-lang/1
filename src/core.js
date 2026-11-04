/* 麻雀コアエンジン: 牌表現 / シャンテン数 / 受け入れ / 和了形分解 */
(function (global) {
  'use strict';

  // 牌種 index: 0-8=1m..9m, 9-17=1p..9p, 18-26=1s..9s, 27-33=東南西北白發中
  var NUM_TYPES = 34;
  var HONOR_LABEL = ['東', '南', '西', '北', '白', '發', '中'];
  var SUIT_CHAR = ['萬', '筒', '索'];
  var RED_IDS = { 16: 1, 52: 1, 88: 1 }; // 赤5m / 赤5p / 赤5s

  function idToType(id) { return id >> 2; }
  function isRedId(id) { return !!RED_IDS[id]; }
  function isHonor(t) { return t >= 27; }
  function isWind(t) { return t >= 27 && t <= 30; }
  function isDragon(t) { return t >= 31; }
  function isTerminal(t) { return t < 27 && (t % 9 === 0 || t % 9 === 8); }
  function isYaochu(t) { return isHonor(t) || isTerminal(t); }
  function suitOf(t) { return t < 27 ? Math.floor(t / 9) : 3; }
  function rankOf(t) { return t < 27 ? (t % 9) + 1 : 0; }

  function typeToStr(t) {
    if (t < 27) return (t % 9 + 1) + 'mps'[Math.floor(t / 9)];
    return HONOR_LABEL[t - 27];
  }
  function typeLabel(t) {
    if (t < 27) return (t % 9 + 1) + SUIT_CHAR[Math.floor(t / 9)];
    return HONOR_LABEL[t - 27];
  }
  // ドラ表示牌 -> 実際のドラ
  function doraFromIndicator(t) {
    if (t < 27) {
      var s = Math.floor(t / 9), r = t % 9;
      return s * 9 + ((r + 1) % 9);
    }
    if (t <= 30) return 27 + ((t - 27 + 1) % 4);
    return 31 + ((t - 31 + 1) % 3);
  }

  function emptyCounts() {
    var c = new Array(NUM_TYPES);
    for (var i = 0; i < NUM_TYPES; i++) c[i] = 0;
    return c;
  }
  function countsFromIds(ids) {
    var c = emptyCounts();
    for (var i = 0; i < ids.length; i++) c[idToType(ids[i])]++;
    return c;
  }
  function cloneCounts(c) { return c.slice(); }
  function sumCounts(c) {
    var s = 0; for (var i = 0; i < NUM_TYPES; i++) s += c[i]; return s;
  }

  /* ---------- シャンテン数 ---------- */

  // 通常形。melds = 確定面子数(鳴き・カン)
  // 低速リファレンス実装(テスト用)
  function shantenStandardSlow(c, melds) {
    melds = melds || 0;
    var best = 8;
    var work = c.slice();
    function record(sets, partials, hasPair) {
      var blocks = melds + sets + partials;
      var s = 8 - 2 * (melds + sets) - partials;
      if (blocks === 5 && !hasPair) s += 1;
      if (s < best) best = s;
    }
    function dfs(start, sets, partials, hasPair) {
      record(sets, partials, hasPair);
      if (melds + sets + partials >= 5) return;
      for (var i = start; i < NUM_TYPES; i++) {
        if (work[i] === 0) continue;
        if (work[i] >= 3) { work[i] -= 3; dfs(i, sets + 1, partials, hasPair); work[i] += 3; }
        if (i < 27 && i % 9 <= 6 && work[i + 1] > 0 && work[i + 2] > 0) {
          work[i]--; work[i + 1]--; work[i + 2]--;
          dfs(i, sets + 1, partials, hasPair);
          work[i]++; work[i + 1]++; work[i + 2]++;
        }
        if (work[i] >= 2) { work[i] -= 2; dfs(i, sets, partials + 1, true); work[i] += 2; }
        if (i < 27 && i % 9 <= 7 && work[i + 1] > 0) {
          work[i]--; work[i + 1]--; dfs(i, sets, partials + 1, hasPair); work[i]++; work[i + 1]++;
        }
        if (i < 27 && i % 9 <= 6 && work[i + 2] > 0) {
          work[i]--; work[i + 2]--; dfs(i, sets, partials + 1, hasPair); work[i]++; work[i + 2]++;
        }
      }
    }
    dfs(0, 0, 0, false);
    return best;
  }

  // --- 高速版: スート単位の分解表をメモ化し、4グループをDPで合成 ---
  // 表の形式: Uint8Array(30) idx = sets*6 + partials, bit0=雀頭なしで可, bit1=雀頭ありで可
  var suitMemo = new Map();
  var honorMemo = new Map();

  function buildSuitTable(c, off, len, honor) {
    var res = new Uint8Array(30);
    var work = new Array(len);
    for (var i = 0; i < len; i++) work[i] = c[off + i];
    function dfs(start, sets, partials, hasPair) {
      res[sets * 6 + partials] |= hasPair ? 2 : 1;
      if (sets + partials >= 5) return;
      for (var i = start; i < len; i++) {
        if (work[i] === 0) continue;
        if (work[i] >= 3) { work[i] -= 3; dfs(i, sets + 1, partials, hasPair); work[i] += 3; }
        if (!honor) {
          if (i <= len - 3 && work[i + 1] > 0 && work[i + 2] > 0) {
            work[i]--; work[i + 1]--; work[i + 2]--;
            dfs(i, sets + 1, partials, hasPair);
            work[i]++; work[i + 1]++; work[i + 2]++;
          }
        }
        if (work[i] >= 2) { work[i] -= 2; dfs(i, sets, partials + 1, true); work[i] += 2; }
        if (!honor) {
          if (i <= len - 2 && work[i + 1] > 0) {
            work[i]--; work[i + 1]--; dfs(i, sets, partials + 1, hasPair); work[i]++; work[i + 1]++;
          }
          if (i <= len - 3 && work[i + 2] > 0) {
            work[i]--; work[i + 2]--; dfs(i, sets, partials + 1, hasPair); work[i]++; work[i + 2]++;
          }
        }
      }
    }
    dfs(0, 0, 0, false);
    return res;
  }

  function suitTable(c, off, len, honor) {
    var key = 0;
    for (var i = 0; i < len; i++) key = key * 5 + c[off + i];
    var memo = honor ? honorMemo : suitMemo;
    var hit = memo.get(key);
    if (hit) return hit;
    var tbl = buildSuitTable(c, off, len, honor);
    memo.set(key, tbl);
    return tbl;
  }

  // dp状態: idx = (sets*6 + partials)*2 + pairFlag
  var dpA = new Uint8Array(60), dpB = new Uint8Array(60);

  function shantenStandard(c, melds) {
    melds = melds || 0;
    var maxSets = 4 - melds;
    if (maxSets < 0) maxSets = 0;
    var cur = dpA, nxt = dpB, i, j;
    for (i = 0; i < 60; i++) cur[i] = 0;
    cur[0] = 1;
    var groups = [0, 9, 18, 27];
    for (var g = 0; g < 4; g++) {
      var honor = g === 3;
      var tbl = suitTable(c, groups[g], honor ? 7 : 9, honor);
      for (i = 0; i < 60; i++) nxt[i] = 0;
      var any = false;
      for (var s1 = 0; s1 <= maxSets; s1++) {
        for (var p1 = 0; p1 + s1 <= 5; p1++) {
          for (var f1 = 0; f1 < 2; f1++) {
            if (!cur[(s1 * 6 + p1) * 2 + f1]) continue;
            for (var s2 = 0; s1 + s2 <= maxSets; s2++) {
              for (var p2 = 0; p2 + s2 <= 5 && p1 + p2 + s1 + s2 <= 5; p2++) {
                var bits = tbl[s2 * 6 + p2];
                if (!bits) continue;
                var ns = s1 + s2, np = p1 + p2;
                if (bits & 1) { nxt[(ns * 6 + np) * 2 + f1] = 1; any = true; }
                if (bits & 2) { nxt[(ns * 6 + np) * 2 + 1] = 1; any = true; }
              }
            }
          }
        }
      }
      if (!any) return 8;
      var tmp = cur; cur = nxt; nxt = tmp;
    }
    var best = 8;
    for (var s = 0; s <= maxSets; s++) {
      for (var p = 0; p + s <= 5; p++) {
        for (var f = 0; f < 2; f++) {
          if (!cur[(s * 6 + p) * 2 + f]) continue;
          var blocks = melds + s + p;
          if (blocks > 5) continue;
          var sh = 8 - 2 * (melds + s) - p;
          if (blocks === 5 && !f) sh += 1;
          if (sh < best) best = sh;
        }
      }
    }
    if (dpA !== cur) { var t2 = dpA; dpA = cur; dpB = t2; }
    return best;
  }

  function shantenChiitoi(c, melds) {
    if (melds) return 99;
    var pairs = 0, kinds = 0;
    for (var i = 0; i < NUM_TYPES; i++) {
      if (c[i] >= 2) pairs++;
      if (c[i] >= 1) kinds++;
    }
    var s = 6 - pairs;
    if (kinds < 7) s += 7 - kinds;
    return s;
  }

  function shantenKokushi(c, melds) {
    if (melds) return 99;
    var kinds = 0, hasPair = false;
    for (var i = 0; i < NUM_TYPES; i++) {
      if (!isYaochu(i)) continue;
      if (c[i] >= 1) kinds++;
      if (c[i] >= 2) hasPair = true;
    }
    return 13 - kinds - (hasPair ? 1 : 0);
  }

  // -1 = 和了形
  function shanten(c, melds) {
    melds = melds || 0;
    var a = shantenStandard(c, melds);
    var b = shantenChiitoi(c, melds);
    var d = shantenKokushi(c, melds);
    return Math.min(a, Math.min(b, d));
  }

  function shantenDetail(c, melds) {
    melds = melds || 0;
    var a = shantenStandard(c, melds);
    var b = shantenChiitoi(c, melds);
    var d = shantenKokushi(c, melds);
    var m = Math.min(a, Math.min(b, d));
    return { shanten: m, standard: a, chiitoi: b, kokushi: d };
  }

  /* ---------- 和了形分解 ---------- */

  function extractSets(work, need) {
    if (need === 0) {
      for (var k = 0; k < NUM_TYPES; k++) if (work[k] !== 0) return [];
      return [[]];
    }
    var i = 0;
    while (i < NUM_TYPES && work[i] === 0) i++;
    if (i === NUM_TYPES) return [];
    var out = [], sub, j;
    if (work[i] >= 3) {
      work[i] -= 3;
      sub = extractSets(work, need - 1);
      for (j = 0; j < sub.length; j++) out.push([{ kind: 'kotsu', tile: i }].concat(sub[j]));
      work[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && work[i + 1] > 0 && work[i + 2] > 0) {
      work[i]--; work[i + 1]--; work[i + 2]--;
      sub = extractSets(work, need - 1);
      for (j = 0; j < sub.length; j++) out.push([{ kind: 'shuntsu', tile: i }].concat(sub[j]));
      work[i]++; work[i + 1]++; work[i + 2]++;
    }
    return out;
  }

  // 面子手の分解一覧 [{sets:[...], pair:type}]
  function parseStandard(c, melds) {
    melds = melds || 0;
    var total = sumCounts(c);
    if (total % 3 !== 2) return [];
    var need = (total - 2) / 3;
    if (need + melds !== 4) return [];
    var out = [];
    for (var p = 0; p < NUM_TYPES; p++) {
      if (c[p] < 2) continue;
      var work = c.slice();
      work[p] -= 2;
      var sets = extractSets(work, need);
      for (var i = 0; i < sets.length; i++) out.push({ sets: sets[i], pair: p });
    }
    return out;
  }

  function isChiitoiAgari(c, melds) {
    if (melds) return false;
    if (sumCounts(c) !== 14) return false;
    var pairs = 0;
    for (var i = 0; i < NUM_TYPES; i++) {
      if (c[i] === 0) continue;
      if (c[i] !== 2) return false;
      pairs++;
    }
    return pairs === 7;
  }

  function isKokushiAgari(c, melds) {
    if (melds) return false;
    if (sumCounts(c) !== 14) return false;
    var kinds = 0, pair = 0;
    for (var i = 0; i < NUM_TYPES; i++) {
      if (c[i] === 0) continue;
      if (!isYaochu(i)) return false;
      if (c[i] === 2) pair++;
      else if (c[i] !== 1) return false;
      kinds++;
    }
    return kinds === 13 && pair === 1;
  }

  function isAgariCounts(c, melds) {
    melds = melds || 0;
    if (isChiitoiAgari(c, melds) || isKokushiAgari(c, melds)) return true;
    return parseStandard(c, melds).length > 0;
  }

  /* ---------- 待ち / 受け入れ ---------- */

  // 13枚形(c)の待ち牌
  function waitsOf(c, melds) {
    melds = melds || 0;
    var out = [];
    for (var t = 0; t < NUM_TYPES; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      if (isAgariCounts(c, melds)) out.push(t);
      c[t]--;
    }
    return out;
  }

  function isTenpai(c, melds) { return shanten(c, melds) === 0; }

  // seen: 既に見えている牌のcounts(自分の手牌含む)。省略時は手牌のみ
  function ukeire(c, melds, seen) {
    melds = melds || 0;
    var base = shanten(c, melds);
    var tiles = [], total = 0;
    for (var t = 0; t < NUM_TYPES; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      var s = shanten(c, melds);
      c[t]--;
      if (s < base) {
        var used = seen ? seen[t] : c[t];
        var left = 4 - used;
        if (left > 0) { tiles.push({ type: t, count: left }); total += left; }
      }
    }
    return { shanten: base, tiles: tiles, total: total };
  }

  // 14枚形から各打牌候補を評価
  function discardOptions(c, melds, seen) {
    melds = melds || 0;
    var out = [];
    for (var t = 0; t < NUM_TYPES; t++) {
      if (c[t] === 0) continue;
      c[t]--;
      var u = ukeire(c, melds, seen);
      out.push({ tile: t, shanten: u.shanten, ukeire: u.total, tiles: u.tiles });
      c[t]++;
    }
    out.sort(function (a, b) {
      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
      return b.ukeire - a.ukeire;
    });
    return out;
  }

  global.MJCore = {
    NUM_TYPES: NUM_TYPES,
    HONOR_LABEL: HONOR_LABEL,
    idToType: idToType,
    isRedId: isRedId,
    isHonor: isHonor,
    isWind: isWind,
    isDragon: isDragon,
    isTerminal: isTerminal,
    isYaochu: isYaochu,
    suitOf: suitOf,
    rankOf: rankOf,
    typeToStr: typeToStr,
    typeLabel: typeLabel,
    doraFromIndicator: doraFromIndicator,
    emptyCounts: emptyCounts,
    countsFromIds: countsFromIds,
    cloneCounts: cloneCounts,
    sumCounts: sumCounts,
    shanten: shanten,
    shantenDetail: shantenDetail,
    shantenStandard: shantenStandard,
    shantenStandardSlow: shantenStandardSlow,
    shantenChiitoi: shantenChiitoi,
    shantenKokushi: shantenKokushi,
    parseStandard: parseStandard,
    isChiitoiAgari: isChiitoiAgari,
    isKokushiAgari: isKokushiAgari,
    isAgariCounts: isAgariCounts,
    waitsOf: waitsOf,
    isTenpai: isTenpai,
    ukeire: ukeire,
    discardOptions: discardOptions
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
