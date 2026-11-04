/* エンジン検証テスト:  node tests/engine.test.cjs */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src');
for (const f of ['core.js', 'score.js', 'theory.js', 'danger.js', 'discard.js', 'ai.js', 'review.js']) new Function(fs.readFileSync(path.join(dir, f), 'utf8'))();
const C = globalThis.MJCore, S = globalThis.MJScore, Th = globalThis.MJTheory, D = globalThis.MJDanger, R = globalThis.MJReview;

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (ok) pass++; else { fail++; console.log('FAIL ' + name + '\n  got=' + JSON.stringify(got) + '\n  exp=' + JSON.stringify(exp)); }
}
function hand(str) { // "123m456p789s11z"
  const c = C.emptyCounts(); let buf = [];
  for (const ch of str) {
    if ('mpsz'.includes(ch)) { const s = 'mpsz'.indexOf(ch); for (const n of buf) c[s === 3 ? 27 + (n - 1) : s * 9 + (n - 1)]++; buf = []; }
    else buf.push(+ch);
  }
  return c;
}
const T = s => { const c = hand(s); for (let i = 0; i < 34; i++) if (c[i]) return i; return -1; };

/* ---------- シャンテン ---------- */
eq('shanten 配牌天和形', C.shanten(hand('123m456m789m123p11p')), -1);
eq('shanten 聴牌', C.shanten(hand('123m456m789m123p1p')), 0);
eq('shanten 1向聴', C.shanten(hand('123m456m789m13p5p')), 1);
eq('shanten 5ブロック雀頭なし', C.shanten(hand('111m222m333m4578p')), 1);
eq('shanten 七対子形は聴牌', C.shanten(hand('1122334455m678p')), 0);
eq('shanten 七対子1向聴', C.shanten(hand('112233445m678p9p')), 1);
eq('shanten 国士1向聴', C.shanten(hand('19m19p19s123456z')), 1);
eq('shanten 鳴き1つ聴牌', C.shanten(hand('123m456m789m1p'), 1), 0);
eq('shanten 鳴き2つ聴牌', C.shanten(hand('123m456m1p'), 2), 0);
eq('shanten 鳴き3つ単騎', C.shanten(hand('1112m'), 3), 0);

/* ---------- 待ち ---------- */
eq('待ち 両面', C.waitsOf(hand('123m456m789m12p11z')).map(C.typeToStr), ['3p']);
eq('待ち ノベタン', C.waitsOf(hand('123m456m789m2345p')).map(C.typeToStr), ['2p', '5p']);
eq('待ち 三面張', C.waitsOf(hand('123m456m34567p11z')).map(C.typeToStr), ['2p', '5p', '8p']);
eq('待ち 国士13面', C.waitsOf(hand('19m19p19s1234567z')).length, 13);
eq('待ち シャンポン', C.waitsOf(hand('123m456m789m11p22p')).map(C.typeToStr), ['1p', '2p']);

/* ---------- 受け入れ ---------- */
eq('受け入れ 聴牌(両面)', C.ukeire(hand('123m456m789m12p11z')).total, 4);
eq('受け入れ 1向聴', C.ukeire(hand('123m456m789m1159p')).total, 28);

/* ---------- 点数 ---------- */
function sc(o) {
  const r = S.score(Object.assign({ seatWind: 27, roundWind: 27, melds: [] }, o));
  return r;
}
let r;
r = sc({ concealed: hand('234m567m234p567p11s'), winTile: T('4m'), isTsumo: true, seatWind: 28 });
eq('平和ツモ 20符2翻', [r.han, r.fu, r.points], [2, 20, 1500]);

r = sc({ concealed: hand('234m567m234p567p11s'), winTile: T('4m'), isTsumo: false, isRiichi: true, seatWind: 28 });
eq('リーチ平和ロン 30符2翻', [r.han, r.fu, r.points], [2, 30, 2000]);

r = sc({ concealed: hand('123m456m789m123p11p'), winTile: T('1p'), isRiichi: true, seatWind: 28 });
eq('リーチ平和一通ロン', [r.han, r.fu, r.points], [4, 30, 7700]);

r = sc({ concealed: hand('11223344556677m'), winTile: T('7m'), seatWind: 28 });
eq('清一色二盃口平和(七対子より高い形を採用)', [r.han, r.fu, r.points], [10, 30, 16000]);
r = sc({ concealed: hand('1133557799m1122p'), winTile: T('2p'), seatWind: 28 });
eq('七対子ロン 25符2翻', [r.han, r.fu, r.points], [2, 25, 1600]);

