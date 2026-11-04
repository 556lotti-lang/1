/* エンジン検証テスト:  node tests/engine.test.cjs */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src');
for (const f of ['core.js', 'score.js']) new Function(fs.readFileSync(path.join(dir, f), 'utf8'))();
const C = globalThis.MJCore, S = globalThis.MJScore;

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
