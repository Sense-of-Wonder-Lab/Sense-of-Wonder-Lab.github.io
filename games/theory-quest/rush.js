/* 化学RUSH！（化学基礎クエストの1人用を移植 2026-10-30）。問題は data.js の RUSH_QUESTIONS（make_game_data.py が生成） */
const runnerPanel=document.getElementById('runnerPanel');
const RUNNER_QUESTIONS=RUSH_QUESTIONS;
const RUNNER_GENRES=RUSH_GENRES.filter(g=>RUNNER_QUESTIONS.some(q=>q.genre===g));
const isKiso=g=>g.startsWith('化学基礎');
// 分野の範囲ごとに全国ランキングを分ける（kind は gameId 'theory' の中の名前）
const RUNNER_SCOPES=[
  { value:'all', label:'理論化学 全分野', kind:'runnerScore', match:()=>true },
  { value:'kiso', label:'化学基礎の分野（原子の構造・モル／酸塩基／酸化還元）', kind:'runnerScoreKiso', match:isKiso },
  { value:'riron', label:'化学の分野（状態変化〜化学平衡）', kind:'runnerScoreRiron', match:g=>!isKiso(g) },
  ...RUNNER_GENRES.map(g=>({ value:g, label:g, kind:'runnerScoreG'+(RUSH_GENRES.indexOf(g)+1), match:gg=>gg===g })),
];
function runnerScopeOf(value){ return RUNNER_SCOPES.find(s=>s.value===value) || RUNNER_SCOPES[0]; }

// ---------- 沸騰フラスコ演出 (WebGL/PixiJS) ----------
const RUNNER_INSTRUMENTS = [
  { label:'メスフラスコ',     glass:'../chembasics-quest/assets_flask/flask_empty_final.png', mask:'../chembasics-quest/assets_flask/liquid_mask_raster2.png',   surfaceBase: 0.26,  particleArea:{x:150,y:380,w:180,h:60},  imgW:485,  imgH:530, scale:0.48 },
  { label:'ビュレット',       glass:'../chembasics-quest/assets_flask/burette_empty.png',     mask:'../chembasics-quest/assets_flask/burette_mask.png',          surfaceBase:-1.0,   particleArea:{x:225,y:250,w:30,h:100},  imgW:485,  imgH:530, scale:0.48 },
  { label:'ホールピペット',   glass:'../chembasics-quest/assets_flask/pipette_empty.png',     mask:'../chembasics-quest/assets_flask/pipette_mask_v4.png',       surfaceBase: 0.20,  particleArea:{x:215,y:220,w:50,h:60},   imgW:485,  imgH:530, scale:0.48 },
  { label:'コニカルビーカー', glass:'../chembasics-quest/assets_flask/conical_empty.png',     mask:'../chembasics-quest/assets_flask/conical_mask.png',          surfaceBase: 0.25,  particleArea:{x:150,y:380,w:180,h:40},  imgW:485,  imgH:530, scale:0.48 },
  { label:'枝付きフラスコ',   glass:'../chembasics-quest/assets_flask/sidearm2_crop.png',     mask:'../chembasics-quest/assets_flask/sidearm2_mask.png',         surfaceBase: 0.6,   particleArea:{x:126,y:500,w:100,h:150}, imgW:600,  imgH:760, scale:0.43, dispScale:0.7 },
  { label:'リービッヒ冷却器', glass:'../chembasics-quest/assets_flask/condenser_glass.png',   mask:'../chembasics-quest/assets_flask/condenser_liquidmask_v2.png', surfaceBase:-1.0, particleArea:{x:600,y:180,w:300,h:130}, imgW:1429, imgH:520, scale:0.175, rotation:0 },
];

const RN_LIQUID_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;
uniform float uHeat;
uniform float uSurfaceBase;

