/* 検討エンジン
   判定基準は共有ドキュメント「麻雀の上達法と必須スキル」に準拠。
   - 押し引き: 聴牌は押し / 1向聴は打点・形・巡目に応じた許容放銃率 / 2向聴以下は即ベタオリ
   - 副露: 役の確定性 → 打点2翻以上 → 1鳴き原則と残存形
   - 牌効率: 5ブロック理論と孤立牌の価値序列（字牌 < 1,9 < 2,8 < 3-7）
   - 指摘の並びは「失点への影響度順」（押し引き > 副露 > 手牌進行 > リーチ判断 > 孤立牌の切り順） */
(function (global) {
  'use strict';
  var C = global.MJCore, D = global.MJDanger, Th = global.MJTheory, AI = global.MJAI;

  function tl(t) { return C.typeLabel(t); }
  function tileListStr(tiles, max) {
    max = max || 7;
    var head = tiles.slice(0, max).map(function (x) { return tl(x.type) + (x.count != null ? '×' + x.count : ''); }).join('・');
    if (tiles.length > max) head += ' 他' + (tiles.length - max) + '種';
    return head;
  }
  var SEAT_NAME = ['自分', '下家', '対面', '上家'];
  function rel(view, p) { return SEAT_NAME[(p - view.me + 4) % 4]; }
  function pct(x) { return (x * 100).toFixed(0) + '%'; }

  /* ブロック数（面子＋ターツ＋雀頭）を最良分解から求める */
  function blockCount(counts, melds) {
    var work = counts.slice();
    var bestSh = 99, bestBlocks = 0;
    function rec(start, sets, partials, hasPair) {
      var blocks = melds + sets + partials;
      var sh = 8 - 2 * (melds + sets) - partials;
      if (blocks === 5 && !hasPair) sh += 1;
      if (sh < bestSh || (sh === bestSh && blocks > bestBlocks)) {
        if (sh < bestSh) { bestSh = sh; bestBlocks = blocks; }
        else bestBlocks = Math.max(bestBlocks, blocks);
      }
      if (blocks >= 5) return;
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

  function isIsolated(counts, t) {
    if (counts[t] > 1) return false;
    if (C.isHonor(t)) return true;
    var r = t % 9 + 1, base = t - (r - 1);
    for (var d = -2; d <= 2; d++) {
      if (d === 0) continue;
      var rr = r + d;
      if (rr < 1 || rr > 9) continue;
      if (counts[base + rr - 1]) return false;
    }
    return true;
  }


  /* 現局面の押し引き状況と推奨打（検討・アシスト・バッジで共通して使う） */
  function buildContext(view, cands, pool, bestSh, counts, melds, dora) {
    var ths = D.threats(view);
    var foldThs = D.foldThreats(view, ths);
    var go = Math.floor(view.turnCount / 4) + 1;
    var value = AI.handValue(view, counts, melds);
    var good = AI.isGoodShape(cands, bestSh);
    var risk = foldThs.length ? Th.allowedRisk(bestSh, good, value >= 4, go, view.wallLeft) : 1;
    var genbutsu = D.genbutsuInHand(view, ths);
    var recommend, mode;
    if (foldThs.length && risk <= 0.015) {
      mode = 'fold';
      recommend = cands.slice().sort(function (a, b) {
        var da = D.estimate(view, a.tile, ths).rate, db = D.estimate(view, b.tile, ths).rate;
        if (da !== db) return da - db;
        return b.ukeire - a.ukeire;
      })[0];
    } else if (foldThs.length) {
      mode = 'push';
      var okRisk = pool.filter(function (c) { return D.estimate(view, c.tile, ths).rate <= risk; });
      recommend = (okRisk.length ? okRisk : pool).slice()
        .sort(function (a, b) { return b.ukeire - a.ukeire; })[0];
    } else {
      mode = 'efficiency';
      recommend = pool.map(function (c) {
        return {
          c: c, s: c.ukeire - (dora[c.tile] ? 4 : 0)
            - (AI.isYakuhaiType(view, c.tile) && counts[c.tile] >= 2 ? 4 : 0)
            + Th.isolatedValue(c.tile, view) * 0.01
        };
      }).sort(function (a, b) { return b.s - a.s; })[0].c;
    }
    return {
      ths: ths, foldThs: foldThs, go: go, value: value, good: good, risk: risk,
      genbutsu: genbutsu, recommend: recommend, mode: mode, bestShanten: bestSh
    };
  }

  /* 14枚の局面に対する推奨打（UIのアシスト用） */
  function recommendFor(view, opts) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    if (C.sumCounts(counts) % 3 !== 2) return null;
    var allowedTiles = null;
    if (opts && opts.discardable) {
      allowedTiles = {};
      for (var i = 0; i < opts.discardable.length; i++) allowedTiles[C.idToType(opts.discardable[i])] = 1;
    }
    var cands = C.discardOptions(counts, melds, view.seen);
    if (allowedTiles) cands = cands.filter(function (c) { return allowedTiles[c.tile]; });
    if (!cands.length) return null;
    var bestSh = cands[0].shanten;
    var pool = cands.filter(function (c) { return c.shanten === bestSh; });
    var ctx = buildContext(view, cands, pool, bestSh, counts, melds, AI.doraSet(view));
    return {
      tile: ctx.recommend.tile, ukeire: ctx.recommend.ukeire, tiles: ctx.recommend.tiles,
      shanten: ctx.recommend.shanten, mode: ctx.mode, risk: ctx.risk,
      danger: ctx.ths.length ? D.estimate(view, ctx.recommend.tile, ctx.ths) : null,
      genbutsu: ctx.genbutsu, bestShanten: bestSh,
      maxUkeire: pool.reduce(function (m, c) { return Math.max(m, c.ukeire); }, 0)
    };
  }

  /* ---------- 打牌の分析 ---------- */
  function analyzeDiscard(view, opts, chosenId) {
    var chosen = C.idToType(chosenId);
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var dora = AI.doraSet(view);
    var allowedTiles = {};
    for (var i = 0; i < opts.discardable.length; i++) allowedTiles[C.idToType(opts.discardable[i])] = 1;
    var cands = C.discardOptions(counts, melds, view.seen).filter(function (c) { return allowedTiles[c.tile]; });
    if (!cands.length) return null;

    var bestSh = cands[0].shanten;
    var pool = cands.filter(function (c) { return c.shanten === bestSh; });
    var maxUk = 0;
    for (i = 0; i < pool.length; i++) maxUk = Math.max(maxUk, pool[i].ukeire);

    var ctx = buildContext(view, cands, pool, bestSh, counts, melds, dora);
    var ths = ctx.ths, foldThs = ctx.foldThs, go = ctx.go, value = ctx.value,
      good = ctx.good, risk = ctx.risk, recommend = ctx.recommend, genbutsu = ctx.genbutsu;
    var dg = ths.length ? D.estimate(view, chosen, ths) : { rate: 0, label: '-' };

    var mine = null;
    for (i = 0; i < cands.length; i++) if (cands[i].tile === chosen) mine = cands[i];
    if (!mine) return null;

    var rec = {
      kind: 'discard',
      kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba,
      go: go, turnCount: view.turnCount,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)), drawn: view.drawn,
      chosen: chosen, chosenId: chosenId,
      shantenBefore: C.shanten(counts, melds),
      chosenShanten: mine.shanten, chosenUkeire: mine.ukeire, chosenTiles: mine.tiles,
      bestShanten: bestSh, bestUkeire: maxUk,
      recommend: recommend.tile, recommendUkeire: recommend.ukeire, recommendTiles: recommend.tiles,
      danger: dg.rate, dangerLabel: dg.label, allowedRisk: risk,
      handValue: value, goodShape: good, safeOptions: genbutsu,
      threats: ths.map(function (t) { return { p: t.p, riichi: t.riichi, melds: t.melds }; }),
      doraInd: view.doraInd.slice(),
      severity: null, category: null, comment: ''
    };
    var shLoss = mine.shanten - bestSh;
    var ukLoss = (mine.shanten === bestSh) ? (maxUk - mine.ukeire) : null;
    rec.shantenLoss = shLoss;
    rec.ukeireLoss = ukLoss;

    var who = foldThs.map(function (t) { return rel(view, t.p) + (t.riichi ? '(リーチ)' : '(' + t.melds + 'フーロ)'); }).join('・');
    var safeStr = genbutsu.length ? '現物は ' + genbutsu.map(tl).join('・') : '現物はありません';

    /* === 第1優先: 押し引き ===
       リーチ、または資料の守備モデル(3フーロ即/2フーロ7巡目/1フーロ10巡目)を超えた副露手が対象。
       それ以外の軽い仕掛けには過度に警戒せず、手牌進行を優先して評価する。 */
    if (foldThs.length) {
      if (bestSh >= 2) {
        if (dg.rate > 0.015) {
          rec.severity = dg.rate >= 0.08 ? 'high' : 'mid';
          rec.category = 'push';
          rec.comment = who + 'に対し、' + bestSh + '向聴から' + tl(chosen) + '（' + dg.label + '・推定放銃率'
            + pct(dg.rate) + '）を切っています。2向聴以下は即ベタオリが統計的セオリーです。'
            + (genbutsu.length ? safeStr + '。' : '現物はないので、この中では ' + tl(recommend.tile)
              + '（' + D.estimate(view, recommend.tile, ths).label + '・' + pct(D.estimate(view, recommend.tile, ths).rate) + '）が最も安全です。');
          return rec;
        }
        rec.category = 'ok-fold';
        rec.comment = tl(chosen) + 'は' + dg.label + '。2向聴以下でのベタオリは正着です。';
        return rec;
      }
      if (bestSh === 1) {
        if (dg.rate > risk) {
          rec.severity = dg.rate >= risk * 2 ? 'high' : 'mid';
          rec.category = 'push';
          rec.comment = '1向聴（' + (good ? '好形' : '愚形') + '・打点目安' + value + '翻）で'
            + who + 'に' + tl(chosen) + '（' + dg.label + '・' + pct(dg.rate) + '）を押しています。'
            + 'この条件・' + go + '巡目で押せるのは放銃率' + pct(risk) + 'までが基準です。'
            + (genbutsu.length ? safeStr + '。' : '安全牌がないので、より危険度の低い牌を選びます。');
          return rec;
        }
        var saferEqual = pool.filter(function (c) {
          return c.ukeire >= mine.ukeire && D.estimate(view, c.tile, ths).rate < dg.rate - 0.03;
        });
        if (saferEqual.length) {
          rec.severity = 'low'; rec.category = 'push';
          rec.comment = '押す判断は妥当です。ただし同じ受け入れで ' + tl(saferEqual[0].tile)
            + '（' + D.estimate(view, saferEqual[0].tile, ths).label + '）の方が安全でした。';
          return rec;
        }
        rec.category = 'ok-push';
        rec.comment = '1向聴の押し。' + tl(chosen) + 'は' + dg.label + '（' + pct(dg.rate) + '）で許容範囲（基準' + pct(risk) + '）です。';
        return rec;
      }
      // 聴牌
      if (shLoss > 0) {
        rec.severity = 'high'; rec.category = 'push';
        rec.comment = '聴牌を崩しています。聴牌なら押すのが基準です（' + tl(recommend.tile) + '切りで聴牌維持）。';
        return rec;
      }
      rec.category = 'ok-push';
      rec.comment = '聴牌しているので押しは正着。' + tl(chosen) + 'は' + dg.label + '（' + pct(dg.rate) + '）。';
      return rec;
    }

    /* === 第3優先: 手牌進行 === */
    if (shLoss > 0) {
      rec.severity = bestSh >= 3 ? 'mid' : 'high';
      rec.category = 'shanten';
      rec.comment = tl(chosen) + 'を切るとシャンテン数が ' + bestSh + '向聴 → ' + mine.shanten
        + '向聴に後退します。' + tl(recommend.tile) + '切りなら' + bestSh + '向聴を維持（受け入れ'
        + recommend.ukeire + '枚: ' + tileListStr(recommend.tiles) + '）。';
      return rec;
    }
    var blocks = blockCount(counts, melds);
    if (ukLoss > 0) {
      var thMid = bestSh >= 3 ? 14 : 6, thLow = bestSh >= 3 ? 8 : 3;
      var extra = '';
      if (blocks >= 6 && bestSh >= 1) {
        extra = ' 手牌は' + blocks + 'ブロックあります。1面子できた時点で最も弱いターツを払い、5ブロックに構えるのが基本です。';
      }
      if (ukLoss >= thMid) {
        rec.severity = 'mid'; rec.category = 'efficiency';
        rec.comment = tl(chosen) + '切りは受け入れ' + mine.ukeire + '枚（' + tileListStr(mine.tiles) + '）。'
          + tl(recommend.tile) + '切りなら' + recommend.ukeire + '枚（' + tileListStr(recommend.tiles) + '）で'
          + ukLoss + '枚広いです。' + extra;
        return rec;
      }
      if (ukLoss >= thLow) {
        rec.severity = 'low'; rec.category = 'efficiency';
        rec.comment = tl(chosen) + '（受け' + mine.ukeire + '枚）より' + tl(recommend.tile)
          + '（受け' + recommend.ukeire + '枚）が' + ukLoss + '枚広い選択です。' + extra;
        return rec;
      }
      rec.category = 'near';
      rec.comment = 'ほぼ最適（最大より' + ukLoss + '枚だけ狭い選択）。';
      return rec;
    }

    /* === 第5優先: 序盤の孤立牌の切り順（影響は極小） === */
    if (go <= 6 && isIsolated(counts, chosen)) {
      var better = null;
      for (i = 0; i < pool.length; i++) {
        var t2 = pool[i].tile;
        if (t2 === chosen || pool[i].ukeire < mine.ukeire) continue;
        if (!isIsolated(counts, t2)) continue;
        if (dora[t2] || AI.isYakuhaiType(view, t2)) continue;
        if (Th.isolatedValue(t2, view) < Th.isolatedValue(chosen, view) - 0.001) {
          if (!better || Th.isolatedValue(t2, view) < Th.isolatedValue(better, view)) better = t2;
        }
      }
      if (better != null) {
        rec.severity = 'low'; rec.category = 'isolated';
        rec.comment = '受け入れは同じですが、孤立牌は価値の低い順に切ります。' + tl(better) + 'の方が先です。'
          + Th.isolatedOrderComment(better, chosen) + '（成績への影響は小さい項目です）';
        return rec;
      }
    }
    rec.category = 'optimal';
    rec.comment = '最適打。' + (mine.shanten === 0 ? 'テンパイ維持。' : '受け入れ' + mine.ukeire + '枚で最大。')
      + (blocks >= 6 && bestSh >= 2 ? '（' + blocks + 'ブロック。そろそろ弱いターツを払って5ブロックに）' : '');
    return rec;
  }

  /* ---------- 立直見送り ---------- */
  function analyzeRiichiSkip(view, opts, chosenId) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var t = C.idToType(chosenId);
    var cc = counts.slice(); cc[t]--;
    if (C.shanten(cc, melds) !== 0) return null;
    var u = C.ukeire(cc, melds, view.seen);
    var ths = D.threats(view);
    var value = AI.handValue(view, counts, melds);
    var rec = {
      kind: 'riichi-skip', kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba,
      go: Math.floor(view.turnCount / 4) + 1,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)),
      chosen: t, waits: C.waitsOf(cc, melds), ukeire: u.total,
      severity: null, category: 'riichi', comment: ''
    };
    var waitStr = rec.waits.map(tl).join('・');
    if (value >= 5) {
      rec.severity = 'low';
      rec.comment = 'ダマでも満貫級（目安' + value + '翻）なので、ダマテンは有力な選択です。'
        + '待ちは' + waitStr + '（残り' + u.total + '枚）。';
      return rec;
    }
    if (ths.length) {
      rec.severity = 'low';
      rec.comment = '他家の攻撃を受けている局面でのダマは一つの選択。ただし' + waitStr + '待ち（'
        + u.total + '枚）なら追いかけリーチも有力です。';
      return rec;
    }
    if (u.total >= 3) {
      rec.severity = 'mid';
      rec.comment = '先制聴牌ならリーチが基本です。統計的には愚形でも5巡目の先制リーチで和了率53%・放銃率11%'
        + '（満貫以上の放銃は3%）。' + waitStr + '待ち（残り' + u.total + '枚）なら手替わりを待たず即リーチ。';
      return rec;
    }
    rec.severity = 'low';
    rec.comment = waitStr + '待ち（' + u.total + '枚）は極端に細いので、手替わり待ちも有力です。';
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

  /* ---------- 鳴きの分析（速度・打点・守備力の3原則） ---------- */
  function analyzeCall(view, o, action) {
    var counts = C.countsFromIds(view.hand);
    var melds = view.melds.length;
    var cur = C.shanten(counts, melds);
    var menzen = AI.isMenzenView(view);
    var go = Math.floor(view.turnCount / 4) + 1;
    var ths = D.threats(view);

    function after(usedTypes) {
      var cc = counts.slice();
      for (var i = 0; i < usedTypes.length; i++) { if (cc[usedTypes[i]] <= 0) return null; cc[usedTypes[i]]--; }
      var rem = C.sumCounts(cc) % 3;
      if (rem !== 2) return null;
      var b = C.discardOptions(cc, melds + 1, view.seen)[0];
      return b ? { shanten: b.shanten, ukeire: b.ukeire, counts: cc } : null;
    }
    var rec = {
      kind: 'call', kyoku: view.kyoku, roundWind: view.roundWind, honba: view.honba, go: go,
      hand: view.hand.slice(), melds: JSON.parse(JSON.stringify(view.melds)),
      tile: o.tile, chosen: o.tile, action: action.type, severity: null, category: 'call', comment: ''
    };
    var yakuhai = AI.isYakuhaiType(view, o.tile);

    if (action.type === 'pass') {
      var gain = null;
      if (o.canPon) {
        var ap = after([o.tile, o.tile]);
        if (ap && ap.shanten < cur) gain = { how: 'ポン', sh: ap.shanten, counts: ap.counts, types: [o.tile, o.tile] };
      }
      for (var ci = 0; ci < o.chi.length; ci++) {
        var ac = after(o.chi[ci].types);
        if (ac && ac.shanten < cur && (!gain || ac.shanten < gain.sh)) {
          gain = { how: 'チー', sh: ac.shanten, counts: ac.counts, types: o.chi[ci].types };
        }
      }
      if (!gain) return null;
      var pot = AI.openYakuPotential(view, gain.counts, view.melds.concat([{ type: 'pon', tile: o.tile }]));
      var val = AI.handValue(view, gain.counts, melds) - (menzen ? 1 : 0) + (yakuhai ? 1 : 0);
      if (yakuhai && o.canPon && cur >= 1) {
        rec.severity = 'mid';
        rec.comment = tl(o.tile) + 'は役牌です。1枚目からポンするのが現代麻雀の標準（2枚目を待つと山に沈む・他家に抱えられる）。'
          + 'ポンで' + cur + '向聴 → ' + gain.sh + '向聴に進めました。';
        return rec;
      }
      if (!menzen && pot.ok && val >= 2) {
        rec.severity = 'mid';
        rec.comment = '既に鳴いている手なので、' + tl(o.tile) + 'を' + gain.how + 'して' + gain.sh
          + '向聴に進めるべきでした（役は' + pot.why + '、打点目安' + val + '翻）。';
        return rec;
      }
      if (gain.sh === 0 && pot.ok && val >= 2) {
        rec.severity = 'low';
        rec.comment = tl(o.tile) + 'を' + gain.how + 'すれば聴牌でした（役は' + pot.why + '）。門前を維持する判断も有力です。';
        return rec;
      }
      if (gain.sh === 0 && go >= 14) {
        rec.severity = 'low';
        rec.comment = '終盤なので、' + tl(o.tile) + 'の' + gain.how + 'で形式聴牌を取る選択もありました（ノーテン罰符3000点）。';
        return rec;
      }
      return null;
    }

    // 鳴いた場合
    var used = action.type === 'chi' ? action.tiles.map(C.idToType)
      : (action.type === 'kan' ? [o.tile, o.tile, o.tile] : [o.tile, o.tile]);
    var af = after(used);
    if (!af) return null;
    rec.afterShanten = af.shanten;
    var pot2 = AI.openYakuPotential(view, af.counts, view.melds.concat([{ type: action.type === 'chi' ? 'chi' : 'pon', tile: o.tile }]));
    var val2 = AI.handValue(view, af.counts, melds) - (menzen ? 1 : 0) + (yakuhai ? 1 : 0);
    var keishiki = go >= 14 || view.wallLeft <= 8;

    if (af.shanten > cur) {
      rec.severity = 'high';
      rec.comment = 'この鳴きでシャンテン数が ' + cur + ' → ' + af.shanten + ' に後退しています。';
      return rec;
    }
    if (!pot2.ok && !keishiki) {
      rec.severity = 'high';
      rec.comment = '役が見えていない鳴きです。副露の第一条件は役の確定性（役牌・喰いタン確定・混一色）。'
        + 'このままだとアガれない役無し聴牌になりかねません。';
      return rec;
    }
    if (af.shanten === cur && !keishiki) {
      rec.severity = 'mid';
      rec.comment = 'シャンテン数が進まない鳴きです（' + cur + '向聴のまま）。門前の価値（リーチ・一発・裏ドラ）と安全牌を失うだけになります。';
      return rec;
    }
    if (val2 < 2 && !keishiki && !(ths.length && af.shanten === 0)) {
      rec.severity = 'mid';
      rec.comment = '打点が足りません（目安' + val2 + '翻）。リーチ・ツモの2翻を放棄して鳴く以上、原則2翻以上'
        + '（子で2000〜3900点以上）が欲しい局面です。' + (pot2.why ? '役は' + pot2.why + '。' : '');
      return rec;
    }
    if (menzen && action.type === 'chi' && af.shanten > 0) {
      var ryBefore = AI.ryanmenCount(counts), ryAfter = AI.ryanmenCount(af.counts);
      if (ryBefore > 0 && ryAfter === 0) {
        rec.severity = 'low';
        rec.comment = 'このチーで手牌から両面ターツが無くなり、残りが愚形だけになります。'
          + '唯一の両面を消す鳴きは、愚形が解消するまでスルーするのがセオリーです。';
        return rec;
      }
    }
    return null;
  }

  /* ---------- 記録とレポート ---------- */
  function createRecorder() {
    var records = [];
    var meta = {
      hands: 0, riichi: 0, tenpai: 0,
      wins: [], dealIns: [], callHands: 0, callWins: 0, callDealIns: 0, winTurns: []
    };
    function push(r) { if (r) records.push(r); return r; }

    function statLine(label, value, target, better) {
      // better: 'low' = 小さいほど良い
      var ok = better === 'low' ? value <= target : value >= target;
      return { label: label, value: value, target: target, ok: ok };
    }

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

      var hands = Math.max(1, meta.hands);
      var stats = {
        agariRate: meta.wins.length / hands,
        houjuRate: meta.dealIns.length / hands,
        riichiRate: meta.riichi / hands,
        fuuroRate: meta.callHands / hands,
        avgWinTurn: meta.winTurns.length ? meta.winTurns.reduce(function (a, b) { return a + b; }, 0) / meta.winTurns.length : null,
        fuuroAgariRate: meta.callHands ? meta.callWins / meta.callHands : null,
        fuuroHoujuRate: meta.callHands ? meta.callDealIns / meta.callHands : null,
        hands: meta.hands
      };
      stats.diff = stats.agariRate - stats.houjuRate;
      var T = Th.STATS_TARGET;
      stats.checks = [
        statLine('和了率', stats.agariRate, T.agari.low, 'high'),
        statLine('放銃率', stats.houjuRate, T.houju.good, 'low'),
        statLine('和銃差', stats.diff, T.diff.min, 'high')
      ];

      var rate = counted.length ? Math.round(optimal.length / counted.length * 100) : 0;
      var pushMistakes = (byCat.push || 0) + (byCat.dealin || 0);

      var advice = [];
      // 改善順序: まず放銃（押し引き）、次に副露、最後に牌効率（資料の優先度）
      if (pushMistakes) {
        advice.push({
          rank: 1, title: '押し引き（最優先）',
          text: '押し引きの指摘が ' + pushMistakes + ' 回。放銃の大半がここで生まれます。'
            + '「2向聴以下で他家リーチが入ったら完全にベタオリ」「真っ向から押してよいのは聴牌時」'
            + 'という条件付きルールとして覚えてください。'
        });
      }
      if (byCat['win-miss']) {
        advice.push({ rank: 1, title: '和了見逃し', text: '和了見逃しが ' + byCat['win-miss'] + ' 回。ツモ・ロンの表示は必ず確認を。ロンの見逃しはフリテンになります。' });
      }
      if (byCat.call) {
        advice.push({
          rank: 2, title: '副露判断', text: '鳴きの指摘が ' + byCat.call + ' 回。鳴く前に3つ確認を。'
            + '①役は確定しているか ②2翻以上（子2000〜3900点以上）あるか ③愚形が2つ以上残らないか。'
        });
      }
      if (byCat.shanten || byCat.efficiency) {
        advice.push({
          rank: 3, title: '手牌進行',
          text: '牌効率の指摘が ' + ((byCat.shanten || 0) + (byCat.efficiency || 0)) + ' 回（最適打率 ' + rate + '%）。'
            + '1面子できたら最も弱いターツを払って5ブロックに構えるのが基本です。'
        });
      } else if (counted.length) {
        advice.push({ rank: 3, title: '手牌進行', text: '牌効率は良好（最適打率 ' + rate + '%）。次は押し引きと打点を意識しましょう。' });
      }
      if (byCat.riichi) {
        advice.push({ rank: 4, title: 'リーチ判断', text: 'リーチ判断の指摘が ' + byCat.riichi + ' 回。先制聴牌は愚形でもリーチが基本（5巡目先制で和了率53%）。' });
      }
      if (byCat.isolated) {
        advice.push({ rank: 5, title: '孤立牌の切り順', text: '孤立牌の切り順の指摘が ' + byCat.isolated + ' 回。価値は 字牌 < 1,9 < 2,8 < 3〜7 の順。ただし成績への影響は小さいので深追い不要です。' });
      }
      advice.sort(function (a, b) { return a.rank - b.rank; });

      // ロードマップ上の現在地（参考）
      var phase = 0;
      if (stats.houjuRate <= 0.12 && stats.agariRate >= 0.20) phase = 1;
      if (stats.houjuRate <= 0.115 && stats.diff >= 0.10) phase = 2;

      return {
        summary: {
          discardCount: counted.length, optimalCount: optimal.length, optimalRate: rate,
          avgUkeireLoss: lossN ? Math.round(lossSum / lossN * 10) / 10 : 0,
          mistakeCount: mistakes.length, severity: sev, byCategory: byCat,
          wins: meta.wins.length, dealIns: meta.dealIns.length,
          riichiCount: meta.riichi, hands: meta.hands, pushMistakes: pushMistakes
        },
        stats: stats,
        phase: phase,
        mistakes: mistakes.slice().sort(function (a, b) {
          var pa = (Th.PRIORITY[a.category] || { rank: 9 }).rank;
          var pb = (Th.PRIORITY[b.category] || { rank: 9 }).rank;
          if (pa !== pb) return pa - pb;
          var o = { high: 0, mid: 1, low: 2 };
          if (o[a.severity] !== o[b.severity]) return o[a.severity] - o[b.severity];
          return (a.kyoku - b.kyoku) || (a.go - b.go);
        }),
        records: records, meta: meta, advice: advice
      };
    }

    return {
      records: records, meta: meta, push: push, report: report,
      analyzeDiscard: analyzeDiscard, analyzeRiichiSkip: analyzeRiichiSkip,
      analyzeCall: analyzeCall, winMissRecord: winMissRecord,
      reset: function () {
        records.length = 0;
        meta.hands = 0; meta.riichi = 0; meta.tenpai = 0;
        meta.wins = []; meta.dealIns = []; meta.callHands = 0; meta.callWins = 0; meta.callDealIns = 0; meta.winTurns = [];
      }
    };
  }

  global.MJReview = {
    createRecorder: createRecorder,
    analyzeDiscard: analyzeDiscard,
    analyzeRiichiSkip: analyzeRiichiSkip,
    analyzeCall: analyzeCall,
    winMissRecord: winMissRecord,
    blockCount: blockCount,
    recommendFor: recommendFor,
    buildContext: buildContext,
    isIsolated: isIsolated,
    rel: rel,
    tileListStr: tileListStr
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
