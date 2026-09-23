export const LAYOUTS=[
  {id:'simple',name:'Simple',description:'Flat, quiet and dense. Minimal decoration, direct lists and progress.'},
  {id:'orbit',name:'Orbit',description:'SAMT signature layout. Bearings, rings, arcs and cyclic progress.'},
  {id:'command',name:'Command',description:'Dense operational dashboard with modules, metrics and compact controls.'},
  {id:'journal',name:'Journal',description:'Calm chronological pages that read like a personal daily record.'},
  {id:'matrix',name:'Matrix',description:'Spatial tile workspace. Priorities, progress and live work arranged as a grid.'}
];

export const TYPOGRAPHIES=[
  {id:'clean',name:'Clean',description:'Neutral modern sans-serif.'},
  {id:'technical',name:'Technical',description:'Compact instrument-style labels and numbers.'},
  {id:'editorial',name:'Editorial',description:'Book-like display headings with calm body copy.'},
  {id:'minimal',name:'Minimal',description:'Smaller type and restrained hierarchy.'},
  {id:'display',name:'Display',description:'Strong geometric headings with generous scale.'}
];

export const PALETTES={
  samt:{name:'SAMT',description:'Deep teal, mineral blue and restrained gold.',primary:'#147d86',secondary:'#385970',accent:'#c39a52',neutral:'#65758a',success:'#2f8f6a',warning:'#c8872f',danger:'#c45360'},
  ocean:{name:'Ocean',description:'Cold blue water with clear cyan highlights.',primary:'#1976a3',secondary:'#315b7a',accent:'#43c6d9',neutral:'#64788b',success:'#2f9478',warning:'#c99438',danger:'#c75666'},
  forest:{name:'Forest',description:'Evergreen, moss and warm bark.',primary:'#39745b',secondary:'#566b4f',accent:'#b79b52',neutral:'#6c756d',success:'#3d8b62',warning:'#bd8837',danger:'#b9575c'},
  ember:{name:'Ember',description:'Burnt orange, copper and smoke.',primary:'#b45d37',secondary:'#7c4f45',accent:'#e0a64d',neutral:'#786b69',success:'#4f8b6b',warning:'#d58b2f',danger:'#c34e4f'},
  royal:{name:'Royal',description:'Indigo, violet and pale gold.',primary:'#5b56a7',secondary:'#704d87',accent:'#d3ad58',neutral:'#706d82',success:'#4f8f72',warning:'#c7923d',danger:'#c15368'},
  sand:{name:'Sand',description:'Stone, parchment and oxidised teal.',primary:'#8a6b45',secondary:'#6f776c',accent:'#2d8d8c',neutral:'#7e776d',success:'#4d8361',warning:'#b98136',danger:'#b65757'},
  mono:{name:'Mono',description:'Graphite and silver with one restrained focus tone.',primary:'#596475',secondary:'#727b88',accent:'#8a9db0',neutral:'#737983',success:'#4f806e',warning:'#a7844b',danger:'#a85760'},
  rose:{name:'Rose',description:'Muted berry, plum and cool blush.',primary:'#a94e75',secondary:'#74556f',accent:'#d78aaa',neutral:'#756c78',success:'#4d896f',warning:'#bd873f',danger:'#c14861'},
  arctic:{name:'Arctic',description:'Icy cyan, slate and polar blue.',primary:'#268ba5',secondary:'#526b85',accent:'#86d7e6',neutral:'#687788',success:'#378b73',warning:'#bd8b42',danger:'#bd5366'},
  copper:{name:'Copper',description:'Copper, charcoal and aged brass.',primary:'#a26343',secondary:'#6e625c',accent:'#c49a55',neutral:'#756e6a',success:'#4f8065',warning:'#c08032',danger:'#b94f52'},
  midnight:{name:'Midnight Neon',description:'Electric cyan and violet for dark neon appearance.',primary:'#00d8e8',secondary:'#7464ff',accent:'#f04dff',neutral:'#66738d',success:'#4cf2a1',warning:'#ffd35c',danger:'#ff5f7e'},
  solar:{name:'Solar',description:'Sun yellow, hot orange and cool counter-accent.',primary:'#e2a51c',secondary:'#c66934',accent:'#39a9ad',neutral:'#746f64',success:'#4c8b62',warning:'#d88616',danger:'#c94f4f'}
};

