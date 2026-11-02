"use strict";
// Explicit import for a new region. The existing operational registry is never edited.
const fs=require("fs"),path=require("path"),crypto=require("crypto"),zlib=require("zlib");
const flags=Object.fromEntries(process.argv.slice(2).filter(s=>s.startsWith("--")&&s.includes("=")).map(s=>{const i=s.indexOf("=");return[s.slice(2,i),s.slice(i+1)];}));
async function main(){
  const code=Number(flags.code),lat=Number(flags.lat),lon=Number(flags.lon),name=flags.name;
  if(!/^\d{6}$/.test(String(code))||!name||name.length>80||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)throw new Error("需要 --code=六位区划码 --name=地区名 --lat=纬度 --lon=经度");
  const dir=path.join(__dirname,"cache"),file=path.join(dir,code+".json.gz"),metaFile=path.join(dir,code+".meta.json");
  if(fs.existsSync(file)||fs.existsSync(metaFile))throw new Error("该输入已存在；为保持来源记录，本工具不覆盖历史文件");
  const url=new URL("https://archive-api.open-meteo.com/v1/archive");
  for(const [k,v]of Object.entries({latitude:lat,longitude:lon,start_date:"2015-10-01",end_date:"2026-09-30",hourly:"precipitation",timezone:"Asia/Shanghai",models:"era5"}))url.searchParams.set(k,String(v));
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error("Archive HTTP "+response.status);
  const text=await response.text(),raw=JSON.parse(text);require("./build-model").prepare(raw);
  const sha256=crypto.createHash("sha256").update(text).digest("hex");
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(file,zlib.gzipSync(text),{flag:"wx"});
  fs.writeFileSync(metaFile,JSON.stringify({code,name,model:"era5",url:String(url),sha256,retrievedAt:new Date().toISOString()},null,2),{flag:"wx"});
  const existing=JSON.parse(fs.readFileSync(path.join(__dirname,"../../04-脚本/v5-regions.json"),"utf8"));
  if(!existing.some(r=>r.code===code)){
    const extraFile=path.join(__dirname,"extra-regions.json"),extra=fs.existsSync(extraFile)?JSON.parse(fs.readFileSync(extraFile,"utf8")):[];
    if(extra.some(r=>r.code===code))throw new Error("试算地区重复，未覆盖地区清单");
    extra.push({code,name,lat,lon});fs.writeFileSync(extraFile,JSON.stringify(extra,null,2));
  }
  console.log("已导入固定 ERA5 来源。运行 node 10-金融与定价/pricing-next/build-model.js 重算；不会开通链上区划。");
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
