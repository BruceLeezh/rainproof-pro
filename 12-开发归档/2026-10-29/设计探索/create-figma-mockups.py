from pathlib import Path
import json

base = Path(__file__).resolve().parent
site = Path(r'C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof\05-演示站点\design-preview')
tokens = json.loads((site / 'design-tokens.json').read_text(encoding='utf-8'))
art = {k: (site / 'assets' / t['art']).read_text(encoding='utf-8') for k,t in tokens.items()}
code = 'const TOKENS = ' + json.dumps(tokens, ensure_ascii=False) + ';\nconst ART = ' + json.dumps(art, ensure_ascii=False) + ';\n'
code += r'''
const page = figma.currentPage;
if (page.children.some(n => n.name === 'RainProof / Three homepage directions')) throw new Error('Design board already exists; inspect before changing.');
const fonts = [
 {family:'Noto Sans SC',style:'Regular'}, {family:'Noto Sans SC',style:'Medium'}, {family:'Noto Sans SC',style:'Bold'},
 {family:'Noto Serif SC',style:'Medium'}, {family:'Noto Serif SC',style:'Regular'},
 {family:'Manrope',style:'Regular'}, {family:'Manrope',style:'Medium'}, {family:'Manrope',style:'Bold'},
 {family:'Inter',style:'Regular'}
];
const [buttonSet] = await Promise.all([figma.importComponentSetByKeyAsync('cc8b558dc7d9684011b6b99ce8e6509399bc836b'), ...fonts.map(f=>figma.loadFontAsync(f))]);
const buttonVariant = buttonSet.children.find(n=>n.name==='Variant=Primary, State=Default, Size=Medium') || buttonSet.defaultVariant;
const createdVariableIds=[], createdCollectionIds=[];
function rgb(hex){hex=hex.replace('#','');return {r:parseInt(hex.slice(0,2),16)/255,g:parseInt(hex.slice(2,4),16)/255,b:parseInt(hex.slice(4,6),16)/255};}
const vars={};
for (const [key,t] of Object.entries(TOKENS)) {
 const collection=figma.variables.createVariableCollection('RainProof / '+key.toUpperCase()+' '+t.title);createdCollectionIds.push(collection.id);vars[key]={};
 for(const role of ['bg','ink','muted','accent','line','soft']){const v=figma.variables.createVariable(role,collection,'COLOR');v.scopes=['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];v.setValueForMode(collection.modes[0].modeId,{...rgb(t[role]),a:1});vars[key][t[role].toLowerCase()]=v;createdVariableIds.push(v.id);}
}
let theme='a';
function paint(hex){const p={type:'SOLID',color:rgb(hex)};const v=vars[theme]?.[hex.toLowerCase()];return v?figma.variables.setBoundVariableForPaint(p,'color',v):p;}
function fill(n,hex){n.fills=[paint(hex)];}
function row(parent,name,width,gap=0,padding=0){const n=figma.createAutoLayout('HORIZONTAL');n.name=name;n.fills=[];n.itemSpacing=gap;n.paddingLeft=n.paddingRight=n.paddingTop=n.paddingBottom=padding;n.counterAxisAlignItems='CENTER';if(parent)parent.appendChild(n);if(width){n.resize(width,1);n.primaryAxisSizingMode='FIXED';n.counterAxisSizingMode='AUTO';}return n;}
function col(parent,name,width,gap=0,padding=0,bg){const n=figma.createAutoLayout('VERTICAL');n.name=name;n.fills=[];n.itemSpacing=gap;n.paddingLeft=n.paddingRight=n.paddingTop=n.paddingBottom=padding;if(parent)parent.appendChild(n);if(width){n.resize(width,1);n.counterAxisSizingMode='FIXED';n.primaryAxisSizingMode='AUTO';}if(bg)fill(n,bg);return n;}
function text(parent,value,size,color,width,family='Noto Sans SC',style='Regular',lineHeight=160){const n=figma.createText();n.name=value.split('\n')[0];n.fontName={family,style};n.characters=value;n.fontSize=size;n.lineHeight={unit:'PERCENT',value:lineHeight};n.letterSpacing={unit:'PERCENT',value:size>=35?-4:0};n.fills=[paint(color)];parent.appendChild(n);if(width){n.textAutoResize='HEIGHT';n.resize(width,n.height);}return n;}
function line(parent,width,color){const n=figma.createRectangle();n.name='Section divider';n.resize(width,1);fill(n,color);parent.appendChild(n);return n;}
function svg(parent,source,width,height,name){const n=figma.createNodeFromSvg(source);n.name=name;n.resize(width,height);parent.appendChild(n);return n;}
function fixed(parent,name,width,height,bg){const n=figma.createFrame();n.name=name;n.resize(width,height);if(bg)fill(n,bg);else n.fills=[];parent.appendChild(n);return n;}
function brand(parent,t){const r=row(parent,'RainProof brand',null,11);svg(r,'<svg width="35" height="35" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="38" height="38" rx="7" stroke="'+t.ink+'" stroke-width="1.6"/><path d="m18 10-8 13m17-16-8 13m11-6-7 11M9 30h22" stroke="'+t.ink+'" stroke-width="1.9" stroke-linecap="round"/></svg>',35,35,'RainProof / editable logo');text(r,'雨证',26,t.ink,null,'Noto Sans SC','Bold');text(r,'RainProof',13,t.ink,null,'Manrope');return r;}
function button(parent,label,t,primary=true,width=190){const n=buttonVariant.createInstance();n.name='Button / '+label;parent.appendChild(n);n.setProperties({'Label#2:0':label,'Has Icon Start#4:128':false,'Has Icon End#4:64':false});n.resize(width,52);n.primaryAxisSizingMode='FIXED';n.counterAxisSizingMode='FIXED';n.cornerRadius=theme==='a'?8:4;n.fills=[paint(primary?t.accent:t.bg)];n.strokes=primary?[]:[{type:'SOLID',color:rgb(t.line)}];for(const tx of n.findAllWithCriteria({types:['TEXT']})){tx.fontName={family:'Noto Sans SC',style:'Regular'};tx.fontSize=14;tx.fills=[paint(primary?(theme==='c'?'#10271C':'#FFFFFF'):t.ink)];}return n;}
const maxX=Math.max(0,...page.children.map(n=>n.x+n.width));
const board=col(null,'RainProof / Three homepage directions',4656,38,32,'#E8ECE9');board.x=maxX+200;board.y=100;page.appendChild(board);
text(board,'雨证 RainProof / 首页三方向预览',33,'#243B34',null,'Noto Sans SC','Medium');
text(board,'A 更适合产品首页  ·  B 更适合品牌路演  ·  C 更适合技术核验  |  2026-10-29  |  所有页面均为模拟演示',16,'#53675C');
const desktops=row(board,'Desktop concepts',4592,40);desktops.counterAxisAlignItems='MIN';
const mobiles=row(board,'Mobile concepts',4592,60);mobiles.counterAxisAlignItems='MIN';
const frames=[];
for(const key of ['a','b','c']){
 theme=key;const t=TOKENS[key];
 const screen=col(desktops,key.toUpperCase()+' / '+t.title+' / Desktop',1504,0,0,t.bg);screen.clipsContent=true;
 const strip=row(screen,'Design preview navigation',1504,0,12);fill(strip,key==='c'?'#16242C':t.ink);strip.primaryAxisAlignItems='SPACE_BETWEEN';
 text(strip,'RAINPROOF / DESIGN STUDY 2026',10,key==='c'?'#B5C6C4':t.bg,null,'Manrope');text(strip,'A 清朗蓝     B 风雨有温度     C 证据观测站     ← 方案总览',10,key==='c'?'#B5C6C4':t.bg);
 const content=col(screen,'Homepage content',1504,0,80);content.paddingTop=0;content.paddingBottom=40;
 const nav=row(content,'Header',1344,0);nav.resize(1344,100);nav.counterAxisSizingMode='FIXED';nav.primaryAxisAlignItems='SPACE_BETWEEN';brand(nav,t);
 const links=row(nav,'Primary navigation',null,34);for(const v of ['产品体验','保障如何运作','证据核验 ↗'])text(links,v,13,t.ink);button(nav,'进入骑手端  →',t,true,148);
 if(key==='c')line(content,1344,t.line);
 const hero=row(content,'Hero',1344,66);hero.paddingTop=key==='c'?55:40;hero.paddingBottom=50;hero.counterAxisAlignItems='CENTER';
 const copy=col(hero,'Hero copy',620,0);
 text(copy,key==='a'?'● 给每一位，穿行风雨的骑手':key==='b'?'● WEATHER PROTECTION, WITH PEOPLE IN MIND.':'● RAINPROOF / PARAMETRIC PROTECTION',11,t.accent,610,'Noto Sans SC','Medium');
 const heading=col(copy,'Headline',620,0);heading.paddingTop=22;heading.paddingBottom=22;
 text(heading,t.hero[0],key==='a'?78:key==='b'?71:64,t.ink,620,t.font,'Medium',133);
 text(heading,t.hero[1],key==='a'?78:key==='b'?71:64,key==='b'?t.ink:t.accent,620,t.font,'Medium',133);
 text(copy,key==='a'?'为配送骑手设计的参数化降雨保障。\n用清楚的规则，回应雨天里的每一份奔波。':key==='b'?'一场雨，不该让每一份努力失去回响。\n雨证以气象数据为依据，为配送骑手探索更透明的降雨保障。':'为配送骑手而设计的降雨保障技术原型。\n把一场雨变成可复算的判定，把每一个结果留成可核验的证据。',16,t.muted,600,'Noto Sans SC','Regular',200);
 const actions=row(copy,'Hero actions',620,14);actions.paddingTop=30;button(actions,key==='b'?'探索骑手保障  →':'体验骑手保障  →',t,true,185);button(actions,key==='a'?'了解如何运作':key==='b'?'看看保障的依据 ↗':'打开证据核验 ↗',t,false,185);
 const helper=col(copy,'Helper and scope disclosure',620,19);helper.paddingTop=15;text(helper,'✓ 只读浏览无需钱包 · 投保使用测试网模拟资金',11,t.muted,610);text(helper,'保险创业赛技术原型 · 尚未开展真实保险业务。\nRDROP 不可兑换人民币。 规则与风险 ↗',11,t.muted,610);
 if(key!=='c'){
  const visual=fixed(hero,'Original illustration',620,575);svg(visual,ART[key],620,key==='a'?568:577,'Original '+t.art+' / editable vectors');
  if(key==='a'){
   const cap=col(visual,'Scene caption',460,3);cap.x=28;cap.y=29;text(cap,'风雨里，给每一程多一点确定。',13,'#EEF3FF',460);text(cap,'MADE FOR EVERYDAY RIDERS.',10,'#DBE5FF',460,'Manrope');
   const stamp=row(visual,'Evidence stamp',435,13,19);fill(stamp,'#FFFFFF');stamp.cornerRadius=12;stamp.x=-15;stamp.y=480;const dot=fixed(stamp,'Check badge',36,36,'#E7F0D8');dot.cornerRadius=18;svg(dot,'<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><path d="m11 18 5 5 10-11" fill="none" stroke="#2455ef" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',36,36,'Check icon');const st=col(stamp,'Evidence promise',330,2);text(st,'每一次判定，都有据可查',16,t.ink,330,'Noto Sans SC','Medium');text(st,'公开数据 · 透明规则 · 链上证据',11,t.muted,330);
  }else{const seal=col(visual,'Brand seal',185,5,15,t.bg);seal.x=425;seal.y=439;seal.cornerRadius=5;text(seal,'给风雨中的每一程',11,t.accent,155);text(seal,'RainProof',24,t.ink,155,'Manrope','Medium');text(seal,'清楚 · 透明 · 可核验',10,t.muted,155);}
 } else {
  const panel=col(hero,'Evidence observatory',620,0,0,'#101D25');panel.cornerRadius=8;panel.strokes=[{type:'SOLID',color:rgb(t.line)}];panel.clipsContent=true;
  const ph=row(panel,'Panel header',620,0,18);ph.primaryAxisAlignItems='SPACE_BETWEEN';text(ph,'降雨保障观测台',12,t.ink);text(ph,'RULE PREVIEW / 非实时',10,t.muted);
  svg(panel,ART[key],620,400,'Illustrative rainfall map / editable vectors');
  const stats=row(panel,'Coverage constants',620,0);for(const [label,value] of [['可选保障窗口','12 / 24 h'],['最高模拟给付','75 元 / 份'],['领取宽限','7 天']]){const s=col(stats,label,206,8,18);text(s,label,10,t.muted,170);text(s,value,25,t.ink,170,'Manrope','Medium');}
  text(panel,'示意界面，并非实时观测。领取还需及时有效判定及资金充足。',10,t.muted,590);
 }
 line(content,1344,t.line);
 const facts=row(content,'Product facts',1344,0);facts.paddingTop=25;facts.paddingBottom=25;
 for(const [label,desc] of [['12 / 24 小时','两种保障窗口，按需选择'],['最高 75 模拟元','额度基数 100 元，给付以规则为准'],['让结果，有据可查','保单、判定与资金流向支持核验']]){const f=col(facts,label,448,6);text(f,label,key==='c'?21:25,t.ink,420,key==='b'?'Noto Serif SC':'Noto Sans SC','Medium');text(f,desc,11,t.muted,420);}
 line(content,1344,t.line);
 const lower=col(content,'First content section',1344,23);lower.paddingTop=48;text(lower,key==='b'?'一场雨的背后，每一步都有依据。':'从你的角色出发。',34,t.ink,1250,t.font,'Medium');
 const cards=row(lower,'Role entries',1344,20);
 for(const [eyebrow,title,desc] of [['FOR RIDERS','我是一名骑手','看报价、选保障，追踪自己的保单与领取记录。'],['FOR PLATFORMS','我代表配送平台','体验批量代付，查看资金池、保费与赔款对账。']]){const card=col(cards,title,662,10,26,t.soft);card.cornerRadius=key==='a'?18:5;text(card,eyebrow,10,t.accent,610,'Manrope');text(card,title,24,t.ink,610,t.font,'Medium');text(card,desc,12,t.muted,610);}
 const note=col(content,'Prototype boundary',1344,0);note.paddingTop=30;text(note,'首页视觉预览 / 完整页面继续包含运作步骤、12 / 24h 规则切换、常见问题与演示边界。尚未替换现行首页。',11,t.muted,1310);
 frames.push({key,desktopId:screen.id,name:screen.name,width:screen.width,height:screen.height});

 const mobile=col(mobiles,key.toUpperCase()+' / '+t.title+' / Mobile',390,0,20,t.bg);mobile.clipsContent=true;
 text(mobile,key.toUpperCase()+' / '+t.title+'     首页手机预览',10,t.muted,350);const mn=row(mobile,'Mobile header',350,0);mn.paddingTop=20;mn.paddingBottom=30;mn.primaryAxisAlignItems='SPACE_BETWEEN';brand(mn,t);text(mn,'菜单',12,t.ink);
 text(mobile,key==='a'?'● 给每一位，穿行风雨的骑手':key==='b'?'WEATHER PROTECTION, WITH PEOPLE IN MIND.':'RAINPROOF / PARAMETRIC PROTECTION',9,t.accent,350);
 const mh=col(mobile,'Mobile headline',350,0);mh.paddingTop=20;mh.paddingBottom=20;for(const v of t.hero)text(mh,v,key==='a'?56:key==='b'?50:43,key==='c'&&v===t.hero[1]?t.accent:t.ink,350,t.font,'Medium',135);
 text(mobile,key==='a'?'为配送骑手设计的参数化降雨保障。\n用清楚的规则，回应雨天里的每一份奔波。':key==='b'?'一场雨，不该让每一份努力失去回响。\n为配送骑手探索更透明的降雨保障。':'把一场雨变成可复算的判定，\n把每一个结果留成可核验的证据。',13,t.muted,350,'Noto Sans SC','Regular',195);
 const ma=row(mobile,'Mobile actions',350,10);ma.paddingTop=25;button(ma,'体验骑手保障 →',t,true,170);button(ma,key==='c'?'证据核验 ↗':'如何运作',t,false,160);
 const md=col(mobile,'Mobile prototype scope',350,10);md.paddingTop=13;md.paddingBottom=27;text(md,'✓ 只读浏览无需钱包',10,t.muted,350);text(md,'保险创业赛技术原型 · 测试网模拟演示\n尚未开展真实保险业务，RDROP 不可兑换人民币。',9,t.muted,350);
 svg(mobile,ART[key],350,key==='a'?321:key==='b'?326:263,'Mobile original vector illustration');
 const mf=row(mobile,'Mobile facts',350,15);mf.paddingTop=25;mf.paddingBottom=25;for(const [v,d]of[['12/24 h','可选窗口'],['75 模拟元','最高给付'],['可核验','公开规则']]){const f=col(mf,v,105,6);text(f,v,17,t.ink,105);text(f,d,9,t.muted,105);}
 line(mobile,350,t.line);
 const mr=col(mobile,'Mobile rules',350,18);mr.paddingTop=32;mr.paddingBottom=32;text(mr,'保障怎么给付，\n先把规则讲清楚。',28,t.ink,350,t.font,'Medium');text(mr,'12 小时规则示意 / 非实时观测',11,t.muted,350);
 for(const [r,p]of[['≥30 mm','50 模拟元'],['≥70 mm','75 模拟元']]){const rr=row(mr,'Rule '+r,350,0);rr.primaryAxisAlignItems='SPACE_BETWEEN';text(rr,r,25,t.ink,145,'Manrope','Medium');text(rr,p,22,t.accent,180);line(mr,350,t.line);}
 text(mr,'还需及时有效的 PAY 判定、置信度达标、资金充足与外部交易。V6 允许到期后 7 天内领取。',10,t.muted,350);
 frames[frames.length-1].mobileId=mobile.id;
}
const allNodes=[board,...board.findAll(()=>true)];
const counts={};for(const n of allNodes)counts[n.type]=(counts[n.type]||0)+1;
const imageNodes=allNodes.filter(n=>Array.isArray(n.fills)&&n.fills.some(p=>p.type==='IMAGE')).map(n=>({id:n.id,name:n.name,type:n.type,width:n.width,height:n.height}));
const invalidFonts=allNodes.filter(n=>n.type==='TEXT'&&typeof n.fontName==='object'&&!['Noto Sans SC','Noto Serif SC','Manrope'].includes(n.fontName.family)).map(n=>({id:n.id,font:n.fontName}));
if(invalidFonts.length)throw new Error('Unexpected rendered fonts: '+JSON.stringify(invalidFonts));
return {boardId:board.id,createdNodeIds:allNodes.map(n=>n.id),createdVariableIds,createdCollectionIds,frames,counts,imageNodes,invalidFonts,reusedButtonSetKey:buttonSet.key};
'''
out = base / 'design-preview' / 'figma-build.js'
out.parent.mkdir(exist_ok=True)
out.write_text(code, encoding='utf-8')
print(str(out))