export const FULL_PRESETS={
  celestial:{name:'Celestial',layout:'orbit',appearance:'dark',typography:'editorial',paletteId:'samt'},
  terminal:{name:'Terminal',layout:'command',appearance:'dark',typography:'technical',paletteId:'forest'},
  paper:{name:'Paper',layout:'journal',appearance:'light',typography:'editorial',paletteId:'sand'},
  pulse:{name:'Pulse',layout:'matrix',appearance:'neon',typography:'technical',paletteId:'midnight'},
  bare:{name:'Bare',layout:'simple',appearance:'light',typography:'minimal',paletteId:'mono'}
};

export const VISUAL_DEFAULTS={
  layout:'orbit',
  typography:'clean',
  paletteId:'samt',
  palette:{...PALETTES.samt},
  savedPalettes:[],
  density:'comfortable',
  motion:'subtle',
  glow:'low'
};

const clamp=n=>Math.max(0,Math.min(255,Math.round(n)));
const parseHex=hex=>{
  const clean=String(hex||'').replace('#','');
  if(!/^[0-9a-f]{6}$/i.test(clean))return [20,125,134];
  return [parseInt(clean.slice(0,2),16),parseInt(clean.slice(2,4),16),parseInt(clean.slice(4,6),16)];
};
const hex=rgb=>'#'+rgb.map(v=>clamp(v).toString(16).padStart(2,'0')).join('');
const mix=(a,b,t)=>{
  const x=parseHex(a),y=parseHex(b);
  return hex(x.map((v,i)=>v+(y[i]-v)*Math.max(0,Math.min(1,t))));
};
const channel=v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);};
export const luminance=color=>{
  const [r,g,b]=parseHex(color);return .2126*channel(r)+.7152*channel(g)+.0722*channel(b);
};
export const contrast=(a,b)=>{
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};
export const readableText=(background,preferredLight='#f8fbff',preferredDark='#101827')=>{
  const light=contrast(background,preferredLight),dark=contrast(background,preferredDark);
  return light>=dark?preferredLight:preferredDark;
};
const ensureContrast=(foreground,background,min=4.5)=>{
  if(contrast(foreground,background)>=min)return foreground;
  return readableText(background);
};

export function visualSettings(settings={}){
  const visual={...VISUAL_DEFAULTS,...(settings.visual||{})};
  const builtIn=PALETTES[visual.paletteId];
  const saved=(visual.savedPalettes||[]).find(p=>p.id===visual.paletteId);
  visual.palette={...(builtIn||saved||visual.palette||PALETTES.samt)};
  visual.savedPalettes=Array.isArray(visual.savedPalettes)?visual.savedPalettes:[];
  return visual;
}

export function resolvedAppearance(settings={},prefersDark=false){
  const value=settings.appearance||'system';
  return value==='system'?(prefersDark?'dark':'light'):value;
}

function appearanceTokens(palette,appearance){
  const p=palette;
  if(appearance==='light'){
    const bg=mix(p.neutral||'#65758a','#ffffff',.93),panel=mix(p.neutral||'#65758a','#ffffff',.975),panel2=mix(p.primary,'#ffffff',.91);
    const ink=ensureContrast('#17223a',bg,7),muted=ensureContrast(mix(p.neutral,'#17223a',.30),panel,4.5);
    const hero=mix(p.primary,'#0b1830',.63),hero2=mix(p.secondary,'#102743',.56);
    return {bg,panel,panel2,ink,muted,line:mix(p.neutral,'#ffffff',.77),nav:panel,hero,hero2,heroInk:readableText(hero),
      accent:p.primary,accent2:p.secondary,focus:p.accent,good:p.success,warn:p.warning,bad:p.danger,shadow:'0 14px 36px rgba(24,39,62,.07)',glow:'none'};
  }
  if(appearance==='neon'){
    const bg=mix(p.neutral||'#65758a','#02050b',.93),panel=mix(p.secondary||p.primary,'#07101b',.87),panel2=mix(p.primary,'#07101b',.80);
    const ink=ensureContrast('#f7fbff',bg,7),muted=ensureContrast(mix(p.accent,'#a8b3c8',.72),panel,4.5);
    const hero=mix(p.primary,'#06101d',.72),hero2=mix(p.secondary,'#050913',.67);
    return {bg,panel,panel2,ink,muted,line:mix(p.primary,'#0b1422',.58),nav:mix(panel,'#000000',.14),hero,hero2,heroInk:readableText(hero),
      accent:p.primary,accent2:p.secondary,focus:p.accent,good:p.success,warn:p.warning,bad:p.danger,shadow:'0 14px 40px rgba(0,0,0,.30)',glow:`0 0 24px ${mix(p.primary,'#000000',.22)}55`};
  }
  const bg=mix(p.neutral||'#65758a','#060b14',.91),panel=mix(p.secondary||p.neutral,'#0b1220',.82),panel2=mix(p.primary,'#0c1626',.84);
  const ink=ensureContrast('#f4f7fc',bg,7),muted=ensureContrast(mix(p.neutral,'#dbe5f2',.55),panel,4.5);
  const hero=mix(p.primary,'#111b31',.70),hero2=mix(p.secondary,'#101b31',.62);
  return {bg,panel,panel2,ink,muted,line:mix(p.neutral,'#0b1320',.55),nav:panel,hero,hero2,heroInk:readableText(hero),
    accent:p.primary,accent2:p.secondary,focus:p.accent,good:p.success,warn:p.warning,bad:p.danger,shadow:'0 16px 40px rgba(0,0,0,.18)',glow:'none'};
}