r = sc({ concealed: hand('112233m456m789p11s'), winTile: T('3m'), seatWind: 28 });
eq('一盃口ロン(辺張) 40符1翻', [r.han, r.fu, r.points], [1, 40, 1300]);
r = sc({ concealed: hand('223344m456m567p22s'), winTile: T('4m'), seatWind: 28 });
eq('断么九一盃口平和ロン', [r.han, r.fu, r.points], [3, 30, 3900]);

r = sc({ concealed: hand('19m19p19s12345677z'), winTile: T('7z'), seatWind: 28 });
eq('国士無双ロン 役満', [r.yakuman, r.points], [1, 32000]);

r = sc({ concealed: hand('19m19p19s12345677z'), winTile: T('1m'), seatWind: 28 });
eq('国士13面 ダブル役満', [r.yakuman, r.points], [2, 64000]);

r = sc({ concealed: hand('111m333m555p777p22s'), winTile: T('2s'), isTsumo: true, seatWind: 28 });
eq('四暗刻単騎ツモ', [r.yakuman, r.points], [2, 64000]);

r = sc({ concealed: hand('111m333m555p777p22s'), winTile: T('2s'), isTsumo: false, seatWind: 28 });
eq('四暗刻単騎ロン(ダブル)', [r.yakuman], [2]);

r = sc({ concealed: hand('555z666z777z234m22p'), winTile: T('2p'), seatWind: 28 });
eq('大三元', [r.yakuman, r.points], [1, 32000]);
r = sc({ concealed: hand('555z666z777z111m22p'), winTile: T('2p'), seatWind: 28 });
eq('大三元+四暗刻単騎の複合', [r.yakuman], [3]);

r = sc({ concealed: hand('234m22z'), melds: [{ type: 'pon', tile: T('1z') }, { type: 'pon', tile: T('5z') }, { type: 'chi', tile: T('6m') }], winTile: T('2z'), seatWind: 28, roundWind: 27 });
eq('鳴き 場風+役牌+混一色', [r.han, r.points], [4, 8000]);
r = sc({ concealed: hand('11122234m'), melds: [{ type: 'pon', tile: T('1z') }, { type: 'chi', tile: T('6m') }], winTile: T('4m'), seatWind: 28, roundWind: 27 });
eq('食い下がり混一色', [r.han, r.fu, r.points], [3, 40, 5200]);

r = sc({ concealed: hand('111999m111999p11s'), winTile: T('1s'), seatWind: 28 });
eq('清老頭(+四暗刻単騎)', [r.yakuman], [3]);

r = sc({ concealed: hand('1112345678999m9m'), winTile: T('9m'), seatWind: 28 });
eq('九蓮宝燈', r.yakuman >= 1, true);

r = sc({ concealed: hand('123m123p123s789m11z'), winTile: T('1z'), seatWind: 28 });
eq('三色同順+混全帯么九', [r.han, r.fu, r.points], [4, 40, 8000]);

r = sc({ concealed: hand('123456789m11p222p'), winTile: T('1p'), isTsumo: true, seatWind: 28 });
eq('一気通貫ツモ', [r.han, r.fu, r.points], [3, 30, 4000]);

r = sc({ concealed: hand('111m333m555p777z99s'), winTile: T('7z'), seatWind: 28 });
eq('対々和+三暗刻+役牌(シャンポンロン)', [r.han, r.fu, r.points], [5, 50, 8000]);

r = sc({ concealed: hand('234m567m234p567p11s'), winTile: T('4m'), isTsumo: true, isDealer: true, seatWind: 27 });
eq('親 平和ツモ', [r.han, r.fu, r.points], [2, 20, 2100]);

r = sc({ concealed: hand('234m567m234p567p11s'), winTile: T('4m'), isRiichi: true, isIppatsu: true, isTsumo: true, seatWind: 28, dora: [T('2m')] });
eq('リーチ一発ツモ平和ドラ1=満貫', [r.han, r.fu, r.points, r.name], [5, 20, 8000, '満貫']);
r = sc({ concealed: hand('234m567m234p567p11s'), winTile: T('4m'), isTsumo: true, seatWind: 28, redCount: 2 });
eq('赤ドラ2', [r.han], [4]);

