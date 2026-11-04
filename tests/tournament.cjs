/* AIの強さ検証: 強いAI1人 vs ふつう3人で平均順位を比べる
   node tests/tournament.cjs [games] [strengthA] [strengthB] */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src');
for (const f of ['core', 'score', 'game', 'theory', 'danger', 'discard', 'ai', 'review'])
  new Function(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'))();
const G = globalThis.MJGame, AI = globalThis.MJAI;

(async () => {
  const GAMES = +(process.argv[2] || 100);
  const A = process.argv[3] || 'strong', B = process.argv[4] || 'normal';
const tuneA = process.argv[5] ? JSON.parse(process.argv[5]) : null;
const tuneB = process.argv[6] ? JSON.parse(process.argv[6]) : null;
  const stat = { rankSum: 0, pointSum: 0, ranks: [0, 0, 0, 0], agari: 0, houju: 0, hands: 0, riichi: 0, err: 0 };
  const other = { rankSum: 0, pointSum: 0, agari: 0, houju: 0 };
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 4;                       // 席順の有利不利をならす
    const ctrls = [0, 1, 2, 3].map(i => AI.create(i === seat ? { strength: A, tune: tuneA } : { strength: B, tune: tuneB }));
    const game = G.createGame({
      rule: { length: 'tonpuu' }, controllers: ctrls,
      onEvent: (e) => {
        if (e.type === 'hand-end') stat.hands++;
        if (e.type === 'riichi' && e.player === seat) stat.riichi++;
        if (e.type === 'agari') {
          if (e.winner === seat) stat.agari++; else other.agari++;
          if (e.loser === seat) stat.houju++; else if (e.loser != null) other.houju++;
        }
      }
    });
    try {
      const r = await game.run();
      const order = r.order.findIndex(x => x.idx === seat) + 1;
      stat.rankSum += order; stat.ranks[order - 1]++;
      stat.pointSum += r.scores[seat] - 25000;
      for (let i = 0; i < 4; i++) if (i !== seat) { other.pointSum += r.scores[i] - 25000; }
    } catch (err) { stat.err++; if (stat.err < 3) console.log('ERR', err.message); }
  }
  const n = GAMES - stat.err;
  console.log(`=== ${A} 1人 vs ${B} 3人 / ${n}半荘(東風) ===`);
  console.log('平均順位 :', (stat.rankSum / n).toFixed(3), ' (期待値2.500)');
  console.log('順位分布 :', stat.ranks.map((c, i) => (i + 1) + '位' + (c / n * 100).toFixed(1) + '%').join(' '));
  console.log('平均点差 :', Math.round(stat.pointSum / n), '点 / 他3人平均', Math.round(other.pointSum / (n * 3)), '点');
  console.log('和了率   :', (stat.agari / (stat.hands || 1) * 100).toFixed(1) + '%',
    ' 他3人平均', (other.agari / (stat.hands || 1) / 3 * 100).toFixed(1) + '%');
  console.log('放銃率   :', (stat.houju / (stat.hands || 1) * 100).toFixed(1) + '%',
    ' 他3人平均', (other.houju / (stat.hands || 1) / 3 * 100).toFixed(1) + '%');
  console.log('立直率   :', (stat.riichi / (stat.hands || 1) * 100).toFixed(1) + '%');
  console.log('時間     :', Date.now() - t0, 'ms  エラー:', stat.err);
})();
