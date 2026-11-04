/* UI: 卓の描画 / 人間プレイヤーの操作 / 検討レポート */
(function () {
  'use strict';
  var C = MJCore, S = MJScore, Gm = MJGame, AI = MJAI, R = MJReview, D = MJDanger, Th = MJTheory;

  var SEAT_LABEL = ['自分', '下家', '対面', '上家'];
  var WIND_CH = { 27: '東', 28: '南', 29: '西', 30: '北' };
  var HONOR = ['東', '南', '西', '北', '白', '發', '中'];

  var cfg = {
    length: 'tonpuu', strength: 'normal', aka: true,
    assist: true, instant: true, speed: 520
  };
  try {
    var saved = JSON.parse(localStorage.getItem('mj-cfg') || 'null');
    if (saved) Object.assign(cfg, saved);
  } catch (e) { }
  function saveCfg() { try { localStorage.setItem('mj-cfg', JSON.stringify(cfg)); } catch (e) { } }

  var app = document.getElementById('app');
  var state = {
    game: null, gs: null, view: null, mode: 'idle',
    opts: null, callOpts: null, resolve: null,
    feedback: null, rec: null, handLog: [], prevScores: null, running: false
  };

  /* ---------- DOM ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function tileNode(type, o) {
    o = o || {};
    var t = el('span', 'tile');
    if (o.cls) t.className += ' ' + o.cls;
    if (type == null) { t.className += ' back'; return t; }
    if (o.red) t.className += ' red';
    t.innerHTML = MJTiles.face(type, { red: !!o.red });
    return t;
  }
  function tileById(id, o) {
    o = o || {};
    return tileNode(C.idToType(id), Object.assign({ red: C.isRedId(id) }, o));
  }
  function tileText(t) { return C.typeLabel(t); }

  /* ---------- 河 / 副露 ---------- */
  function riverNode(discards) {
    var w = el('div', 'river');
    discards.forEach(function (d) {
      var cls = (d.tsumogiri ? 'tsumogiri ' : '') + (d.called ? 'dim ' : '') + (d.riichi ? 'sideways' : '');
      w.appendChild(tileById(d.id, { cls: cls }));
    });
    return w;
  }

  // 卓上の1人分（名前・副露・河）。河は席の向きに合わせて回転させる
  var ROT = { top: 180, left: 90, right: 270, bottom: 0 };
  function seatCell(v, k, pos) {
    var p = (v.me + k) % 4;
    var pd = v.players[p];
    var cell = el('div', 'seat-cell ' + pos + (pd.riichi ? ' is-riichi' : ''));
    var head = el('div', 'seat-head');
    head.appendChild(el('span', 'seat-wind', WIND_CH[pd.seatWind]));
    head.appendChild(el('span', 'seat-name', k === 0 ? '自分' : SEAT_LABEL[k]));
    if (p === v.oya) head.appendChild(el('span', 'oya-mark', '親'));
    if (pd.riichi) head.appendChild(el('span', 'riichi-badge', 'リーチ'));
    if (pd.melds && pd.melds.length) head.appendChild(el('span', 'meld-badge', '鳴き' + pd.melds.length));
    head.appendChild(el('span', 'seat-score', pd.score.toLocaleString()));
    cell.appendChild(head);
    if (k !== 0 && pd.melds && pd.melds.length) cell.appendChild(meldsNode(pd.melds));
    var box = el('div', 'river-box r' + ROT[pos]);
    box.style.setProperty('--rows', Math.max(3, Math.ceil(pd.discards.length / 6)));
    box.appendChild(riverNode(pd.discards));
    cell.appendChild(box);
    return cell;
  }
  function meldsNode(melds, small) {
    var w = el('div', 'melds');
    melds.forEach(function (m) {
      var g = el('div', 'meld');
      var ids = m.tiles.slice();
      ids.sort(function (a, b) { return C.idToType(a) - C.idToType(b); });
      ids.forEach(function (id, i) {
        var cls = '';
        if (m.type === 'kan' && m.closed && (i === 0 || i === 3)) {
          g.appendChild(tileNode(null));
          return;
        }
        if (id === m.called) cls = 'sideways';
        g.appendChild(tileById(id, { cls: cls }));
      });
      w.appendChild(g);
    });
    return w;
  }

  /* ---------- 画面構築 ---------- */
  function render() {
    if (!state.view) return;
    var v = state.view;
    app.innerHTML = '';

    // --- 情報バー ---
    var bar = el('div', 'topbar');
    bar.appendChild(el('div', 'round', WIND_CH[v.roundWind] + v.kyoku + '局 ' + v.honba + '本場'));
    var dora = el('div', 'dora-box');
    dora.appendChild(el('span', 'chip', 'ドラ'));
    v.doraInd.forEach(function (t) { dora.appendChild(tileNode(C.doraFromIndicator(t))); });
    bar.appendChild(dora);
    bar.appendChild(el('span', 'chip', '残' + v.wallLeft));
    if (v.kyotaku) bar.appendChild(el('span', 'chip warn', '供託' + v.kyotaku * 1000));
    if (v.furiten) bar.appendChild(el('span', 'chip warn', 'フリテン'));
    bar.appendChild(el('div', 'spacer'));
    var bAssist = el('button', 'icon-btn', 'アシスト');
    bAssist.setAttribute('aria-pressed', cfg.assist ? 'true' : 'false');
    bAssist.onclick = function () { cfg.assist = !cfg.assist; saveCfg(); render(); };
    bar.appendChild(bAssist);
    var bInst = el('button', 'icon-btn', '即時指摘');
    bInst.setAttribute('aria-pressed', cfg.instant ? 'true' : 'false');
    bInst.onclick = function () { cfg.instant = !cfg.instant; saveCfg(); render(); };
    bar.appendChild(bInst);
    var bRep = el('button', 'icon-btn', '検討');
    bRep.onclick = function () { showReport(false); };
    bar.appendChild(bRep);
    var bTh = el('button', 'icon-btn', '理論');
    bTh.onclick = function () { theoryScreen(); };
    bar.appendChild(bTh);
    app.appendChild(bar);

    // --- 卓（対面=上 / 上家=左 / 下家=右 / 自分=下） ---
    var table = el('div', 'table');
    var grid = el('div', 'table-grid');
    grid.appendChild(seatCell(v, 2, 'top'));
    grid.appendChild(seatCell(v, 3, 'left'));
    grid.appendChild(compassNode(v));
    grid.appendChild(seatCell(v, 1, 'right'));
    grid.appendChild(seatCell(v, 0, 'bottom'));
    table.appendChild(grid);
    app.appendChild(table);
    if (cfg.assist) app.appendChild(assistNode(v));

    // --- 手牌 ---
    var hz = el('div', 'handzone');
    if (v.melds.length) {
      var mm = el('div', 'my-melds');
      mm.appendChild(meldsNode(v.melds));
      hz.appendChild(mm);
    }
    hz.appendChild(handRow(v));
    hz.appendChild(actionBar(v));
    app.appendChild(hz);
  }

  function analysisNow(v) {
    var counts = C.countsFromIds(v.hand);
    var melds = v.melds.length;
    if (C.sumCounts(counts) % 3 === 2) {
      var cands = C.discardOptions(counts, melds, v.seen);
      return { type: 14, cands: cands, best: cands[0] };
    }
    var u = C.ukeire(counts, melds, v.seen);
    return { type: 13, shanten: u.shanten, ukeire: u.total, tiles: u.tiles };
  }

  function assistNode(v) {
    var box = el('div', 'assist-box');
    var a = analysisNow(v);
    box.appendChild(el('div', 'lbl', '手牌情報'));
    if (a.type === 14 && a.best) {
      var sh = a.best.shanten;
      var line = el('div');
      line.innerHTML = (sh < 0 ? '<b>和了</b>' : sh === 0 ? '<b>テンパイ</b>' : '<b>' + sh + '向聴</b>');
      box.appendChild(line);
      var best = R.recommendFor(v, state.mode === 'turn' ? state.opts : null);
      if (best) {
        var d = el('div');
        if (best.mode === 'fold') {
          d.innerHTML = '推奨打: <b>' + tileText(best.tile) + '</b>（ベタオリ・'
            + (best.danger ? best.danger.label : '') + '）';
        } else {
          d.innerHTML = '推奨打: <b>' + tileText(best.tile) + '</b> → 受け入れ <b>' + best.ukeire + '</b>枚'
            + (best.mode === 'push' ? '（押せる範囲で最大）' : '');
        }
        box.appendChild(d);
        if (best.mode !== 'fold' && best.tiles) {
          box.appendChild(el('div', null, best.tiles.slice(0, 8).map(function (x) {
            return tileText(x.type) + '×' + x.count;
          }).join(' ') + (best.tiles.length > 8 ? ' 他' + (best.tiles.length - 8) + '種' : '')));
        }
      }
    } else {
      var l2 = el('div');
      l2.innerHTML = (a.shanten === 0 ? '<b>テンパイ</b>' : '<b>' + a.shanten + '向聴</b>')
        + ' / 受け入れ <b>' + a.ukeire + '</b>枚';
      box.appendChild(l2);
      if (a.shanten === 0 && v.waits.length) {
        box.appendChild(el('div', null, '待ち: ' + v.waits.map(tileText).join('・')));
      }
    }
    var ths = D.foldThreats(v);
    if (ths.length) {
      box.appendChild(el('div', 'lbl', '押し引き'));
      box.appendChild(el('div', null, ths.map(function (t) {
        return SEAT_LABEL[(t.p - v.me + 4) % 4] + (t.riichi ? 'リーチ' : t.melds + 'フーロ');
      }).join('・')));
      var sh = a.type === 14 ? (a.best ? a.best.shanten : 9) : a.shanten;
      var cnts = C.countsFromIds(v.hand);
      var val = AI.handValue(v, cnts, v.melds.length);
      var good = a.type === 14 ? AI.isGoodShape(a.cands, sh) : (a.ukeire >= 6);
      var risk = Th.allowedRisk(sh, good, val >= 4, Math.floor(v.turnCount / 4) + 1, v.wallLeft);
      var line = el('div');
      line.innerHTML = risk <= 0.015
        ? '基準: <b>ベタオリ</b>（2向聴以下は即撤退）'
        : (sh === 0 ? '基準: <b>押し</b>（聴牌は押す）' : '基準: 放銃率 <b>' + Math.round(risk * 100) + '%</b> まで押せる');
      box.appendChild(line);
      var gen = D.genbutsuInHand(v, ths);
      box.appendChild(el('div', null, gen.length ? '現物: ' + gen.map(tileText).join('・') : '現物なし'));
    }
    var oc = orasuInfo(v);
    if (oc) {
      box.appendChild(el('div', 'lbl', 'オーラス条件'));
      oc.forEach(function (line) { box.appendChild(el('div', null, line)); });
    }
    return box;
  }


  // 卓中央の場況表示
  function compassNode(v) {
    var wrap = el('div', 'felt-center compass-cell');
    var c = el('div', 'compass');
    function pcell(k, cls) {
      var p = (v.me + k) % 4;
      var pd = v.players[p];
      var d = el('div', 'pscore ' + cls + (p === v.oya ? ' dealer' : ''));
      var w = el('span', 'w', WIND_CH[pd.seatWind]);
      d.appendChild(w);
      d.appendChild(el('span', 'sc', pd.score.toLocaleString()));
      d.appendChild(el('div', 'nm', k === 0 ? '自分' : SEAT_LABEL[k]));
      if (pd.riichi) d.appendChild(el('div', 'stick', ''));
      return d;
    }
    c.appendChild(el('div', 'c-blank'));
    c.appendChild(pcell(2, 'top'));
    c.appendChild(el('div', 'c-blank'));
    c.appendChild(pcell(3, 'left'));
    var mid = el('div', 'c-center');
    mid.appendChild(el('div', 'c-round', WIND_CH[v.roundWind] + v.kyoku + '局'));
    mid.appendChild(el('div', 'c-sub', v.honba + '本場' + (v.kyotaku ? ' / 供託' + v.kyotaku : '')));
    mid.appendChild(el('div', 'c-sub', '残り ' + v.wallLeft + '枚'));
    c.appendChild(mid);
    c.appendChild(pcell(1, 'right'));
    c.appendChild(el('div', 'c-blank'));
    c.appendChild(pcell(0, 'bottom'));
    c.appendChild(el('div', 'c-blank'));
    wrap.appendChild(c);
    return wrap;
  }


  // オーラス（最終局）なら逆転条件を計算（4・5・6の法則）
  function orasuInfo(v) {
    var last = v.rule.length === 'one'
      || (v.rule.length === 'tonpuu' && v.roundWind === 27 && v.kyoku === 4)
      || (v.rule.length === 'hanchan' && v.roundWind === 28 && v.kyoku === 4);
    if (!last) return null;
    var my = v.scores[v.me];
    var order = v.scores.map(function (s, i) { return { i: i, s: s }; }).sort(function (a, b) { return b.s - a.s; });
    if (order[0].i === v.me) return ['現在トップ（' + my.toLocaleString() + '点）。放銃に注意。'];
    var out = [];
    for (var k = 0; k < order.length; k++) {
      var t = order[k];
      if (t.i === v.me || t.s <= my) continue;
      var r = Th.orasuCondition(t.s - my, v.honba, v.kyotaku, v.me === v.oya, t.i === v.oya);
      if (!r) continue;
      out.push(SEAT_LABEL[(t.i - v.me + 4) % 4] + '超え(' + (t.s - my).toLocaleString() + '点差): ロン'
        + r.ronAny.toLocaleString() + '／直撃' + r.ronDirect.toLocaleString() + '／ツモ' + r.tsumoText);
      if (out.length >= 2) break;
    }
    return out.length ? out : null;
  }

  function handRow(v) {
    var row = el('div', 'hand-row');
    var clickable = (state.mode === 'turn' || state.mode === 'riichi-select');
    var allowed = {};
    if (state.mode === 'turn') state.opts.discardable.forEach(function (id) { allowed[id] = 1; });
    if (state.mode === 'riichi-select') state.opts.riichiTiles.forEach(function (id) { allowed[id] = 1; });

    var rec = null, dangerMap = {};
    if (cfg.assist && clickable) {
      rec = R.recommendFor(v, state.mode === 'turn' ? state.opts : null);
      var ths2 = D.threats(v);
      if (ths2.length) {
        v.hand.forEach(function (id) {
          var t = C.idToType(id);
          if (dangerMap[t] == null) dangerMap[t] = D.estimate(v, t, ths2);
        });
      }
    }

    var hand = v.hand.slice();
    var drawn = v.drawn;
    var rest = hand.filter(function (id) { return id !== drawn; });
    function tileButton(id, isDrawn) {
      var btn = el('button', 'tile-btn');
      var ok = clickable && allowed[id];
      if (ok) btn.className += ' clickable';
      var t = C.idToType(id);
      var slot = el('div', 'badge-slot');   // 牌の上に重ならないよう専用の行を確保
      btn.appendChild(slot);
      if (cfg.assist && clickable && allowed[id]) {
        if (rec && t === rec.tile) {
          slot.appendChild(el('span', 'badge rec', '推奨'));
        } else if (dangerMap[t]) {
          var dgv = dangerMap[t];
          if (dgv.rate <= 0.001) slot.appendChild(el('span', 'badge safe', '現物'));
          else if (dgv.rate >= 0.06) slot.appendChild(el('span', 'badge danger', Math.round(dgv.rate * 100) + '%'));
          btn.title = dgv.label + ' 推定放銃率' + (dgv.rate * 100).toFixed(1) + '%';
        }
      }
      btn.appendChild(tileById(id, {
        cls: (clickable && !allowed[id] ? 'dim' : '') + (isDrawn ? ' just' : '')
      }));
      if (ok) {
        btn.onclick = function () {
          if (state.mode === 'riichi-select') finishTurn({ type: 'riichi', tile: id });
          else finishTurn({ type: 'discard', tile: id });
        };
      }
      btn.setAttribute('aria-label', tileText(t) + (ok ? ' を切る' : ''));
      return btn;
    }
    rest.forEach(function (id) { row.appendChild(tileButton(id, false)); });
    if (drawn != null) {
      row.appendChild(el('div', 'gap'));
      row.appendChild(tileButton(drawn, true));
    }
    return row;
  }

  function actionBar(v) {
    var bar = el('div', 'actionbar');
    var o = state.opts, co = state.callOpts;
    function add(label, cls, fn) {
      var b = el('button', 'btn ' + (cls || ''), label);
      b.onclick = fn;
      bar.appendChild(b);
      return b;
    }
    if (state.mode === 'turn' && o) {
      if (o.canTsumo) add('ツモ', 'primary', function () { finishTurn({ type: 'tsumo' }); });
      if (o.canRiichi) add('リーチ', 'danger', function () {
        state.mode = 'riichi-select';
        state.feedback = { cls: '', tag: 'リーチ', text: '聴牌を保てる牌を選んでください（' + o.riichiTiles.map(function (id) { return tileText(C.idToType(id)); }).join('・') + '）' };
        render();
      });
      o.kans.forEach(function (k) {
        add((k.kind === 'ankan' ? '暗槓 ' : '加槓 ') + tileText(k.tile), '', function () {
          finishTurn({ type: 'kan', kind: k.kind, tile: k.tile });
        });
      });
      if (o.canKyuushu) add('九種九牌', '', function () { finishTurn({ type: 'kyuushu' }); });
      if (!o.canTsumo) bar.appendChild(el('span', 'hint', '切る牌をタップ'));
    } else if (state.mode === 'riichi-select') {
      add('やめる', 'ghost', function () { state.mode = 'turn'; state.feedback = null; render(); });
    } else if (state.mode === 'call' && co) {
      if (co.canRon) add('ロン', 'primary', function () { finishCall({ type: 'ron' }); });
      if (co.canPon) add('ポン', '', function () { finishCall({ type: 'pon', tiles: co.ponTiles }); });
      if (co.canKan) add('カン', '', function () { finishCall({ type: 'kan', tiles: co.kanTiles }); });
      co.chi.forEach(function (ch) {
        add('チー ' + ch.types.map(tileText).join('+'), '', function () {
          finishCall({ type: 'chi', tiles: ch.tiles });
        });
      });
      add('パス', 'ghost', function () { finishCall({ type: 'pass' }); });
    } else {
      bar.appendChild(el('span', 'hint', state.running ? '他家の手番…' : ''));
    }
    if (state.feedback) {
      var f = el('div', 'feedback ' + (state.feedback.cls || ''));
      var tag = el('span', 'tag', state.feedback.tag);
      f.appendChild(tag);
      f.appendChild(document.createTextNode(state.feedback.text));
      bar.appendChild(f);
    }
    return bar;
  }

  /* ---------- 操作の解決 ---------- */
  function finishTurn(action, forced) {
    var v = state.view, o = state.opts, rec = state.rec;
    var r;
    if (!forced && (action.type === 'discard' || action.type === 'riichi')) {
      if (o.canTsumo) rec.push(rec.winMissRecord(v, 'ツモ', o.tsumoResult));
      if (action.type === 'discard' && o.canRiichi) {
        var rs = rec.analyzeRiichiSkip(v, o, action.tile);
        if (rs) rec.push(rs);
      }
      r = rec.analyzeDiscard(v, o, action.tile);
      if (r) rec.push(r);
      showFeedback(r, action.type === 'riichi');
    }
    var res = state.resolve;
    state.mode = 'idle'; state.opts = null; state.resolve = null;
    render();
    res(action);
  }
  function finishCall(action) {
    var v = state.view, o = state.callOpts, rec = state.rec;
    if (o.canRon && action.type !== 'ron') {
      rec.push(rec.winMissRecord(v, 'ロン', o.ronResult));
      state.feedback = { cls: 'bad', tag: '見逃し', text: 'ロンを見逃しました。以降この待ちはフリテンになります。' };
    } else {
      var c = rec.analyzeCall(v, o, action);
      if (c) { rec.push(c); showFeedback(c); }
      else if (action.type !== 'pass') state.feedback = null;
    }
    var res = state.resolve;
    state.mode = 'idle'; state.callOpts = null; state.resolve = null;
    render();
    res(action);
  }

  function showFeedback(r, isRiichi) {
    if (!cfg.instant || !r) { state.feedback = null; return; }
    var cls = 'good', tag = '◎ 最適';
    if (r.severity === 'high') { cls = 'bad'; tag = '✗ ミス'; }
    else if (r.severity === 'mid') { cls = 'mid'; tag = '△ 要改善'; }
    else if (r.severity === 'low') { cls = 'mid'; tag = '△ 検討'; }
    else if (r.category === 'near') { cls = 'good'; tag = '○ ほぼ最適'; }
    else if (r.category === 'ok-fold' || r.category === 'ok-push') { cls = 'good'; tag = '○ 判断OK'; }
    state.feedback = { cls: cls, tag: (isRiichi ? 'リーチ宣言 / ' : '') + tag, text: r.comment };
  }

  /* ---------- 人間コントローラ ---------- */
  function humanController() {
    return {
      turnAction: function (v, o) {
        state.view = v; state.opts = o; state.mode = 'turn';
        if (!o.canTsumo && !o.canRiichi && !o.kans.length && o.discardable.length === 1) {
          // 選択肢なし(リーチ後のツモ切り)
          return new Promise(function (res) {
            state.mode = 'turn'; state.resolve = res; render();
            setTimeout(function () {
              if (state.mode === 'turn' && state.resolve === res) finishTurn({ type: 'discard', tile: o.discardable[0] }, true);
            }, Math.max(260, cfg.speed * 0.5));
          });
        }
        return new Promise(function (res) { state.resolve = res; render(); });
      },
      callAction: function (v, o) {
        state.view = v;
        if (!o.canRon && !o.canPon && !o.canKan && !o.chi.length) return { type: 'pass' };
        state.callOpts = o; state.mode = 'call';
        return new Promise(function (res) { state.resolve = res; render(); });
      }
    };
  }

  /* ---------- オーバーレイ ---------- */
  function overlay(build, opts) {
    return new Promise(function (resolve) {
      var ov = el('div', 'overlay');
      var panel = el('div', 'panel' + (opts && opts.wide ? ' wide' : ''));
      ov.appendChild(panel);
      function close(val) { ov.remove(); resolve(val); }
      build(panel, close);
      document.body.appendChild(ov);
      var first = panel.querySelector('button');
      if (first) first.focus();
    });
  }

  function scoreDeltaTable(before, after, labels) {
    var t = el('table', 'score-table');
    var thead = el('tr');
    ['', '点数', '増減'].forEach(function (h) { thead.appendChild(el('th', null, h)); });
    t.appendChild(thead);
    for (var p = 0; p < 4; p++) {
      var tr = el('tr');
      tr.appendChild(el('td', null, labels[p]));
      tr.appendChild(el('td', null, after[p].toLocaleString()));
      var d = after[p] - before[p];
      var td = el('td', d > 0 ? 'delta-plus' : (d < 0 ? 'delta-minus' : null), (d > 0 ? '+' : '') + d.toLocaleString());
      tr.appendChild(td);
      t.appendChild(tr);
    }
    return t;
  }

  function labelsFor(v) {
    var out = [];
    for (var p = 0; p < 4; p++) {
      var k = (p - 0 + 4) % 4;
      out[p] = SEAT_LABEL[k] + '(' + WIND_CH[state.game.seatWind(p)] + ')';
    }
    return out;
  }

  async function showAgari(e) {
    var rec = state.rec;
    var me = 0;
    // 検討用の記録
    if (e.kind === 'ron' && e.loser === me) {
      var last = null;
      for (var i = rec.records.length - 1; i >= 0; i--) if (rec.records[i].kind === 'discard') { last = rec.records[i]; break; }
      var avoidable = !!(last && last.safeOptions && last.safeOptions.length && last.danger >= 0.3);
      rec.meta.dealIns.push({ kyoku: e.kyoku, avoidable: avoidable, tile: e.winTile });
      rec.push({
        kind: 'dealin', kyoku: e.kyoku, roundWind: e.roundWind, go: last ? last.go : 0,
        hand: last ? last.hand : [], melds: last ? last.melds : [], chosen: C.idToType(e.winTile),
        severity: avoidable ? 'high' : 'low', category: 'dealin',
        comment: R.rel({ me: me }, e.winner) + 'に ' + e.result.points + '点の放銃（'
          + e.result.yaku.map(function (y) { return y.name; }).join('・') + '）。'
          + (avoidable
            ? '切った' + tileText(C.idToType(e.winTile)) + 'は無筋で、現物が ' + last.safeOptions.map(tileText).join('・') + ' にありました。'
            : '読みにくい牌での放銃で、避けるのは難しい局面でした。')
      });
    }
    if (e.winner === me) {
      rec.meta.wins.push({ kyoku: e.kyoku, points: e.gained, result: e.result });
      rec.meta.winTurns.push(Math.floor(state.gs.turnCount / 4) + 1);
      if (state.calledThisHand) rec.meta.callWins++;
    }
    if (e.kind === 'ron' && e.loser === me && state.calledThisHand) rec.meta.callDealIns++;
    state.handLog.push({
      kyoku: WIND_CH[e.roundWind] + e.kyoku + '局' + (e.honba ? ' ' + e.honba + '本場' : ''),
      text: (e.winner === me ? '自分の' : SEAT_LABEL[(e.winner - me + 4) % 4] + 'の')
        + (e.kind === 'tsumo' ? 'ツモ' : 'ロン') + ' ' + (e.result.name ? e.result.name + ' ' : '')
        + e.result.han + '翻' + (e.result.yakuman ? '' : e.result.fu + '符') + ' ' + e.gained + '点'
        + (e.kind === 'ron' && e.loser === me ? '（自分の放銃）' : ''),
      delta: (e.scores[me] - state.prevScores[me])
    });

    var before = state.prevScores, after = e.scores;
    await overlay(function (panel, close) {
      var head = (e.winner === 0 ? 'あなたの' : SEAT_LABEL[(e.winner) % 4] + 'の')
        + (e.kind === 'tsumo' ? 'ツモ和了' : 'ロン和了');
      panel.appendChild(el('h2', null, head));
      panel.appendChild(el('div', 'hint', WIND_CH[e.roundWind] + e.kyoku + '局 ' + e.honba + '本場'));

      var hv = el('div', 'result-hand');
      var ids = e.hand.slice();
      ids.sort(function (a, b) { return C.idToType(a) - C.idToType(b); });
      if (e.kind === 'ron') ids.push(e.winTile);
      ids.forEach(function (id, i) {
        var isWin = e.kind === 'ron' ? (i === ids.length - 1) : (id === e.winTile);
        hv.appendChild(tileById(id, { cls: isWin ? 'ron-tile' : '' }));
      });
      panel.appendChild(hv);
      if (e.melds && e.melds.length) panel.appendChild(meldsNode(e.melds));
      panel.appendChild(el('div', 'hint', (e.kind === 'ron' ? 'ロン牌' : 'ツモ牌') + ': '
        + tileText(C.idToType(e.winTile)) + '（赤枠）'));

      var dl = el('div', 'dora-box');
      dl.appendChild(el('span', 'chip', 'ドラ'));
      e.doraInd.forEach(function (t) { dl.appendChild(tileNode(C.doraFromIndicator(t))); });
      if (e.ura && e.ura.length) {
        dl.appendChild(el('span', 'chip', '裏'));
        e.ura.forEach(function (t) { dl.appendChild(tileNode(t)); });
      }
      panel.appendChild(dl);

      panel.appendChild(el('h3', null, '役'));
      var yl = el('div', 'yaku-list');
      e.result.yaku.forEach(function (y) {
        var row = el('div', 'row');
        row.appendChild(el('span', null, y.name));
        row.appendChild(el('span', null, y.yakuman ? '役満' : y.han + '翻'));
        yl.appendChild(row);
      });
      panel.appendChild(yl);
      var pts = el('div', 'pts', (e.result.name ? e.result.name + ' ' : '')
        + (e.result.yakuman ? '' : e.result.han + '翻' + e.result.fu + '符 ') + e.result.points + '点');
      if (e.gained !== e.result.points) {
        pts.appendChild(el('small', null, '受取 ' + e.gained.toLocaleString() + '点（本場・供託込み）'));
      }
      panel.appendChild(pts);

      panel.appendChild(el('h3', null, '点数'));
      panel.appendChild(scoreDeltaTable(before, after, labelsFor()));
      var b = el('button', 'btn primary', '次へ');
      b.onclick = function () { close(); };
      var wrap = el('div', 'actionbar');
      wrap.appendChild(b);
      panel.appendChild(wrap);
    });
  }

  async function showRyuukyoku(e) {
    var me = 0;
    state.handLog.push({
      kyoku: WIND_CH[e.roundWind] + e.kyoku + '局' + (e.honba ? ' ' + e.honba + '本場' : ''),
      text: e.reason === 'kyuushu' ? '九種九牌で流局'
        : '流局（テンパイ: ' + (e.tenpai.length ? e.tenpai.map(function (p) { return SEAT_LABEL[(p - me + 4) % 4]; }).join('・') : 'なし') + '）',
      delta: e.scores[me] - state.prevScores[me]
    });
    if (e.tenpai.indexOf(0) >= 0) state.rec.meta.tenpai++;
    var before = state.prevScores;
    await overlay(function (panel, close) {
      panel.appendChild(el('h2', null, e.reason === 'kyuushu' ? '九種九牌' : '流局'));
      panel.appendChild(el('p', null, e.tenpai.length
        ? 'テンパイ: ' + e.tenpai.map(function (p) { return SEAT_LABEL[(p - 0 + 4) % 4]; }).join('・')
        : '全員ノーテン'));
      var mine = e.hands[0].slice().sort(function (a, b) { return C.idToType(a) - C.idToType(b); });
      var hv = el('div', 'result-hand');
      mine.forEach(function (id) { hv.appendChild(tileById(id)); });
      panel.appendChild(hv);
      panel.appendChild(scoreDeltaTable(before, e.scores, labelsFor()));
      var wrap = el('div', 'actionbar');
      var b = el('button', 'btn primary', '次へ');
      b.onclick = function () { close(); };
      wrap.appendChild(b);
      panel.appendChild(wrap);
    });
  }

  /* ---------- 検討レポート ---------- */
  function mistakeNode(m) {
    var box = el('div', 'mistake ' + m.severity);
    var head = el('div', 'mhead');
    var sevText = m.severity === 'high' ? '重大' : m.severity === 'mid' ? '要改善' : '検討';
    var catText = {
      shanten: '牌効率(シャンテン戻し)', efficiency: '牌効率(受け入れ)', push: '押し引き',
      'win-miss': '和了見逃し', riichi: 'リーチ判断', call: '鳴き判断', dealin: '放銃',
      isolated: '孤立牌の切り順'
    }[m.category] || m.category;
    var pri = Th.PRIORITY[m.category];
    head.appendChild(el('span', 'sev', sevText));
    head.appendChild(el('span', null, (m.roundWind ? WIND_CH[m.roundWind] : '') + m.kyoku + '局 ' + (m.go ? m.go + '巡目' : '')));
    head.appendChild(el('span', null, catText));
    if (pri) head.appendChild(el('span', 'pri p' + pri.rank, '第' + pri.rank + '優先 / 影響' + pri.impact));
    box.appendChild(head);
    box.appendChild(el('div', 'cmt', m.comment));
    if (m.hand && m.hand.length) {
      var hv = el('div', 'hand-view');
      var ids = m.hand.slice().sort(function (a, b) { return C.idToType(a) - C.idToType(b); });
      ids.forEach(function (id) {
        var t = C.idToType(id);
        var cls = '';
        if (m.chosen != null && t === m.chosen) cls = 'ron-tile';
        else if (m.recommend != null && t === m.recommend) cls = 'marked';
        hv.appendChild(tileById(id, { cls: cls }));
      });
      if (m.melds && m.melds.length) hv.appendChild(meldsNode(m.melds));
      box.appendChild(hv);
      if (m.kind === 'discard') {
        var lg = el('div', 'legend');
        lg.appendChild(el('span', 'l-bad', '選んだ牌: ' + tileText(m.chosen)));
        if (m.recommend != null && m.recommend !== m.chosen) lg.appendChild(el('span', 'l-rec', '推奨: ' + tileText(m.recommend)));
        box.appendChild(lg);
      }
    }
    return box;
  }

  function showReport(isFinal) {
    var rep = state.rec.report();
    var s = rep.summary;
    return overlay(function (panel, close) {
      panel.appendChild(el('h2', null, isFinal ? '対局終了 / 検討レポート' : '途中検討'));
      if (isFinal && state.gs) {
        var order = state.gs.players.map(function (p, i) { return { i: i, s: p.score }; })
          .sort(function (a, b) { return b.s - a.s; });
        var myRank = order.findIndex(function (x) { return x.i === 0; }) + 1;
        panel.appendChild(el('p', null, '最終 ' + myRank + '位 / ' + state.gs.players[0].score.toLocaleString() + '点'));
      }
      panel.appendChild(el('h3', null, '成績'));
      var grid = el('div', 'stat-grid');
      function stat(k, v, sub) {
        var b = el('div', 'stat');
        b.appendChild(el('div', 'k', k));
        var vv = el('div', 'v');
        vv.textContent = v;
        if (sub) { var sm = el('small', null, ' ' + sub); vv.appendChild(sm); }
        b.appendChild(vv);
        return b;
      }
      grid.appendChild(stat('最適打率', s.optimalRate + '%', s.optimalCount + '/' + s.discardCount));
      grid.appendChild(stat('平均受け入れロス', s.avgUkeireLoss, '枚'));
      grid.appendChild(stat('重大ミス', s.severity.high, '回'));
      grid.appendChild(stat('要改善', s.severity.mid, '回'));
      grid.appendChild(stat('和了', s.wins, '回'));
      grid.appendChild(stat('放銃', s.dealIns, '回'));
      grid.appendChild(stat('リーチ', s.riichiCount, '回'));
      grid.appendChild(stat('局数', s.hands, '局'));
      panel.appendChild(grid);

      panel.appendChild(el('h3', null, 'スタッツ（参考値）'));
      var st = rep.stats;
      var T = Th.STATS_TARGET;
      var stbl = el('table', 'score-table');
      var hr = el('tr');
      ['指標', '今回', '目安', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      stbl.appendChild(hr);
      function srow(label, val, targetText, ok, raw) {
        var tr = el('tr');
        tr.appendChild(el('td', null, label));
        tr.appendChild(el('td', null, raw != null ? raw : (val == null ? '—' : Math.round(val * 1000) / 10 + '%')));
        tr.appendChild(el('td', null, targetText));
        tr.appendChild(el('td', ok === null ? null : (ok ? 'delta-plus' : 'delta-minus'), ok === null ? '' : (ok ? '○' : '△')));
        stbl.appendChild(tr);
      }
      srow('和了率', st.agariRate, '20〜23%', st.agariRate >= T.agari.low);
      srow('放銃率', st.houjuRate, '12%以下', st.houjuRate <= T.houju.good);
      srow('和銃差', st.diff, '10%以上', st.diff >= T.diff.min);
      srow('立直率', st.riichiRate, '20%前後', null);
      srow('副露率', st.fuuroRate, '20〜40%', null);
      srow('平均和了巡目', null, '12.0巡未満', st.avgWinTurn == null ? null : st.avgWinTurn < T.agariJunme.target,
        st.avgWinTurn == null ? '—' : (Math.round(st.avgWinTurn * 10) / 10) + '巡');
      if (st.fuuroAgariRate != null) {
        srow('副露後和了率', st.fuuroAgariRate, '30%前後', st.fuuroAgariRate >= 0.25);
        srow('副露後放銃率', st.fuuroHoujuRate, '11〜12%', st.fuuroHoujuRate <= 0.12);
      }
      panel.appendChild(stbl);
      panel.appendChild(el('p', 'hint',
        '※ ' + st.hands + '局ぶんのデータです。信頼できる自己分析には本来500〜1000半荘が必要で、'
        + 'この数字は傾向の目安にすぎません。安定して見るべきは下の指摘内容です。'));

      panel.appendChild(el('h3', null, '総評（改善の優先順）'));
      var ul = el('ul', 'advice');
      rep.advice.forEach(function (a) {
        var li = el('li');
        li.appendChild(el('b', null, '第' + a.rank + '優先 ' + a.title + ' — '));
        li.appendChild(document.createTextNode(a.text));
        ul.appendChild(li);
      });
      if (!rep.advice.length) ul.appendChild(el('li', null, '指摘なし。この調子で続けましょう。'));
      panel.appendChild(ul);
      var ph = Th.ROADMAP[rep.phase];
      if (ph) {
        var pbox = el('div', 'phase-box');
        pbox.appendChild(el('div', 'lbl', '現在地の目安（ロードマップ）'));
        pbox.appendChild(el('b', null, ph.phase + '（' + ph.rank + '）'));
        pbox.appendChild(el('div', null, '目標スタッツ: ' + ph.stats));
        pbox.appendChild(el('div', null, '次に固める技術: ' + ph.core));
        panel.appendChild(pbox);
      }

      if (state.handLog.length) {
        panel.appendChild(el('h3', null, '局の記録'));
        var t = el('table', 'score-table');
        state.handLog.forEach(function (h) {
          var tr = el('tr');
          tr.appendChild(el('td', null, h.kyoku));
          tr.appendChild(el('td', null, h.text));
          tr.appendChild(el('td', h.delta > 0 ? 'delta-plus' : (h.delta < 0 ? 'delta-minus' : null),
            (h.delta > 0 ? '+' : '') + h.delta.toLocaleString()));
          t.appendChild(tr);
        });
        panel.appendChild(t);
      }

      panel.appendChild(el('h3', null, '指摘（' + rep.mistakes.length + '件）'));
      if (!rep.mistakes.length) panel.appendChild(el('p', null, '指摘なし。良い打牌が続いています。'));
      var shown = rep.mistakes.slice(0, 40);
      shown.forEach(function (m) { panel.appendChild(mistakeNode(m)); });
      if (rep.mistakes.length > shown.length) {
        panel.appendChild(el('p', 'hint', '他 ' + (rep.mistakes.length - shown.length) + ' 件'));
      }

      var wrap = el('div', 'actionbar');
      var th = el('button', 'btn ghost', '理論ガイド');
      th.onclick = function () { theoryScreen(); };
      wrap.appendChild(th);
      if (isFinal) {
        var again = el('button', 'btn primary', 'もう一度対局');
        again.onclick = function () { close(); startScreen(); };
        wrap.appendChild(again);
      } else {
        var back = el('button', 'btn primary', '対局に戻る');
        back.onclick = function () { close(); };
        wrap.appendChild(back);
        var quit = el('button', 'btn ghost', '最初から');
        quit.onclick = function () {
          state.running = false;
          if (state.resolve) { var r = state.resolve; state.resolve = null; state.mode = 'idle'; r({ type: 'pass' }); }
          close(); startScreen();
        };
        wrap.appendChild(quit);
      }
      panel.appendChild(wrap);
    }, { wide: true });
  }


  /* ---------- 理論ガイド ---------- */
  function theoryScreen(jumpId) {
    return overlay(function (panel, close) {
      panel.appendChild(el('h2', null, '理論ガイド'));
      panel.appendChild(el('p', 'hint', '出典: 共有ドキュメント「麻雀の上達法と必須スキル」。このアプリの検討エンジンは、ここに書かれた基準をそのまま判定に使っています。'));

      var nav = el('div', 'tabs');
      var bodies = {};
      Th.SECTIONS.forEach(function (sec, idx) {
        var b = el('button', 'tab', sec.title);
        b.onclick = function () {
          Object.keys(bodies).forEach(function (k) { bodies[k].hidden = true; });
          Array.prototype.forEach.call(nav.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
          bodies[sec.id].hidden = false;
          b.setAttribute('aria-pressed', 'true');
        };
        nav.appendChild(b);
      });
      panel.appendChild(nav);

      Th.SECTIONS.forEach(function (sec, idx) {
        var box = el('div', 'theory-body');
        sec.body.forEach(function (p) { box.appendChild(el('p', null, p)); });
        if (sec.id === 'bouguyo') {
          var t = el('table', 'score-table danger-table');
          var hr = el('tr');
          ['ランク', '牌の分類', '推定放銃率'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
          t.appendChild(hr);
          Th.DANGER_TABLE.forEach(function (d) {
            var tr = el('tr');
            tr.appendChild(el('td', null, String(d.rank)));
            tr.appendChild(el('td', null, d.name));
            tr.appendChild(el('td', null, d.rate));
            t.appendChild(tr);
          });
          box.appendChild(t);
          box.appendChild(el('div', 'lbl', '統計的に否定された俗説'));
          var ml = el('ul', 'advice');
          Th.MYTHS.forEach(function (m) { ml.appendChild(el('li', null, m)); });
          box.appendChild(ml);
        }
        if (sec.id === 'stats') {
          var rbox = el('div');
          Th.ROADMAP.forEach(function (r) {
            var c = el('div', 'phase-box');
            c.appendChild(el('b', null, r.phase + '（' + r.rank + '）'));
            c.appendChild(el('div', null, 'スタッツ目標: ' + r.stats));
            c.appendChild(el('div', null, '習得すべき技術: ' + r.core));
            c.appendChild(el('div', 'hint', r.how));
            rbox.appendChild(c);
          });
          box.appendChild(rbox);
        }
        box.hidden = idx !== 0;
        bodies[sec.id] = box;
        panel.appendChild(box);
      });
      nav.children[0].setAttribute('aria-pressed', 'true');
      if (jumpId && bodies[jumpId]) {
        Object.keys(bodies).forEach(function (k) { bodies[k].hidden = k !== jumpId; });
        Array.prototype.forEach.call(nav.children, function (c, i) {
          c.setAttribute('aria-pressed', Th.SECTIONS[i].id === jumpId ? 'true' : 'false');
        });
      }
      var wrap = el('div', 'actionbar');
      var b2 = el('button', 'btn primary', '閉じる');
      b2.onclick = function () { close(); };
      wrap.appendChild(b2);
      panel.appendChild(wrap);
    }, { wide: true });
  }

  /* ---------- 進行 ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function onEvent(e, gs) {
    state.gs = gs;
    if (state.game) state.view = state.game.view(0);
    switch (e.type) {
      case 'hand-start':
        state.prevScores = gs.players.map(function (p) { return p.score; });
        state.feedback = null;
        state.calledThisHand = false;
        render();
        await sleep(240);
        break;
      case 'draw':
        render();
        if (e.player !== 0) await sleep(Math.max(40, cfg.speed * 0.18));
        break;
      case 'discard':
        render();
        if (e.player !== 0) await sleep(Math.max(90, cfg.speed * 0.55));
        break;
      case 'riichi':
        if (e.player !== 0) { render(); await sleep(cfg.speed); }
        else { state.rec.meta.riichi++; render(); }
        break;
      case 'call':
        if (e.player === 0 && !state.calledThisHand) { state.calledThisHand = true; state.rec.meta.callHands++; }
        render();
        await sleep(Math.max(150, cfg.speed * 0.8));
        break;
      case 'kan':
        render();
        await sleep(Math.max(150, cfg.speed * 0.8));
        break;
      case 'dora':
        render();
        break;
      case 'agari':
        state.mode = 'idle'; render();
        await showAgari(e);
        break;
      case 'ryuukyoku':
        state.mode = 'idle'; render();
        await showRyuukyoku(e);
        break;
      case 'hand-end':
        state.rec.meta.hands++;
        break;
      case 'game-end':
        state.running = false;
        render();
        await showReport(true);
        break;
    }
  }

  function startGame() {
    state.rec = R.createRecorder();
    state.handLog = [];
    state.running = true;
    var ais = [1, 2, 3].map(function () { return AI.create({ strength: cfg.strength }); });
    var game = Gm.createGame({
      rule: { length: cfg.length, aka: cfg.aka, kuitan: true },
      controllers: [humanController()].concat(ais),
      onEvent: onEvent
    });
    state.game = game;
    state.view = game.view(0);
    render();
    game.run().catch(function (err) {
      console.error(err);
      overlay(function (panel, close) {
        panel.appendChild(el('h2', null, 'エラーが発生しました'));
        panel.appendChild(el('p', null, String(err && err.message || err)));
        var w = el('div', 'actionbar');
        var b = el('button', 'btn primary', '最初に戻る');
        b.onclick = function () { close(); startScreen(); };
        w.appendChild(b);
        panel.appendChild(w);
      });
    });
  }

  /* ---------- 開始画面 ---------- */
  function startScreen() {
    state.view = null;
    app.innerHTML = '';
    overlay(function (panel, close) {
      panel.className += ' start';
      panel.appendChild(el('h1', null, '一人麻雀道場'));
      panel.appendChild(el('p', 'sub',
        'AI3人と実際に対局し、自分の打牌を1手ずつ採点します。シャンテン数・受け入れ枚数・押し引きを自動で判定し、終局後に「何がダメだったか」をまとめて指摘します。'));

      function seg(label, key, items) {
        var row = el('div', 'optrow');
        row.appendChild(el('div', 'lab', label));
        var g = el('div', 'seg');
        items.forEach(function (it) {
          var b = el('button', null, it.label);
          b.setAttribute('aria-pressed', cfg[key] === it.v ? 'true' : 'false');
          b.onclick = function () {
            cfg[key] = it.v; saveCfg();
            Array.prototype.forEach.call(g.children, function (c, i) {
              c.setAttribute('aria-pressed', items[i].v === it.v ? 'true' : 'false');
            });
          };
          g.appendChild(b);
        });
        row.appendChild(g);
        panel.appendChild(row);
      }
      seg('ゲーム', 'length', [
        { label: '東風戦', v: 'tonpuu' }, { label: '半荘', v: 'hanchan' }, { label: '1局のみ', v: 'one' }
      ]);
      seg('AIの強さ', 'strength', [
        { label: 'やさしい', v: 'easy' }, { label: 'ふつう', v: 'normal' }
      ]);
      seg('進行速度', 'speed', [
        { label: 'ゆっくり', v: 900 }, { label: 'ふつう', v: 520 }, { label: '速い', v: 220 }
      ]);

      var tog = el('div', 'optrow');
      tog.appendChild(el('div', 'lab', '練習補助'));
      [['assist', 'アシスト表示（向聴数・推奨打・安全牌）'], ['instant', '打牌ごとに即時指摘']].forEach(function (p) {
        var lb = el('label', 'toggle');
        var cb = el('input');
        cb.type = 'checkbox'; cb.id = 'opt-' + p[0]; cb.checked = !!cfg[p[0]];
        cb.onchange = function () { cfg[p[0]] = cb.checked; saveCfg(); };
        lb.appendChild(cb);
        lb.appendChild(el('span', null, p[1]));
        tog.appendChild(lb);
      });
      panel.appendChild(tog);

      var wrap = el('div', 'actionbar');
      var b = el('button', 'btn primary', '対局開始');
      b.onclick = function () { close(); startGame(); };
      wrap.appendChild(b);
      var bt = el('button', 'btn ghost', '理論ガイド');
      bt.onclick = function () { theoryScreen(); };
      wrap.appendChild(bt);
      panel.appendChild(wrap);
      panel.appendChild(el('p', 'hint',
        '赤ドラあり / 喰いタンあり / 後付けあり。符・役・裏ドラまで計算します。'));
    });
  }

  startScreen();
})();