// 役なし
r = sc({ concealed: hand('234m567m234p567p99p'), winTile: T('9p'), seatWind: 28 });
eq('役なし(形式テンパイ系)は null', r, null);

// 符計算: 暗刻/明刻
r = sc({ concealed: hand('111m234m567m999p11z'), winTile: T('1z'), seatWind: 28, isRiichi: true, roundWind: 27 });
eq('符計算 20+8+8+2(場風雀頭)+2(単騎)+10 = 50符', [r.han, r.fu, r.points], [1, 50, 1600]);
r = sc({ concealed: hand('234m567m11s'), melds: [{ type: 'kan', tile: T('1z'), closed: true }, { type: 'pon', tile: T('5z') }], winTile: T('1s'), seatWind: 28, roundWind: 27 });
eq('暗槓(么九)32符+明刻4符 = 60符', [r.han, r.fu, r.points], [2, 60, 3900]);

/* ---------- 支払い内訳 ---------- */
r = sc({ concealed: hand('234m567m234p567p11s'), winTile: T('4m'), isTsumo: true, seatWind: 28 });
eq('子ツモ内訳', [r.pay.fromDealer, r.pay.fromOther], [700, 400]);

/* ---------- 高速版 vs リファレンス ---------- */
let mismatch = 0;
for (let m = 0; m <= 3; m++) for (let k = 0; k < 3000; k++) {
  const w = []; for (let i = 0; i < 34; i++) for (let j = 0; j < 4; j++) w.push(i);
  for (let i = w.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[w[i], w[j]] = [w[j], w[i]]; }
  const c = C.emptyCounts(); for (let i = 0; i < 13 - 3 * m; i++) c[w[i]]++;
  if (C.shantenStandard(c, m) !== C.shantenStandardSlow(c, m)) mismatch++;
}
eq('高速シャンテン==リファレンス(12000局面)', mismatch, 0);

/* ---------- 戦術基準（資料「麻雀の上達法と必須スキル」準拠） ---------- */

// オーラス条件計算 4・5・6の法則（資料の計算例と一致すること）
let oc = Th.orasuCondition(5000, 2, 1, false, false);
eq('条件計算 D5000/2本場/供託1 脇ロン', oc.ronAny, 3900);
eq('条件計算 D5000/2本場/供託1 直撃', oc.ronDirect, 2000);
eq('条件計算 Δ3200 自分が親(÷4)', Th.orasuCondition(3200, 0, 0, true, false).tsumoText, '1,000点オール');
eq('条件計算 Δ3200 子→子(÷5)', Th.orasuCondition(3200, 0, 0, false, false).tsumoText, '700・1300');
eq('条件計算 Δ3200 子→親(÷6)', Th.orasuCondition(3200, 0, 0, false, true).tsumoText, '700・1300');
eq('条件計算 既にトップなら差0で null', Th.orasuCondition(0, 0, 0, false, false), null);

// 押し引きの許容放銃率（聴牌は押し / 1向聴は条件つき / 2向聴以下はベタオリ）
eq('押し引き 聴牌は押し', Th.allowedRisk(0, true, true, 8, 40) === 1, true);
eq('押し引き 2向聴は撤退', Th.allowedRisk(2, true, true, 8, 40) <= 0.015, true);
eq('押し引き 好形高打点1向聴(中盤)', Th.allowedRisk(1, true, true, 8, 40), 0.18);
eq('押し引き 好形高打点1向聴(14巡目)', Th.allowedRisk(1, true, true, 14, 20), 0.05);
eq('押し引き 愚形安手1向聴', Th.allowedRisk(1, false, false, 8, 40), 0.06);
eq('守備モデル 3フーロは即オリ', Th.foldLineVsMelds(3, 1), true);
eq('守備モデル 2フーロは7巡目以降', [Th.foldLineVsMelds(2, 6), Th.foldLineVsMelds(2, 7)], [false, true]);
eq('守備モデル 1フーロは10巡目以降', [Th.foldLineVsMelds(1, 9), Th.foldLineVsMelds(1, 10)], [false, true]);

