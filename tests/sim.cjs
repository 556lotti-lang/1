const fs=require('fs');
for(const f of ['core','score','game','theory','danger','discard','ai','review']) new Function(fs.readFileSync(require('path').join(__dirname,'..','src',f+'.js'),'utf8'))();
const C=globalThis.MJCore,G=globalThis.MJGame,AI=globalThis.MJAI;
(async()=>{
  let stats={agari:0,tsumo:0,ron:0,ryuukyoku:0,riichi:0,call:0,kan:0,hands:0,games:0,err:0,yakuman:0,maxPts:0,scoreSumBad:0};
  const t0=Date.now();
  const GAMES=+(process.argv[2]||20);
  for(let g=0;g<GAMES;g++){
    const game=G.createGame({
      rule:{length:'tonpuu'},
      controllers:[0,1,2,3].map(()=>AI.create({strength:'normal'})),
      onEvent:(e,st)=>{
        if(e.type==='agari'){stats.agari++; if(e.kind==='tsumo')stats.tsumo++;else stats.ron++; if(e.result.yakuman)stats.yakuman++; stats.maxPts=Math.max(stats.maxPts,e.result.points);}
        if(e.type==='ryuukyoku')stats.ryuukyoku++;
        if(e.type==='riichi')stats.riichi++;
        if(e.type==='call')stats['call_'+e.callType]=(stats['call_'+e.callType]||0)+1;
        if(e.type==='kan')stats.kan++;
        if(e.type==='hand-end')stats.hands++;
      }
    });
    try{
      const r=await game.run();
      stats.games++;
      const sum=r.scores.reduce((a,b)=>a+b,0)+game.state.kyotaku*1000;
      if(sum!==100000) {stats.scoreSumBad++; if(stats.scoreSumBad<3)console.log('score sum',sum,r.scores,'kyotaku',game.state.kyotaku);}
    }catch(err){ stats.err++; if(stats.err<3) console.log('ERROR:',err.message,'\n',err.stack.split('\n').slice(0,4).join('\n')); }
  }
  console.log(JSON.stringify(stats,null,0));
  console.log('time',Date.now()-t0,'ms for',stats.games,'games /',stats.hands,'hands');
})();