function typeTokens(p){
  const slots=[p.primary,p.secondary,p.accent,p.success,p.warning,p.danger,mix(p.primary,p.secondary,.5)];
  return {
    collection:slots[1],action_list:slots[0],routine:slots[3],workflow:slots[2],project:slots[4],cycle:slots[6],target:slots[5]
  };
}

function fonts(id){
  if(id==='technical')return {body:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',display:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',tracking:'.01em'};
  if(id==='editorial')return {body:'Inter, ui-sans-serif, system-ui, sans-serif',display:'Georgia, Cambria, "Times New Roman", serif',tracking:'-.02em'};
  if(id==='minimal')return {body:'Inter, ui-sans-serif, system-ui, sans-serif',display:'Inter, ui-sans-serif, system-ui, sans-serif',tracking:'-.015em'};
  if(id==='display')return {body:'Inter, ui-sans-serif, system-ui, sans-serif',display:'"Trebuchet MS", Inter, ui-sans-serif, system-ui, sans-serif',tracking:'-.04em'};
  return {body:'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',display:'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',tracking:'-.035em'};
}

export function applyVisual(root,settings={},prefersDark=false){
  const visual=visualSettings(settings),appearance=resolvedAppearance(settings,prefersDark),tokens=appearanceTokens(visual.palette,appearance),types=typeTokens(visual.palette),font=fonts(visual.typography);
  root.dataset.theme=appearance;root.dataset.layout=visual.layout;root.dataset.type=visual.typography;root.dataset.density=visual.density||'comfortable';root.dataset.motion=visual.motion||'subtle';
  const vars={
    '--bg':tokens.bg,'--panel':tokens.panel,'--panel2':tokens.panel2,'--ink':tokens.ink,'--muted':tokens.muted,'--line':tokens.line,'--nav':tokens.nav,
    '--hero':tokens.hero,'--hero2':tokens.hero2,'--hero-ink':tokens.heroInk,'--accent':tokens.accent,'--accent-ink':readableText(tokens.accent),'--accent2':tokens.accent2,'--focus':tokens.focus,
    '--good':tokens.good,'--warn':tokens.warn,'--bad':tokens.bad,'--shadow':tokens.shadow,'--neon-glow':tokens.glow,'--font-body':font.body,'--font-display':font.display,'--display-tracking':font.tracking
  };
  for(const [key,value] of Object.entries(types))vars[`--type-${key.replace('_','-')}`]=value;
  for(const [key,value] of Object.entries(vars))root.style.setProperty(key,value);
  return {visual,appearance,tokens};
}

export function presetFromSettings(settings={},categoryColors={}){
  const visual=visualSettings(settings);
  return {
    format:'samt-style-preset',version:1,name:visual.presetName||'My SAMT style',
    layout:visual.layout,appearance:settings.appearance||'system',typography:visual.typography,
    paletteId:visual.paletteId,palette:{...visual.palette},categoryColors:{...categoryColors},
    effects:{density:visual.density||'comfortable',motion:visual.motion||'subtle',glow:visual.glow||'low'}
  };
}

export function parseStylePreset(text){
  const data=typeof text==='string'?JSON.parse(text):structuredClone(text);
  if(data?.format!=='samt-style-preset'||data.version!==1)throw new Error('Unsupported SAMT style preset.');
  if(!LAYOUTS.some(x=>x.id===data.layout))throw new Error('Unknown layout in style preset.');
  if(!TYPOGRAPHIES.some(x=>x.id===data.typography))throw new Error('Unknown typography in style preset.');
  if(!['system','light','dark','neon'].includes(data.appearance))throw new Error('Unknown appearance in style preset.');
  for(const key of ['primary','secondary','accent','neutral','success','warning','danger'])if(!/^#[0-9a-f]{6}$/i.test(data.palette?.[key]||''))throw new Error(`Invalid ${key} colour in style preset.`);
  return data;
}