// 孤立牌の価値序列: 字牌 < 1,9 < 2,8 < 3-7、客風は北→西→南→東の順に処理
const vw = { seatWind: 28, roundWind: 27 };
eq('孤立牌 字牌 < 1萬', Th.isolatedValue(T('1z'), vw) < Th.isolatedValue(T('1m'), vw), true);
eq('孤立牌 1萬 < 2萬', Th.isolatedValue(T('1m'), vw) < Th.isolatedValue(T('2m'), vw), true);
eq('孤立牌 2萬 < 5萬', Th.isolatedValue(T('2m'), vw) < Th.isolatedValue(T('5m'), vw), true);
eq('孤立牌 客風 < 役牌(白)', Th.isolatedValue(T('3z'), vw) < Th.isolatedValue(T('5z'), vw), true);
eq('孤立牌 北を西より先に切る', Th.isolatedValue(T('4z'), vw) < Th.isolatedValue(T('3z'), vw), true);
eq('孤立牌 西を南より先に切る', Th.isolatedValue(T('3z'), vw) < Th.isolatedValue(T('2z'), vw), true);

// 危険度序列（リーチ者の河に 4m / 2p がある想定）
function dangerView(discards, myHand) {
  const seen = C.emptyCounts();
  const d1 = discards.map((t, i) => ({ id: t * 4, turn: i + 1 }));
  d1.forEach(d => seen[C.idToType(d.id)]++);
  myHand.forEach(t => seen[t]++);
  return {
    me: 0, hand: myHand.map(t => t * 4), seen, turnCount: 24, wallLeft: 40,
    players: [0, 1, 2, 3].map(i => ({
      idx: i, discards: i === 1 ? d1 : [], melds: [], riichi: i === 1, riichiTurn: i === 1 ? 0 : -1
    }))
  };
}
const dv = dangerView([T('4m'), T('2p')], [T('1m'), T('5m'), T('7m'), T('1p'), T('5p'), T('1z'), T('5z')]);
const dr = t => D.estimate(dv, T(t));
eq('危険度 現物は0%(リーチ者に対して)', D.against(dv, 1, T('4m')).rate, 0);
eq('危険度 合成は他家のテンパイ推定も含む', dr('4m').rate < 0.03 && dr('4m').rate >= 0, true);
eq('テンパイ率 リーチは100%', D.tenpaiProb(dv, 1), 1);
eq('テンパイ率 門前ダマは低く見積もる', D.tenpaiProb(dv, 2) < 0.2, true);
eq('危険度 スジの1・9', dr('1m').label, 'スジの1・9');
eq('危険度 スジは数字で安全度が違う(1・9 < 2・8 < 3・7)',
  D.against(dv, 1, T('1m')).rate < D.against(dv, 1, T('5p')).rate, true);
eq('危険度 無スジ中張(5萬)が最も危険', dr('5m').rate > dr('1m').rate && dr('5m').rate > dr('5z').rate, true);
eq('危険度 生牌の字牌は片スジより安全', dr('5z').rate < 0.09, true);
eq('危険度 片スジ(5筒)', dr('5p').label, '片スジ');
const dv2 = dangerView([T('4m'), T('2p')], [T('4m'), T('5m'), T('7m'), T('2p'), T('5p'), T('1z')]);
eq('現物の抽出', D.genbutsuInHand(dv2).map(C.typeToStr).sort(), ['2p', '4m']);

// ブロック数（5ブロック理論の判定用）
eq('ブロック数 4ブロック', R.blockCount(hand('123m456m78p11s3z'), 0), 4);
eq('ブロック数 5ブロック', R.blockCount(hand('123m45m78p11s34s9z'), 0), 5);
eq('ブロック数 鳴き込み', R.blockCount(hand('45m78p11s34s'), 1), 5);

/* ---------- 推奨打牌エンジン（出典2「麻雀の局の進め方と戦術」） ---------- */
const Dis = globalThis.MJDiscard;
function mkview(h, turn, opt) {
  opt = opt || {};
  const c = hand(h), ids = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < c[t]; k++) ids.push(t * 4 + k);
  const seen = c.slice();
  const pl = [0, 1, 2, 3].map(i => ({
    idx: i, discards: [], melds: [], riichi: false, riichiTurn: -1,
    seatWind: [28, 29, 30, 27][i], score: 25000, handSize: 13
  }));
  if (opt.riichi) {
    pl[1].riichi = true; pl[1].riichiTurn = 0;
    pl[1].discards = (opt.rd || []).map((t, i) => ({ id: t * 4, turn: i * 4 }));
    pl[1].discards.forEach(d => seen[C.idToType(d.id)]++);
  }
  if (opt.melds1) pl[1].melds = opt.melds1;
  return {
    me: 0, hand: ids, melds: [], drawn: ids[ids.length - 1], seen,
    turnCount: (turn - 1) * 4, wallLeft: 70 - (turn - 1) * 4,
    seatWind: 28, roundWind: 27, oya: 1, kyoku: 1, honba: 0, kyotaku: 0,
    scores: [25000, 25000, 25000, 25000], rule: { length: 'tonpuu', kuitan: true },
    doraInd: [opt.dora != null ? opt.dora : 8], waits: [], riichi: false, players: pl
  };
}
const recTile = (h, turn, opt) => { const r = Dis.recommend(mkview(h, turn, opt), null); return r ? C.typeToStr(r.tile) : null; };

