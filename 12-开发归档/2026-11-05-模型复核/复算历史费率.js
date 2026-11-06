
const fs=require("fs"),vm=require("vm"),zlib=require("zlib"),crypto=require("crypto"),path=require("path"),{createRequire}=require("module");
const root=path.resolve(__dirname,"../..");
process.chdir(root);
const projectRequire=createRequire(path.join(root,"deployment.json"));
const file=path.resolve("04-脚本/hubei-pricing.js");
const source=fs.readFileSync(file,"utf8");
const end=source.indexOf("\n(async () => {");
if(end<0)throw new Error("Unexpected entry");
const cellStats=vm.runInNewContext(source.slice(0,end)+"\ncellStats;",{require:createRequire(file),__dirname:path.dirname(file),process:{argv:[]}});
const dir="12-开发归档/2026-11-05-模型复核";
const audit=projectRequire("./"+dir+"/复算结果.json");
const h=projectRequire("./10-金融与定价/hubei-pricing.json");
const e=projectRequire("./10-金融与定价/pricing_engine");
const old=projectRequire("./10-金融与定价/pricing-engine.json");
const fresh=e.main({write:false});
const mismatches=fresh.cells.flatMap((r,i)=>["upperRatePct","pointRatePct","premiumRetailEth"].filter(k=>r[k]!==old.cells[i][k]).map(k=>[i,k,r[k],old.cells[i][k]]));
const errors=[], nulls=[];let ok=0;
for(const r of h.regions){
 const bytes=zlib.gunzipSync(fs.readFileSync("10-金融与定价/cache-hubei/"+r.code+".json.gz"));
 const sha=crypto.createHash("sha256").update(bytes).digest("hex");
 if(sha!==r.digest) errors.push([r.code,"hash"]);
 const raw=JSON.parse(bytes).hourly;
 if(raw.precipitation.some(x=>x==null))nulls.push(r.code);
 const data=raw.precipitation.map(x=>Math.round((x??0)*10));
 for(const n of [12,24]){
 const result=cellStats(data,raw.time,n),ref=r["hours"+n];
 if(result.priceFen!==r.grid[n]||result.upperRatePct!==ref.upperRatePct||result.nHit!==ref.nHit) errors.push([r.code,n,result.priceFen,r.grid[n],result.upperRatePct,ref.upperRatePct]);else ok++;
 }}
const result={v3:{rows:fresh.cells.length,mismatches},hubei:{ok,errors,nulls}};
fs.writeFileSync(dir+"/历史模型复算.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
console.log(JSON.stringify({chain:{...audit.chain,rates:audit.chain.rates.filter(x=>[420100,310100,110100,440100,510100].includes(x.code))},research:{changed:audit.research.changed,quality:audit.research.inputQuality,annual:audit.research.after.annualIllustration,test:audit.research.after.test,range:[audit.research.after.minPremiumYuan,audit.research.after.maxPremiumYuan],negative:audit.research.after.negativeTestRegionYears,sample:audit.research.sample.filter(x=>x.code===420100&&x.month===7),conditional:audit.research.conditional.map(x=>[x.name,x.h,x.oldWet/x.wet/(x.oldAll/x.n),x.newWet/x.wet/(x.newAll/x.n),(1-x.newWet/x.oldWet)*100])}},null,1));

