/* 対局進行エンジン (UI非依存 / async) */
(function (global) {
  'use strict';
  var C = global.MJCore, S = global.MJScore;

  var WINDS = [27, 28, 29, 30];

  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function buildWall(rnd) {
    var w = [];
    for (var i = 0; i < 136; i++) w.push(i);
    return shuffle(w, rnd);
  }
  function sortIds(ids) {
    ids.sort(function (a, b) {
      var ta = C.idToType(a), tb = C.idToType(b);
      if (ta !== tb) return ta - tb;
      return a - b;
    });
    return ids;
  }
  function removeId(arr, id) {
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  }
  function findIdsOfType(arr, type, n) {
    var out = [];
    for (var i = 0; i < arr.length && out.length < n; i++) if (C.idToType(arr[i]) === type) out.push(arr[i]);
    return out;
  }

  function createGame(cfg) {
    var rule = Object.assign({
      length: 'tonpuu',     // 'one' | 'tonpuu' | 'hanchan'
      aka: true,
      kuitan: true,
      startScore: 25000,
      agariYame: true
    }, cfg.rule || {});
    var controllers = cfg.controllers;
    var onEvent = cfg.onEvent || function () { };
    var rnd = cfg.rnd;

    var G = {
      rule: rule,
      roundWind: 27,
      kyoku: 1,
      honba: 0,
      kyotaku: 0,
      oya: 0,
      players: [],
      wall: [], deadWall: [],
      doraInd: [], uraInd: [], rinshan: [], doraStack: [],
      kanCount: 0,
      turnCount: 0,
      current: 0,
      lastDiscard: null,
      finished: false,
      results: [],
      handNo: 0
    };
    for (var i = 0; i < 4; i++) G.players.push({
      score: rule.startScore, hand: [], melds: [], discards: [], waits: [],
      riichi: false, doubleRiichi: false, ippatsu: false, riichiTurn: -1,
      furitenOwn: false, furitenTemp: false, furitenRiichi: false, drawnId: null, firstTurn: true
    });

    function emit(type, data) {
      return onEvent(Object.assign({ type: type }, data || {}), G);
    }

    function seenCounts() {
      var c = C.emptyCounts();
      for (var p = 0; p < 4; p++) {
        var pl = G.players[p];
        for (var i = 0; i < pl.discards.length; i++) c[C.idToType(pl.discards[i].id)]++;
        for (var j = 0; j < pl.melds.length; j++) {
          var m = pl.melds[j];
          for (var k = 0; k < m.tiles.length; k++) c[C.idToType(m.tiles[k])]++;
        }
      }
      for (var d = 0; d < G.doraInd.length; d++) c[C.idToType(G.doraInd[d])]++;
      return c;
    }
    function seenFor(p) {
      var c = seenCounts();
      var pl = G.players[p];
      for (var i = 0; i < pl.hand.length; i++) c[C.idToType(pl.hand[i])]++;
      return c;
    }

    function doraTypes() {
      return G.doraInd.map(function (id) { return C.doraFromIndicator(C.idToType(id)); });
    }
    function uraTypes(n) {
      return G.uraInd.slice(0, n).map(function (id) { return C.doraFromIndicator(C.idToType(id)); });
    }
    function redCount(p) {
      var pl = G.players[p], n = 0, i, j;
      for (i = 0; i < pl.hand.length; i++) if (C.isRedId(pl.hand[i])) n++;
      for (i = 0; i < pl.melds.length; i++)
        for (j = 0; j < pl.melds[i].tiles.length; j++) if (C.isRedId(pl.melds[i].tiles[j])) n++;
      return n;
    }
    function meldCount(p) { return G.players[p].melds.length; }
    function handCounts(p) { return C.countsFromIds(G.players[p].hand); }
    function isMenzen(p) {
      var ms = G.players[p].melds;
      for (var i = 0; i < ms.length; i++) if (ms[i].type !== 'kan' || !ms[i].closed) return false;
      return true;
    }
    function seatWind(p) { return WINDS[(p - G.oya + 4) % 4]; }

    function scoreMelds(p) {
      return G.players[p].melds.map(function (m) {
        return { type: m.type, tile: m.tile, closed: !!m.closed };
      });
    }

    // 和了判定(役ありか)
    function evalWin(p, winTileId, isTsumo, extra) {
      extra = extra || {};
      var pl = G.players[p];
      var counts = handCounts(p);
      var wt = C.idToType(winTileId);
      if (!isTsumo) counts[wt]++;
      if (!C.isAgariCounts(counts, pl.melds.length)) return null;
      var red = redCount(p) + (!isTsumo && C.isRedId(winTileId) ? 1 : 0);
      var r = S.score({
        concealed: counts,
        melds: scoreMelds(p),
        winTile: wt,
        isTsumo: isTsumo,
        isRiichi: pl.riichi,
        isDoubleRiichi: pl.doubleRiichi,
        isIppatsu: pl.ippatsu,
        isRinshan: !!extra.rinshan,
        isChankan: !!extra.chankan,
        isHaitei: !!extra.haitei,
        isHoutei: !!extra.houtei,
        isTenhou: !!extra.tenhou,
        isChiihou: !!extra.chiihou,
        seatWind: seatWind(p),
        roundWind: G.roundWind,
        isDealer: p === G.oya,
        dora: doraTypes(),
        ura: uraTypes(G.doraInd.length),
        redCount: red,
        kuitan: rule.kuitan
      });
      return r;
    }

    function waitsFor(p) {
      var pl = G.players[p];
      var c = handCounts(p);
      if (C.sumCounts(c) % 3 !== 1) return [];
      return C.waitsOf(c, pl.melds.length);
    }

    function updateFuriten(p) {
      var pl = G.players[p];
      var w = waitsFor(p);
      pl.waits = w;
      var set = {};
      for (var i = 0; i < w.length; i++) set[w[i]] = 1;
      pl.furitenOwn = false;
      for (var j = 0; j < pl.discards.length; j++) {
        if (set[C.idToType(pl.discards[j].id)]) { pl.furitenOwn = true; break; }
      }
    }
    function isFuriten(p) {
      var pl = G.players[p];
      return pl.furitenOwn || pl.furitenTemp || pl.furitenRiichi;
    }

    /* ---------- view ---------- */
    function view(p) {
      var self = G.players[p];
      return {
        me: p,
        hand: self.hand.slice(),
        melds: JSON.parse(JSON.stringify(self.melds)),
        drawn: self.drawnId,
        riichi: self.riichi,
        waits: (self.waits || []).slice(),
        furiten: isFuriten(p),
        seatWind: seatWind(p),
        roundWind: G.roundWind,
        oya: G.oya,
        kyoku: G.kyoku,
        honba: G.honba,
        kyotaku: G.kyotaku,
        turnCount: G.turnCount,
        wallLeft: G.wall.length,
        doraInd: G.doraInd.map(C.idToType),
        seen: seenFor(p),
        scores: G.players.map(function (x) { return x.score; }),
        players: G.players.map(function (x, idx) {
          return {
            idx: idx,
            riichi: x.riichi,
            riichiTurn: x.riichiTurn,
            melds: JSON.parse(JSON.stringify(x.melds)),
            discards: x.discards.map(function (d) { return { id: d.id, tsumogiri: d.tsumogiri, riichi: d.riichi, turn: d.turn }; }),
            handSize: x.hand.length,
            score: x.score,
            seatWind: seatWind(idx)
          };
        }),
        rule: rule
      };
    }

    /* ---------- 局の初期化 ---------- */
    function initHand() {
      G.handNo++;
      var wall = buildWall(rnd);
      G.deadWall = wall.slice(0, 14);
      G.wall = wall.slice(14);
      G.doraInd = [G.deadWall[0]];
      G.uraInd = [G.deadWall[5], G.deadWall[6], G.deadWall[7], G.deadWall[8], G.deadWall[9]];
      G.doraStack = [G.deadWall[1], G.deadWall[2], G.deadWall[3], G.deadWall[4]];
      G.rinshan = [G.deadWall[10], G.deadWall[11], G.deadWall[12], G.deadWall[13]];
      G.kanCount = 0;
      G.turnCount = 0;
      G.lastDiscard = null;
      G.anyCall = false;
      for (var p = 0; p < 4; p++) {
        var pl = G.players[p];
        pl.hand = [];
        pl.melds = [];
        pl.discards = [];
        pl.riichi = false;
        pl.doubleRiichi = false;
        pl.ippatsu = false;
        pl.riichiTurn = -1;
        pl.furitenOwn = false;
        pl.furitenTemp = false;
        pl.furitenRiichi = false;
        pl.drawnId = null;
        pl.firstTurn = true;
        pl.waits = [];
      }
      for (var k = 0; k < 13; k++) {
        for (var q = 0; q < 4; q++) G.players[(G.oya + q) % 4].hand.push(G.wall.shift());
      }
      for (var z = 0; z < 4; z++) sortIds(G.players[z].hand);
      G.current = G.oya;
    }

    /* ---------- ターンの選択肢 ---------- */
    function turnOptions(p, drawnId, fromRinshan) {
      var pl = G.players[p];
      var counts = handCounts(p);
      var opts = { discardable: [], canTsumo: false, canRiichi: false, riichiTiles: [], kans: [], canKyuushu: false };

      // ツモ和了
      if (drawnId != null) {
        var ex = {
          rinshan: !!fromRinshan,
          haitei: G.wall.length === 0 && !fromRinshan,
          tenhou: p === G.oya && pl.firstTurn && !G.anyCall && pl.discards.length === 0,
          chiihou: p !== G.oya && pl.firstTurn && !G.anyCall && pl.discards.length === 0
        };
        var w = evalWin(p, drawnId, true, ex);
        if (w) { opts.canTsumo = true; opts.tsumoResult = w; opts.tsumoExtra = ex; }
      }
      // 打牌候補
      if (pl.riichi) {
        opts.discardable = drawnId != null ? [drawnId] : pl.hand.slice();
      } else {
        opts.discardable = pl.hand.slice();
      }
      // 立直
      if (!pl.riichi && isMenzen(p) && pl.score >= 1000 && G.wall.length >= 4 && C.sumCounts(counts) % 3 === 2) {
        var seen = {};
        for (var i = 0; i < pl.hand.length; i++) {
          var id = pl.hand[i], t = C.idToType(id);
          if (seen[t]) continue;
          seen[t] = 1;
          counts[t]--;
          if (C.shanten(counts, pl.melds.length) === 0) opts.riichiTiles.push(id);
          counts[t]++;
        }
        if (opts.riichiTiles.length) opts.canRiichi = true;
      }
      // カン
      if (G.kanCount < 4 && G.wall.length > 0) {
        var cc = handCounts(p), t2;
        for (t2 = 0; t2 < 34; t2++) {
          if (cc[t2] === 4) {
            if (pl.riichi) {
              // 立直後の暗槓: 待ちが変わらない場合のみ
              var tmp = cc.slice(); tmp[t2] -= 4;
              var before = (pl.waits || []).slice().sort().join(',');
              var after = C.waitsOf(tmp, pl.melds.length + 1).slice().sort().join(',');
              if (before !== after) continue;
              // 送り槓(暗刻を手の内から槓)は不可: ツモ牌が4枚目であること
              if (drawnId == null || C.idToType(drawnId) !== t2) continue;
            }
            opts.kans.push({ kind: 'ankan', tile: t2, tiles: findIdsOfType(pl.hand, t2, 4) });
          }
        }
        if (!pl.riichi) {
          for (var mi = 0; mi < pl.melds.length; mi++) {
            var m = pl.melds[mi];
            if (m.type !== 'pon') continue;
            if (cc[m.tile] >= 1) opts.kans.push({ kind: 'kakan', tile: m.tile, meldIndex: mi, tiles: findIdsOfType(pl.hand, m.tile, 1) });
          }
        }
      }
      // 九種九牌
      if (pl.firstTurn && !G.anyCall && pl.discards.length === 0 && drawnId != null) {
        var kinds = 0, cnt = handCounts(p);
        for (var y = 0; y < 34; y++) if (C.isYaochu(y) && cnt[y] > 0) kinds++;
        if (kinds >= 9) opts.canKyuushu = true;
      }
      return opts;
    }

    /* ---------- 鳴き/ロンの選択肢 ---------- */
    function callOptions(p, discardId, from, isChankan) {
      var pl = G.players[p];
      var t = C.idToType(discardId);
      var cc = handCounts(p);
      var o = { canRon: false, canPon: false, chi: [], canKan: false, tile: t, from: from };
      // ロン
      var counts = cc.slice(); counts[t]++;
      if (C.isAgariCounts(counts, pl.melds.length) && !isFuriten(p)) {
        var ex = {
          houtei: G.wall.length === 0 && !isChankan,
          chankan: !!isChankan
        };
        var r = evalWin(p, discardId, false, ex);
        if (r) { o.canRon = true; o.ronResult = r; o.ronExtra = ex; }
      }
      if (isChankan) return o;
      if (pl.riichi) return o;
      // ポン/カン
      if (cc[t] >= 2) {
        o.canPon = true;
        o.ponTiles = findIdsOfType(pl.hand, t, 2);
        // 赤牌を含む選択は上位で処理(ここでは2枚固定)
        var sameType = findIdsOfType(pl.hand, t, 4);
        o.ponChoices = sameType.length > 2 ? sameType : null;
      }
      if (cc[t] >= 3 && G.kanCount < 4 && G.wall.length > 0) {
        o.canKan = true;
        o.kanTiles = findIdsOfType(pl.hand, t, 3);
      }
      // チー(上家からのみ)
      if (t < 27 && (from + 1) % 4 === p) {
        var r2 = t % 9, base = t - r2;
        var combos = [[-2, -1], [-1, 1], [1, 2]];
        for (var i = 0; i < combos.length; i++) {
          var a = r2 + combos[i][0], b = r2 + combos[i][1];
          if (a < 0 || b < 0 || a > 8 || b > 8) continue;
          if (cc[base + a] > 0 && cc[base + b] > 0) {
            o.chi.push({
              tiles: [findIdsOfType(pl.hand, base + a, 1)[0], findIdsOfType(pl.hand, base + b, 1)[0]],
              types: [base + a, base + b]
            });
          }
        }
      }
      return o;
    }

    /* ---------- 点数移動 ---------- */
    function applyRon(winner, loser, result, winTileId) {
      var pay = result.points + G.honba * 300;
      G.players[loser].score -= pay;
      G.players[winner].score += pay + G.kyotaku * 1000;
      var gained = pay + G.kyotaku * 1000;
      G.kyotaku = 0;
      return { kind: 'ron', winner: winner, loser: loser, result: result, pay: pay, gained: gained, winTile: winTileId };
    }
    function applyTsumo(winner, result, winTileId) {
      var total = 0;
      for (var p = 0; p < 4; p++) {
        if (p === winner) continue;
        var amt;
        if (winner === G.oya) amt = result.pay.fromEach;
        else amt = (p === G.oya) ? result.pay.fromDealer : result.pay.fromOther;
        amt += G.honba * 100;
        G.players[p].score -= amt;
        total += amt;
      }
      G.players[winner].score += total + G.kyotaku * 1000;
      var gained = total + G.kyotaku * 1000;
      G.kyotaku = 0;
      return { kind: 'tsumo', winner: winner, result: result, pay: total, gained: gained, winTile: winTileId };
    }

    function revealDora() {
      if (G.doraStack.length) {
        G.doraInd.push(G.doraStack.shift());
        return emit('dora', { indicator: C.idToType(G.doraInd[G.doraInd.length - 1]) });
      }
    }

    function clearIppatsuAll() {
      for (var p = 0; p < 4; p++) G.players[p].ippatsu = false;
    }

    /* ---------- 1局 ---------- */
    function findKan(opts, act) {
      for (var i = 0; i < opts.kans.length; i++) {
        if (opts.kans[i].kind === act.kind && opts.kans[i].tile === act.tile) return opts.kans[i];
      }
      return null;
    }

    async function playHand() {
      initHand();
      await emit('hand-start', {});
      for (var ip = 0; ip < 4; ip++) updateFuriten(ip);

      var current = G.oya;
      var mode = 'draw';      // 'draw' | 'afterCall' | 'pending'
      var pending = null;     // 嶺上牌
      var drawnId = null;
      var fromRinshan = false;

      while (true) {
        var pl = G.players[current];

        if (mode === 'draw') {
          if (G.wall.length === 0) return await endRyuukyoku('exhaustive');
          drawnId = G.wall.shift();
          pl.hand.push(drawnId);
          sortIds(pl.hand);
          pl.drawnId = drawnId;
          pl.furitenTemp = false;
          if (pl.riichi && pl.discards.length > 0) pl.ippatsu = false;
          fromRinshan = false;
          await emit('draw', { player: current, tile: drawnId, rinshan: false, wallLeft: G.wall.length });
        } else if (mode === 'pending') {
          drawnId = pending; pending = null;
          fromRinshan = true;
          pl.drawnId = drawnId;
        } else { // afterCall
          drawnId = null;
          pl.drawnId = null;
          fromRinshan = false;
        }

        // ===== 手番の選択(カンで繰り返す) =====
        var discardTile = null, declaredRiichi = false;
        while (true) {
          var opts = turnOptions(current, drawnId, fromRinshan);
          var act = await controllers[current].turnAction(view(current), opts);
          if (!act) act = { type: 'discard', tile: opts.discardable[opts.discardable.length - 1] };

          if (act.type === 'tsumo' && opts.canTsumo) {
            return await endHand(applyTsumo(current, opts.tsumoResult, drawnId));
          }
          if (act.type === 'kyuushu' && opts.canKyuushu) {
            return await endRyuukyoku('kyuushu');
          }
          if (act.type === 'kan') {
            var kan = findKan(opts, act);
            if (kan) {
              var chankanTile = null;
              if (kan.kind === 'ankan') {
                for (var kj = 0; kj < kan.tiles.length; kj++) removeId(pl.hand, kan.tiles[kj]);
                pl.melds.push({ type: 'kan', tile: kan.tile, closed: true, tiles: kan.tiles, from: current });
              } else {
                var mm = pl.melds[kan.meldIndex];
                removeId(pl.hand, kan.tiles[0]);
                mm.type = 'kan'; mm.closed = false; mm.kakan = true;
                mm.tiles = mm.tiles.concat(kan.tiles);
                chankanTile = kan.tiles[0];
              }
              G.kanCount++;
              G.anyCall = true;
              clearIppatsuAll();
              sortIds(pl.hand);
              pl.drawnId = null;
              await emit('kan', { player: current, kind: kan.kind, tile: kan.tile });
              if (chankanTile != null) {
                var ck = await gatherCalls(chankanTile, current, true);
                if (ck && ck.type === 'ron') {
                  return await endHand(applyRon(ck.player, current, ck.opt.ronResult, chankanTile));
                }
              }
              await revealDora();
              if (!G.rinshan.length) return await endRyuukyoku('exhaustive');
              var rt = G.rinshan.shift();
              if (G.wall.length) G.wall.pop();
              pl.hand.push(rt);
              sortIds(pl.hand);
              pl.drawnId = rt;
              drawnId = rt;
              fromRinshan = true;
              await emit('draw', { player: current, tile: rt, rinshan: true, wallLeft: G.wall.length });
              continue; // もう一度手番の選択
            }
          }
          if (act.type === 'riichi' && opts.canRiichi) {
            var okTile = opts.riichiTiles.indexOf(act.tile) >= 0 ? act.tile : opts.riichiTiles[0];
            pl.riichi = true;
            pl.riichiTurn = G.turnCount;
            pl.ippatsu = true;
            if (pl.firstTurn && !G.anyCall) pl.doubleRiichi = true;
            pl.score -= 1000;
            G.kyotaku += 1;
            declaredRiichi = true;
            discardTile = okTile;
            await emit('riichi', { player: current, tile: okTile });
            break;
          }
          discardTile = act.tile;
          if (pl.hand.indexOf(discardTile) < 0 || opts.discardable.indexOf(discardTile) < 0) {
            discardTile = opts.discardable[opts.discardable.length - 1];
          }
          break;
        }

        // ===== 打牌 =====
        var tsumogiri = (discardTile === drawnId);
        removeId(pl.hand, discardTile);
        sortIds(pl.hand);
        pl.discards.push({ id: discardTile, tsumogiri: tsumogiri, riichi: declaredRiichi, turn: G.turnCount });
        pl.firstTurn = false;
        pl.drawnId = null;
        G.lastDiscard = { id: discardTile, from: current };
        updateFuriten(current);
        G.turnCount++;
        await emit('discard', { player: current, tile: discardTile, tsumogiri: tsumogiri, riichi: declaredRiichi });

        // ===== 他家の反応 =====
        var call = await gatherCalls(discardTile, current, false);
        if (call && call.type === 'ron') {
          return await endHand(applyRon(call.player, current, call.opt.ronResult, discardTile));
        }
        if (call) {
          var cp = call.player, cpl = G.players[cp];
          G.anyCall = true;
          clearIppatsuAll();
          if (call.type === 'pon') {
            var pt = call.tiles && call.tiles.length === 2 ? call.tiles : findIdsOfType(cpl.hand, C.idToType(discardTile), 2);
            for (var a1 = 0; a1 < pt.length; a1++) removeId(cpl.hand, pt[a1]);
            cpl.melds.push({ type: 'pon', tile: C.idToType(discardTile), tiles: pt.concat([discardTile]), called: discardTile, from: current });
          } else if (call.type === 'kan') {
            var kt = call.tiles && call.tiles.length === 3 ? call.tiles : findIdsOfType(cpl.hand, C.idToType(discardTile), 3);
            for (var a2 = 0; a2 < kt.length; a2++) removeId(cpl.hand, kt[a2]);
            cpl.melds.push({ type: 'kan', tile: C.idToType(discardTile), closed: false, tiles: kt.concat([discardTile]), called: discardTile, from: current });
            G.kanCount++;
          } else {
            var ct = call.tiles;
            for (var a3 = 0; a3 < ct.length; a3++) removeId(cpl.hand, ct[a3]);
            var types = ct.map(C.idToType).concat([C.idToType(discardTile)]).sort(function (x, y) { return x - y; });
            cpl.melds.push({ type: 'chi', tile: types[0], tiles: ct.concat([discardTile]), called: discardTile, from: current });
          }
          pl.discards[pl.discards.length - 1].called = true;
          sortIds(cpl.hand);
          updateFuriten(cp);
          await emit('call', { player: cp, callType: call.type, from: current, tile: discardTile });
          current = cp;
          if (call.type === 'kan') {
            await revealDora();
            if (!G.rinshan.length) return await endRyuukyoku('exhaustive');
            var rt2 = G.rinshan.shift();
            if (G.wall.length) G.wall.pop();
            cpl.hand.push(rt2);
            sortIds(cpl.hand);
            cpl.drawnId = rt2;
            await emit('draw', { player: cp, tile: rt2, rinshan: true, wallLeft: G.wall.length });
            pending = rt2;
            mode = 'pending';
          } else {
            mode = 'afterCall';
          }
          continue;
        }

        if (G.wall.length === 0) return await endRyuukyoku('exhaustive');
        current = (current + 1) % 4;
        mode = 'draw';
      }
    }

    // 他家の鳴き/ロンを集約
    async function gatherCalls(tileId, from, isChankan) {
      var responses = [];
      for (var k = 1; k <= 3; k++) {
        var p = (from + k) % 4;
        var o = callOptions(p, tileId, from, isChankan);
        if (!o.canRon && !o.canPon && !o.canKan && !o.chi.length) continue;
        var a = await controllers[p].callAction(view(p), o);
        if (!a || a.type === 'pass') {
          if (o.canRon) {
            G.players[p].furitenTemp = true;
            if (G.players[p].riichi) G.players[p].furitenRiichi = true;
          }
          continue;
        }
        if (a.type === 'ron' && !o.canRon) continue;
        if (a.type === 'pon' && !o.canPon) continue;
        if (a.type === 'kan' && !o.canKan) continue;
        if (a.type === 'chi' && !o.chi.length) continue;
        responses.push({ player: p, type: a.type, tiles: a.tiles, opt: o, order: k });
      }
      if (!responses.length) return null;
      var pick = function (t) { return responses.filter(function (r) { return r.type === t; }); };
      var rons = pick('ron');
      if (rons.length) { rons.sort(function (a, b) { return a.order - b.order; }); return rons[0]; }
      var kans = pick('kan'); if (kans.length) return kans[0];
      var pons = pick('pon'); if (pons.length) return pons[0];
      return responses[0];
    }

    /* ---------- 局の終了 ---------- */
    async function endHand(mv) {
      var winner = mv.winner;
      var uraRevealed = G.players[winner].riichi ? uraTypes(G.doraInd.length) : [];
      var info = {
        kind: mv.kind, winner: winner, loser: mv.loser, result: mv.result,
        gained: mv.gained, winTile: mv.winTile, ura: uraRevealed,
        oya: G.oya, kyoku: G.kyoku, roundWind: G.roundWind, honba: G.honba,
        hand: G.players[winner].hand.slice(), melds: JSON.parse(JSON.stringify(G.players[winner].melds)),
        doraInd: G.doraInd.map(C.idToType),
        scores: G.players.map(function (x) { return x.score; })
      };
      G.results.push(info);
      await emit('agari', info);
      advance(winner === G.oya, winner === G.oya);
      await emit('hand-end', { info: info });
      return info;
    }

    async function endRyuukyoku(reason) {
      var tenpai = [], p;
      if (reason === 'exhaustive') {
        for (p = 0; p < 4; p++) {
          var c = handCounts(p);
          if (C.sumCounts(c) % 3 === 1 && C.shanten(c, G.players[p].melds.length) === 0) tenpai.push(p);
        }
        var n = tenpai.length;
        if (n > 0 && n < 4) {
          var get = [0, 3000, 1500, 1000][n];
          var pay = [0, 1000, 1500, 3000][n];
          for (p = 0; p < 4; p++) {
            if (tenpai.indexOf(p) >= 0) G.players[p].score += get;
            else G.players[p].score -= pay;
          }
        }
      }
      var info = {
        kind: 'ryuukyoku', reason: reason, tenpai: tenpai,
        oya: G.oya, kyoku: G.kyoku, roundWind: G.roundWind, honba: G.honba,
        hands: G.players.map(function (x) { return x.hand.slice(); }),
        melds: G.players.map(function (x) { return JSON.parse(JSON.stringify(x.melds)); }),
        doraInd: G.doraInd.map(C.idToType),
        scores: G.players.map(function (x) { return x.score; })
      };
      G.results.push(info);
      await emit('ryuukyoku', info);
      advance(tenpai.indexOf(G.oya) >= 0 || reason === 'kyuushu', true);
      await emit('hand-end', { info: info });
      return info;
    }

    function advance(renchan, honbaUp) {
      G.honba = honbaUp ? G.honba + 1 : 0;
      if (!renchan) {
        G.oya = (G.oya + 1) % 4;
        G.kyoku++;
        if (G.kyoku > 4) { G.kyoku = 1; G.roundWind++; }
      }
    }

    async function run() {
      while (true) {
        await playHand();
        var over = false, p;
        for (p = 0; p < 4; p++) if (G.players[p].score < 0) over = true;
        if (rule.length === 'one') over = true;
        else if (rule.length === 'tonpuu') { if (G.roundWind >= 28) over = true; }
        else { if (G.roundWind >= 29) over = true; }
        if (over) break;
      }
      G.finished = true;
      var order = G.players.map(function (x, i) { return { idx: i, score: x.score }; })
        .sort(function (a, b) { return b.score - a.score; });
      await emit('game-end', { scores: G.players.map(function (x) { return x.score; }), order: order });
      return { scores: G.players.map(function (x) { return x.score; }), order: order, results: G.results };
    }

    return {
      state: G, run: run, playHand: playHand, view: view,
      turnOptions: turnOptions, callOptions: callOptions, evalWin: evalWin,
      seenFor: seenFor, doraTypes: doraTypes, isMenzen: isMenzen, seatWind: seatWind
    };
  }

  global.MJGame = { createGame: createGame, WINDS: WINDS, sortIds: sortIds, buildWall: buildWall };
})(typeof globalThis !== 'undefined' ? globalThis : this);