vec2 mod289v2(vec2 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec3 mod289v3(vec3 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec3 permute(vec3 x){return mod289v3(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main(void){
  vec2 uv = vTextureCoord;
  float turb = 1.0 + uHeat*3.5;
  float speed = 0.25 + uHeat*1.8;
  float n = snoise(vec2(uv.x*4.0, uv.y*3.2 - uTime*speed) * turb);
  n += 0.5*snoise(vec2(uv.x*8.0+12.3, uv.y*6.0 - uTime*speed*1.7));
  float surface = uSurfaceBase - n*0.03*(1.0+uHeat*2.0);
  if(uv.y < surface){ discard; }
  vec3 cold = vec3(0.10,0.55,0.98);
  vec3 warn = vec3(0.98,0.72,0.14);
  vec3 hot  = vec3(0.98,0.14,0.20);
  vec3 col = mix(cold, warn, clamp(uHeat*2.0,0.0,1.0));
  col = mix(col, hot, clamp(uHeat*2.0-1.0,0.0,1.0));
  float bn = snoise(vec2(uv.x*14.0+uTime*(1.2+uHeat*3.2), uv.y*14.0 - uTime*(0.6+uHeat*2.2)));
  float bubbles = smoothstep(0.72-uHeat*0.25, 0.92, bn);
  float edgeGlow = smoothstep(surface, surface+0.03, uv.y);
  float bright = 0.62 + uHeat*0.5;
  vec3 base = col*bright;
  base += bubbles * hot * (0.3+uHeat*0.45);
  base += edgeGlow * hot * 0.22;
  vec3 outc = clamp(base,0.0,1.0) * 0.92;
  gl_FragColor = vec4(outc, 0.92);
}`;

const RN_SCREEN_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uAberration;
uniform float uWarp;
uniform float uTime;
void main(void){
  vec2 uv = vTextureCoord;
  vec2 center = vec2(0.5, 0.46);
  vec2 d = uv - center;
  float dist = length(d);
  vec2 warped = uv + d * sin(dist*10.0 - uTime*6.0) * uWarp * 0.02;
  float ab = uAberration * (0.004 + dist*0.01);
  float r = texture2D(uSampler, warped + d*ab).r;
  float g = texture2D(uSampler, warped).g;
  float b = texture2D(uSampler, warped - d*ab).b;
  float a = texture2D(uSampler, warped).a;
  gl_FragColor = vec4(r,g,b,a);
}`;

const RN_FLASK_EXTRA_SCALE = 1.05;
const RN_FLASK_CENTER_Y_FRACTION = 0.46;
// 写真＋器具の欄の高さ（元は480px固定）。縦が短い画面では縮め、器具も同じ比率で縮めて見た目の構図を保つ
const RN_TRACK_MAX_H = 480;
// 器具の大きさ：元の480px欄を1倍として、欄の高さ・幅に合わせて拡大縮小（大きい画面でも1.25倍まで）
function rnFlaskFit(w,h){ return Math.min(h/RN_TRACK_MAX_H, w/400, 1.25); }
const RN_TRACK_MIN_H = 260;
const RN_STATEMENT_MIN_H = 250;

class RunnerFlaskEngine {
  constructor(host, trackW, trackH, bgSrc){
    this.trackW = trackW; this.trackH = trackH;
    this.app = new PIXI.Application({ width:trackW, height:trackH, backgroundAlpha:1, backgroundColor:0x05070c, antialias:true, resolution:Math.min(window.devicePixelRatio||1,2), autoDensity:true });
    host.appendChild(this.app.view);
    this.scene = new PIXI.Container();
    this.app.stage.addChild(this.scene);

    // 背景写真をPIXI側でcover描画(CSS background-size:cover; background-position:center 32%相当)
    this.bgSprite = PIXI.Sprite.from(bgSrc);
    this.bgSprite.anchor.set(0);
    this.scene.addChild(this.bgSprite);
    const fitCover = ()=>{
      const tex = this.bgSprite.texture;
      if(!tex.baseTexture.valid) return;
      const texW = tex.baseTexture.realWidth, texH = tex.baseTexture.realHeight;
      const scale = Math.max(trackW/texW, trackH/texH);
      const drawnW = texW*scale, drawnH = texH*scale;
      this.bgSprite.width = drawnW; this.bgSprite.height = drawnH;
      this.bgSprite.x = (trackW - drawnW) * 0.5;
      this.bgSprite.y = (trackH - drawnH) * 0.32;
    };
    if(this.bgSprite.texture.baseTexture.valid) fitCover();
    else this.bgSprite.texture.baseTexture.once('loaded', fitCover);

    this.screenFilter = new PIXI.Filter(undefined, RN_SCREEN_FRAG, { uAberration:0, uWarp:0, uTime:0 });
    this.scene.filters = [this.screenFilter];
    this.scene.filterArea = this.app.renderer.screen;
    this.artContainer = new PIXI.Container();
    this.artContainer.scale.set(RN_FLASK_EXTRA_SCALE);
    this.artContainer.x = trackW/2;
    this.scene.addChild(this.artContainer);
    this.particles = [];
    this.app.ticker.add(()=>this._tick());
  }
  load(instr){
    this.artContainer.removeChildren();
    this.particles.forEach(p=>p.gfx.destroy());
    this.particles = [];
    const { imgW, imgH, scale, glass, mask, surfaceBase, particleArea, rotation } = instr;
    this.artContainer.rotation = (rotation||0) * Math.PI/180;
    this.originX = -(imgW*scale)/2; this.originY = -(imgH*scale)/2;
    this.scaleV = scale; this.particleArea = particleArea;
    // 器具ごとの追加縮小率(未指定なら1倍)
    const dispScale = RN_FLASK_EXTRA_SCALE * (instr.dispScale || 1) * rnFlaskFit(this.trackW, this.trackH);
    this.artContainer.scale.set(dispScale);
    // 器具をトラック中央付近に配置(○×ボタン・問題文パネルは写真の上に重ねて表示するデザインのため)
    this.artContainer.y = this.trackH * RN_FLASK_CENTER_Y_FRACTION;

    this.liqUniA = { uTime:0, uHeat:0, uSurfaceBase:surfaceBase };
    this.liqUniB = { uTime:0, uHeat:0, uSurfaceBase:surfaceBase };
    const liqFilterA = new PIXI.Filter(undefined, RN_LIQUID_FRAG, this.liqUniA);
    const liqFilterB = new PIXI.Filter(undefined, RN_LIQUID_FRAG, this.liqUniB);

    const makeMask = ()=>{
      const spr = new PIXI.Sprite(PIXI.Texture.from(mask));
      spr.x = this.originX; spr.y = this.originY; spr.width = imgW*scale; spr.height = imgH*scale;
      this.artContainer.addChild(spr);
      return spr;
    };
    const liquidMask = makeMask();
    const liquidMaskB = makeMask();

    const liquidSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    liquidSprite.x = this.originX; liquidSprite.y = this.originY;
    liquidSprite.width = imgW*scale; liquidSprite.height = imgH*scale;
    liquidSprite.filters = [liqFilterA];
    const liquidContainer = new PIXI.Container();
    liquidContainer.mask = liquidMask;
    liquidContainer.addChild(liquidSprite);
    this.artContainer.addChild(liquidContainer);

    const blurFilter = new PIXI.BlurFilter(6,4);
    const liquidBloom = new PIXI.Sprite(PIXI.Texture.WHITE);
    liquidBloom.x = this.originX; liquidBloom.y = this.originY;
    liquidBloom.width = imgW*scale; liquidBloom.height = imgH*scale;
    liquidBloom.filters = [liqFilterB, blurFilter];
    liquidBloom.blendMode = PIXI.BLEND_MODES.ADD;
    liquidBloom.alpha = 0.6;
    const liquidBloomContainer = new PIXI.Container();
    liquidBloomContainer.mask = liquidMaskB;
    liquidBloomContainer.addChild(liquidBloom);
    this.artContainer.addChild(liquidBloomContainer);

    const flaskSprite = new PIXI.Sprite(PIXI.Texture.from(glass));
    flaskSprite.x = this.originX; flaskSprite.y = this.originY;
    flaskSprite.width = imgW*scale; flaskSprite.height = imgH*scale;
    flaskSprite.blendMode = PIXI.BLEND_MODES.SCREEN;
    this.artContainer.addChild(flaskSprite);
    this.flaskSprite = flaskSprite;

    this.particleLayer = new PIXI.Container();
    this.artContainer.addChild(this.particleLayer);

    this.screenFilter.uniforms.uAberration = 0;
    this.screenFilter.uniforms.uWarp = 0;
    this.scene.x = 0; this.scene.y = 0;
  }
  setHeat(h){ if(this.liqUniA){ this.liqUniA.uHeat = h; this.liqUniB.uHeat = h; } }
  setPanic(p){
    this.screenFilter.uniforms.uAberration = p;
    this.screenFilter.uniforms.uWarp = p;
    this.scene.x = p>0 ? (Math.random()-0.5)*p*5 : 0;
    this.scene.y = p>0 ? (Math.random()-0.5)*p*5 : 0;
    if(p>0 && Math.random()<0.5) this._spawnParticle();
  }
  _spawnParticle(){
    if(!this.particleArea) return;
    const g = new PIXI.Graphics();
    const r = 1.2+Math.random()*1.8;
    g.beginFill(0xffcf7a,1); g.drawCircle(0,0,r); g.endFill();
    g.blendMode = PIXI.BLEND_MODES.ADD;
    const angle = Math.random()*Math.PI*2, speed = 0.7+Math.random()*2.2;
    g.x = this.originX + (this.particleArea.x + Math.random()*this.particleArea.w)*this.scaleV;
    g.y = this.originY + (this.particleArea.y + Math.random()*this.particleArea.h)*this.scaleV;
    this.particleLayer.addChild(g);
    this.particles.push({ gfx:g, vx:Math.cos(angle)*speed*0.6, vy:-Math.abs(Math.sin(angle))*speed-1.0, life:0, maxLife:30+Math.random()*20 });
  }
  _tick(){
    const t = this.app.ticker.lastTime/1000;
    if(this.liqUniA){ this.liqUniA.uTime = t; this.liqUniB.uTime = t; }
    this.screenFilter.uniforms.uTime = t;
    for(let i=this.particles.length-1;i>=0;i--){
      const p = this.particles[i];
      p.life++; p.vy += 0.05; p.gfx.x += p.vx; p.gfx.y += p.vy;
      p.gfx.alpha = Math.max(0, 1-p.life/p.maxLife);
      if(p.life>=p.maxLife){ this.particleLayer.removeChild(p.gfx); p.gfx.destroy(); this.particles.splice(i,1); }
    }
  }
}
function pickRunnerFlask(engine){
  engine.lastInstr = RUNNER_INSTRUMENTS[Math.floor(Math.random()*RUNNER_INSTRUMENTS.length)];
  engine.load(engine.lastInstr);
}
// 写真＋器具の欄の大きさを決めてエンジンを作る（2026-10-29）
//  携帯・縦長：問題文欄に最低 RN_STATEMENT_MIN_H を残し、残りの高さで欄を決める（最大480px、縦長タブレットは620pxまで）
//  横長のPC・タブレット：左に器具、右に問題文の2列（CSSの .rn-card が横並び）。欄は画面の高さいっぱい
function rnBuildFlaskEngine(){
  const st=runnerState; if(!st) return;
  const trackEl=document.querySelector('.rn-track'); if(!trackEl) return;
  const cardEl=trackEl.parentElement;
  const host=document.getElementById('rnFlaskHost');
  host.style.display='none';   // 今の描画面の大きさに引っぱられずに測るため、測る間だけ隠す
  const side=getComputedStyle(cardEl).flexDirection==='row';
  let h;
  if(side){
    trackEl.style.height='';
    h=Math.round(cardEl.clientHeight)||RN_TRACK_MAX_H;
  }else{
    const maxH = window.innerWidth>=700 ? 620 : RN_TRACK_MAX_H;
    const availH=cardEl.clientHeight;
    // 対戦では上にレーン表示がある分、写真＋器具の欄をさらに縮めてよい
    const minH = st.battle ? RB.TRACK_MIN_H : RN_TRACK_MIN_H;
    const stmtH = st.battle ? RB.STATEMENT_MIN_H : RN_STATEMENT_MIN_H;
    h = availH>0 ? Math.round(Math.max(minH, Math.min(maxH, availH - stmtH))) : RN_TRACK_MAX_H;
    trackEl.style.height=h+'px';
  }
  const w=Math.round(trackEl.clientWidth)||420;
  host.style.display='';
  trackEl.classList.toggle('rn-compact', h<400);
  const old=st.flaskEngine;
  if(old){
    if(old.trackW===w && old.trackH===h) return;
    try{ old.app.destroy(true,{children:true}); }catch(e){}
    host.innerHTML='';
  }
  st.flaskEngine = new RunnerFlaskEngine(host, w, h, '../chembasics-quest/assets_flask/bg_lab.webp');
  if(old && old.lastInstr){ st.flaskEngine.lastInstr=old.lastInstr; st.flaskEngine.load(old.lastInstr); }
}
let rnResizeTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(rnResizeTimer);
  rnResizeTimer=setTimeout(()=>{ if(runnerState && runnerState.el) rnBuildFlaskEngine(); },200);
});
const RUNNER_DIFFS={
  easy:{label:'Easy',lives:5,sub:'ミス許容5回'},
  normal:{label:'Normal',lives:2,sub:'ミス許容2回'},
  hard:{label:'Hard',lives:1,sub:'ノーミス'}
};
const RUNNER_QUESTION_TIME_MS=10000;
const RUNNER_STATS_KEY='theoryRushStats_v1';
const RUNNER_CAT_KEY='theoryRushCat1';
let selectedRunnerGenre='all';
let runnerState=null;
let lastRunnerRun=null;

function loadRunnerStats(){
  try{ const raw=localStorage.getItem(RUNNER_STATS_KEY); return raw?JSON.parse(raw):{}; }catch(e){ return {}; }
}
function recordRunnerAnswer(qid,isCorrect){
  const stats=loadRunnerStats();
  if(!stats[qid]) stats[qid]={shown:0,correct:0};
  stats[qid].shown++;
  if(isCorrect) stats[qid].correct++;
  try{ localStorage.setItem(RUNNER_STATS_KEY,JSON.stringify(stats)); }catch(e){}
}
function loadRunnerCatStats(){
  try{ const raw=localStorage.getItem(RUNNER_CAT_KEY); return raw?JSON.parse(raw):{catStats:{}}; }catch(e){ return {catStats:{}}; }
}
function recordRunnerGenreAnswer(genre,isCorrect){
  const data=loadRunnerCatStats();
  if(!data.catStats[genre]) data.catStats[genre]={correct:0,total:0};
  data.catStats[genre].total++;
  if(isCorrect) data.catStats[genre].correct++;
  try{ localStorage.setItem(RUNNER_CAT_KEY,JSON.stringify(data)); }catch(e){}
  LB.pushState(RUNNER_CAT_KEY,data);
}
function runnerRank(correct){
  return correct>=50?'SS':correct>=30?'S':correct>=20?'A':correct>=10?'B':correct>=3?'C':'D';
}
function shuffleRunner(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function buildRunnerPool(genre){
  const scope=runnerScopeOf(genre);
  let base = RUNNER_QUESTIONS.filter(q=>scope.match(q.genre));
  if(base.length<5) base=RUNNER_QUESTIONS;
  return shuffleRunner(base);
}

function renderRunnerHome(){
  if(typeof RB!=='undefined'&&RB.active()){ RB.render(); return; }  // 対戦ルームに入っている間はルーム画面のまま
  runnerState=null;
  const curScope=runnerScopeOf(selectedRunnerGenre);
  const genreOptions=RUNNER_SCOPES.map(s=>
    `<option value="${s.value}" ${selectedRunnerGenre===s.value?'selected':''}>${s.label}</option>`
  ).join('');
  const diffRows=Object.keys(RUNNER_DIFFS).map(k=>{
    const d=RUNNER_DIFFS[k];
    let note='';
    if(k==='hard') note = '🏆 全国ランキング対応';
    return `<button class="eg-levelbtn" data-diff="${k}">
      <span><span class="eg-lv-name">${d.label}</span><span class="eg-lv-sub">${d.sub}</span></span>
      <span class="eg-lv-best">${note}</span>
    </button>`;
  }).join('');
  const selfBestList=(state.bestList&&state.bestList[curScope.kind])||[];
  runnerPanel.innerHTML=`
    <h2>🏃 化学RUSH！</h2>
    <div class="card-ui">
      <div class="muted">正誤(○×)問題に連続で答えるタイムアタック。1問<b>10秒</b>、間違えるとライフが減るよ。分野を選んで、難易度ボタンを押すとすぐスタート!</div>
      <select class="genreSelect" id="runnerGenreSelect" style="margin-top:12px">${genreOptions}</select>
      <div class="eg-levelgrid" style="margin-top:14px">${diffRows}</div>
    </div>
    <div class="card-ui" id="lbBox"></div>
    ${selfBestList.length?`<div class="card-ui"><b>🏆 自己ベストTOP3</b>${LB.renderSelfBestHTML(selfBestList,curScope.kind)}</div>`:''}
    <button class="bigbtn secondary" id="runnerListBtn">📋 問題と答えの一覧</button>`;
  document.getElementById('runnerListBtn').onclick=()=>renderRunnerList();
  document.getElementById('runnerGenreSelect').addEventListener('change',e=>{ selectedRunnerGenre=e.target.value; renderRunnerHome(); });
  runnerPanel.querySelectorAll('.eg-levelbtn').forEach(b=>{
    b.addEventListener('click',()=>startRunner(b.dataset.diff));
  });
  refreshRunnerLbBox(curScope.kind);
}

/* 化学RUSH！の問題と答えの一覧（分野で絞り込み・言葉で検索） */
let runnerListGenre='', runnerListQuery='';
function renderRunnerList(){
  runnerState=null;
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const opts=['<option value="">すべての分野</option>'].concat(RUNNER_GENRES.map(g=>`<option value="${esc(g)}" ${g===runnerListGenre?'selected':''}>${esc(g)}</option>`)).join('');
  runnerPanel.innerHTML=`
    <button class="backbtn" id="rlBack">← 化学RUSH！に戻る</button>
    <h2>📋 問題と答えの一覧</h2>
    <div class="card-ui">
      <select class="genreSelect" id="rlGenre">${opts}</select>
      <input class="rl-search" id="rlQuery" type="search" placeholder="言葉で検索（例：酸化数、コロイド）" value="${esc(runnerListQuery)}">
      <div class="muted" id="rlCount" style="margin-top:6px"></div>
    </div>
    <div id="rlList"></div>`;
  const draw=()=>{
    const qs=RUNNER_QUESTIONS.filter(q=>(!runnerListGenre||q.genre===runnerListGenre)&&(!runnerListQuery||(q.statement+q.explanation).includes(runnerListQuery)))
      .sort((a,b)=>RUNNER_GENRES.indexOf(a.genre)-RUNNER_GENRES.indexOf(b.genre)||a.id.localeCompare(b.id));
    document.getElementById('rlCount').textContent=`${qs.length}問`;
    let html='', last='';
    for(const q of qs){
      const head=q.genre;
      if(head!==last){html+=`<div class="rl-head">${esc(head)}</div>`;last=head;}
      html+=`<div class="rl-item"><span class="rl-ans ${q.answer?'t':'f'}">${q.answer?'○':'×'}</span><div><div class="rl-st">${esc(q.statement)}</div><div class="rl-ex">${esc(q.explanation||'')}</div></div></div>`;
    }
    document.getElementById('rlList').innerHTML=html||'<div class="card-ui muted">該当する問題はありません</div>';
  };
  document.getElementById('rlBack').onclick=()=>renderRunnerHome();
  document.getElementById('rlGenre').onchange=e=>{runnerListGenre=e.target.value;draw();};
  document.getElementById('rlQuery').oninput=e=>{runnerListQuery=e.target.value.trim();draw();};
  draw();
  runnerPanel.parentElement.scrollTop=0;
}

// battle: みんなで対戦（rush_battle.js）から呼ぶときの {pool,genre,pos,idx}。配られた問題を同じ順番で出す
function startRunner(diffKey,battle){
  const def=RUNNER_DIFFS[diffKey]||RUNNER_DIFFS.easy;
  runnerState={
    pool:battle?battle.pool:buildRunnerPool(selectedRunnerGenre), idx:battle?(battle.idx||0):0,
    lives:def.lives, maxLives:def.lives,
    diff:diffKey, genre:battle?battle.genre:selectedRunnerGenre,
    battle:battle?{pos:battle.pos||0}:null,
    streak:0, bestStreak:0, correct:0, total:0,
    answered:false, timerInterval:null, autoAdvanceTimeout:null, timeLeft:0,
    history:[], startTime:Date.now(), locked:false, el:null
  };
  renderRunnerPlayShell();
  runnerNextQuestion();
}

function renderRunnerPlayShell(){
  runnerPanel.innerHTML=`${runnerState.battle?RB.laneHTML():''}
    <div class="card-ui rn-card">
      <div class="rn-track">
        <div class="rn-flask-host" id="rnFlaskHost"></div>
        <div class="rn-header-row">
          <span class="rn-genretag" id="rnGenreTag">-</span>
          <span class="life-hearts" id="rnHearts"></span>
        </div>
        <div class="rn-timer-bar"><div class="rn-timer-fill" id="rnTimerFill"></div></div>
        <span id="rnTimerNum" style="display:none">10</span>
        <button class="rn-ans-btn true-btn" id="rnBtnTrue">○</button>
        <button class="rn-ans-btn false-btn" id="rnBtnFalse">×</button>
      </div>
      <div class="rn-statement-panel">
        <div class="rn-statement" id="rnStatement"></div>
        <div class="rn-feedback" id="rnFeedback"></div>
      </div>
    </div>`;
  rnBuildFlaskEngine();
  runnerState.el={
    timerFill:document.getElementById('rnTimerFill'), timerNum:document.getElementById('rnTimerNum'),
    hearts:document.getElementById('rnHearts'), genreTag:document.getElementById('rnGenreTag'),
    statement:document.getElementById('rnStatement'), feedback:document.getElementById('rnFeedback'),
    btnTrue:document.getElementById('rnBtnTrue'), btnFalse:document.getElementById('rnBtnFalse')
  };
  runnerState.el.btnTrue.addEventListener('click',()=>runnerAnswer(true));
  runnerState.el.btnFalse.addEventListener('click',()=>runnerAnswer(false));
  runnerRenderHUD();
}

function stopRunner(){
  clearRunnerTimer();
  runnerState=null;
}

function clearRunnerTimer(){
  if(!runnerState) return;
  if(runnerState.timerInterval){ clearInterval(runnerState.timerInterval); runnerState.timerInterval=null; }
  if(runnerState.autoAdvanceTimeout){ clearTimeout(runnerState.autoAdvanceTimeout); runnerState.autoAdvanceTimeout=null; }
}

function runnerHeartsHTML(){
  let s='';
  for(let i=0;i<runnerState.maxLives;i++) s+= i<runnerState.lives ? '❤️' : '🖤';
  return s;
}

function runnerRenderHUD(){
  const st=runnerState;
  st.el.hearts.innerHTML=st.battle?RB.hudHTML():runnerHeartsHTML();
}

function runnerUpdateTimerVisual(ratio){
  const st=runnerState;
  st.el.timerFill.style.width=(ratio*100)+'%';
  st.el.timerFill.style.background = ratio>.5?'#06d6a0':ratio>.2?'#ffd166':'#ef476f';
  st.el.timerNum.textContent=Math.max(0,Math.ceil(st.timeLeft/1000));
  const remain = st.timeLeft/1000;
  const heat = remain<=7 ? Math.min(1,(7-remain)/7) : 0;
  st.flaskEngine.setHeat(heat);
  st.flaskEngine.setPanic(0);
}

function startRunnerTimer(){
  clearRunnerTimer();
  const st=runnerState;
  st.timeLeft=RUNNER_QUESTION_TIME_MS;
  runnerUpdateTimerVisual(1);
  const tickMs=100;
  st.timerInterval=setInterval(()=>{
    st.timeLeft-=tickMs;
    const ratio=Math.max(0,st.timeLeft/RUNNER_QUESTION_TIME_MS);
    runnerUpdateTimerVisual(ratio);
    if(st.timeLeft<=0){
      clearInterval(st.timerInterval); st.timerInterval=null;
      if(!st.answered) runnerAnswer(null);
    }
  },tickMs);
}

function runnerGoNext(){
  clearRunnerTimer();
  runnerState.idx++;
  runnerNextQuestion();
}

function runnerNextQuestion(){
  const st=runnerState;
  st.answered=false;
  st.el.feedback.style.display='none';
  st.el.feedback.className='rn-feedback';
  st.el.btnTrue.disabled=false;
  st.el.btnFalse.disabled=false;
  if(st.idx>=st.pool.length){ if(!st.battle) st.pool=shuffleRunner(st.pool); st.idx=0; }
  const q=st.pool[st.idx];
  st.el.genreTag.textContent=q.genre;
  st.el.statement.innerHTML=(q.svg||'')+q.statement;
  st.el.statement.parentElement.scrollTop=0;
  pickRunnerFlask(st.flaskEngine);
  startRunnerTimer();
}

function runnerCurrentQ(){ return runnerState.pool[runnerState.idx]; }

function runnerAnswer(userAnswer){
  const st=runnerState;
  if(!st||st.answered) return;
  clearRunnerTimer();
  st.answered=true;
  const q=runnerCurrentQ();
  const isTimeout = userAnswer===null;
  const correct = !isTimeout && (userAnswer===q.answer);
  st.total++;
  // 対戦の4分野（芳香族など）の問題は化学基礎の成績・苦手分析に入れない
  if(!q.field){
    recordRunnerAnswer(q.id,correct);
    recordRunnerGenreAnswer(q.genre,correct);
    if(typeof LB!=='undefined') LB.recordQuizResults('theoryrush',[{id:q.id,ok:correct}]);
  }
  st.history.push({qid:q.id,genre:q.genre,statement:q.statement,explanation:q.explanation,correct,userAnswer,answer:q.answer});
  st.el.btnTrue.disabled=true;
  st.el.btnFalse.disabled=true;
  const fb=st.el.feedback;
  fb.style.display='block';
  if(correct){
    st.correct++; st.streak++; st.bestStreak=Math.max(st.bestStreak,st.streak);
    fb.className='rn-feedback correct';
    fb.innerHTML='⭕ 正解!';  // タイムを競うので、正解のときは解説を出さない（2026-10-30 先生）
  }else{
    st.streak=0; st.lives--;
    fb.className='rn-feedback wrong';
    fb.innerHTML = isTimeout
      ? `⏰ 時間切れ! 正解は「${q.answer?'正しい(○)':'誤り(×)'}」。 ${q.explanation}`
      : `❌ 残念、正解は「${q.answer?'正しい(○)':'誤り(×)'}」。 ${q.explanation}`;
  }
  // 問題文欄がスクロールする長さのときは、解説が見えるところまで自動で送る
  const rnSp=fb.parentElement;
  if(rnSp && rnSp.scrollHeight>rnSp.clientHeight){
    rnSp.scrollTo({top:Math.max(0,rnSp.scrollTop+fb.getBoundingClientRect().top-rnSp.getBoundingClientRect().top-8),behavior:'smooth'});
  }
  if(st.battle){ RB.onAnswer(correct); return; }  // 対戦：位置を進めて次へ（ライフは使わない）
  runnerRenderHUD();
  if(st.lives<=0){
    setTimeout(finishRunner,1200);
  }else{
    st.autoAdvanceTimeout=setTimeout(runnerGoNext,1500);
  }
}

function finishRunner(){
  const st=runnerState;
  if(!st) return;
  clearRunnerTimer();
  const rate = st.total ? Math.round(st.correct/st.total*100) : 0;
  const sec = Math.floor((Date.now()-st.startTime)/1000);
  const scope = runnerScopeOf(st.genre);
  const kind = scope.kind;
  const eligible = st.diff==='hard';
  const rank = eligible ? runnerRank(st.correct) : null;
  if(eligible){
    if(!state.bestList) state.bestList={};
    if(!state.bestList[kind]) state.bestList[kind]=[];
    const list=state.bestList[kind];
    list.push({correct:st.correct,sec,rank});
    list.sort((a,b)=>(b.correct-a.correct)||(a.sec-b.sec));
    state.bestList[kind]=list.slice(0,3);
    save();
  }
  lastRunnerRun={history:st.history,correct:st.correct,total:st.total,rate,diff:st.diff,genre:st.genre,kind,rank,bestStreak:st.bestStreak};
  const lbSubmit=(eligible&&LB.currentUser())?LB.submitScore(kind,st.correct,sec,rank):Promise.resolve();
  runnerState=null;
  renderRunnerResult();
  if(eligible){ refreshRunnerLbBox(kind); lbSubmit.then(()=>refreshRunnerLbBox(kind)); }
}

function refreshRunnerLbBox(kind){
  const box=document.getElementById('lbBox');
  if(!box) return;
  if(LB.currentUser()){
    box.innerHTML=`<b>🌏 全国ランキング TOP10</b><div class="lb-loading">読み込み中...</div>`;
    LB.fetchTop(kind,10).then(list=>{
      const b=document.getElementById('lbBox');
      if(b) b.innerHTML=`<b>🌏 全国ランキング TOP10</b>`+LB.renderBoardHTML(list,LB.currentUser().uid,kind);
    });
  }else{
    box.innerHTML=`<b>🌏 全国ランキング</b><div class="lb-cta">ログインすると、他の人と全国ランキングで競えます。</div><button class="bigbtn secondary" id="lbRegisterBtnRunner" style="width:100%">ログインする</button>`;
    document.getElementById('lbRegisterBtnRunner').onclick=()=>LB.openAccountModal();
  }
}

function renderRunnerResult(){
  const r=lastRunnerRun;
  const rankHtml = r.rank ? `<div class="rankbig rank-${r.rank}">${r.rank}</div>` : '';
  const selfBestList=(state.bestList&&state.bestList[r.kind])||[];
  runnerPanel.innerHTML=`
    <h2>結果発表</h2>
    <div class="card-ui" style="text-align:center">
      ${rankHtml}
      <div class="score-line">${r.correct}問正解</div>
      <button class="bigbtn" id="rnRetry">もう一度</button>
      <button class="bigbtn secondary" id="rnReview">📋 今回の問題を振り返る</button>
      <button class="bigbtn secondary" id="rnBack">モード選択に戻る</button>
    </div>
    ${r.rank?`<div class="card-ui" id="lbBox"></div>${selfBestList.length?`<div class="card-ui"><b>🏆 自己ベストTOP3</b>${LB.renderSelfBestHTML(selfBestList,r.kind)}</div>`:''}`:''}`;
  document.getElementById('rnRetry').addEventListener('click',()=>startRunner(r.diff));
  document.getElementById('rnReview').addEventListener('click',renderRunnerReview);
  document.getElementById('rnBack').addEventListener('click',renderRunnerHome);
}

function renderRunnerReview(){
  const r=lastRunnerRun;
  const history=(r&&r.history)||[];
  let listHtml;
  if(history.length===0){
    listHtml='<div class="muted" style="text-align:center;padding:20px 0">振り返る問題がありません。</div>';
  }else{
    const wrong=history.filter(h=>!h.correct);
    const rest=history.filter(h=>h.correct);
    listHtml=wrong.concat(rest).map(h=>`
      <div class="rn-review-item ${h.correct?'':'is-wrong'}">
        <div class="rv-head"><span>${h.genre}</span><span class="rv-mark ${h.correct?'correct':'wrong'}">${h.correct?'○ 正解':'× 不正解'}</span></div>
        <div class="rv-statement">${h.statement}</div>
        ${h.answer===undefined?'':`<div class="rv-ans">あなたの答え：<b>${h.userAnswer===null?'時間切れ':h.userAnswer?'○':'×'}</b>　／　正解：<b>${h.answer?'○':'×'}</b></div>`}
        <div class="rv-explanation">${h.explanation}</div>
      </div>`).join('');
  }
  runnerPanel.innerHTML=`
    <h2>📋 今回の振り返り</h2>
    <div id="rnReviewList">${listHtml}</div>
    <button class="bigbtn secondary" id="rnReviewBack">戻る</button>`;
  document.getElementById('rnReviewBack').addEventListener('click',renderRunnerResult);
}