// 孤立牌の切り順: オタ風 → 孤立1・9 → 役牌 → 孤立2・8 → 孤立5 → 孤立4・6 → 孤立3・7
eq('孤立牌 オタ風を最初に切る', recTile('123m59m1p25p135s9s4z5z', 1), '北');
eq('孤立牌 2枚切れ字牌は最優先', (() => {
  const v = mkview('123m59m1p25p135s9s4z5z', 1);
  v.seen[31] += 2;   // 白が場に2枚見え
  return C.typeToStr(Dis.recommend(v, null).tile);
})(), '白');
eq('孤立牌 1・9は役牌より先', (() => {
  const v = mkview('123m456m789p345s9m5z', 2);  // 4面子+孤立9萬+孤立白
  return C.typeToStr(Dis.recommend(v, null).tile);
})(), '9m');
eq('孤立牌 役牌はオタ風より後', (() => {
  const v = mkview('123m456m789p345s5z4z', 2);  // 孤立白 と オタ風北
  return C.typeToStr(Dis.recommend(v, null).tile);
})(), '北');
eq('孤立牌の序列 3・7 > 4・6 > 5 > 2・8 > 1・9', [
  Dis.isolatedPriority({ seatWind: 28, roundWind: 27, players: [] }, C.emptyCounts(), T('3m')).v,
  Dis.isolatedPriority({ seatWind: 28, roundWind: 27, players: [] }, C.emptyCounts(), T('4m')).v,
  Dis.isolatedPriority({ seatWind: 28, roundWind: 27, players: [] }, C.emptyCounts(), T('5m')).v,
  Dis.isolatedPriority({ seatWind: 28, roundWind: 27, players: [] }, C.emptyCounts(), T('2m')).v,
  Dis.isolatedPriority({ seatWind: 28, roundWind: 27, players: [] }, C.emptyCounts(), T('1m')).v
], [6, 5.5, 5, 4, 2]);

// ブロックの強弱
const bq = (h, t) => Dis.tileRole({ seatWind: 28, roundWind: 27 }, hand(h), T(t)).k;
eq('ブロック 両面', bq('23m', '2m'), 'ryanmen');
eq('ブロック 辺張', bq('12m', '1m'), 'penchan');
eq('ブロック 内嵌張', bq('35m', '3m'), 'kanchanIn');
eq('ブロック 外嵌張', bq('13m', '1m'), 'kanchanOut');
eq('ブロック 完成順子', bq('234m', '3m'), 'set');

// 二向聴以下でリーチを受けたらベタオリ(危険度序列)
const foldRec = Dis.recommend(mkview('1239m258p1259s4z5z6z', 10, { riichi: true, rd: [27, 0, 18, 13] }), null);
eq('リーチに2向聴以下はベタオリ', foldRec.mode, 'fold');
eq('ベタオリでは現物を選ぶ', foldRec.rule, '危険度序列');

// 染め手の判定
const someRec = Dis.recommend(mkview('12356789p99p2m7m5z5z', 4), null);
eq('染め手は不要スーツから処理', C.suitOf(someRec.tile) !== 1, true);
eq('染め手の判定', someRec.rule, '染め手の手順');

// フェーズ
eq('フェーズ 序盤/中盤/終盤', [Th.phaseOf(3).id, Th.phaseOf(9).id, Th.phaseOf(15).id], ['early', 'mid', 'late']);
eq('副露聴牌率 2副露中盤', Th.furoTenpai(2, 9), 0.55);
eq('副露聴牌率 3副露終盤', Th.furoTenpai(3, 15), 0.95);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
