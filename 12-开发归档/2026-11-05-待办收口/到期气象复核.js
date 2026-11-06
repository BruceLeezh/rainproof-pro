
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const root=path.resolve(__dirname,"../..");
const {hourlyModels}=require(path.join(root,"04-脚本/policy-weather-v6"));
const names=["ecmwf_ifs025","gfs_seamless","icon_seamless"];
(async()=>{
 const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,fs.readdirSync(__dirname).filter(f=>f.startsWith("链上只读-")).sort().at(-1))));
 const registry=require(path.join(root,"04-脚本/v5-regions.json"));
 const results=[];
 for(const policy of snapshot.policies){
  const region=registry.find(r=>r.code===policy.region);
  const url=new URL("https://api.open-meteo.com/v1/forecast");
  url.search=new URLSearchParams({latitude:region.lat,longitude:region.lon,hourly:"precipitation",timezone:"Asia/Shanghai",
   start_date:policy.effective.slice(0,10),end_date:policy.end.slice(0,10),models:names.join(",")});
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error("HTTP "+response.status);
  const raw=await response.text(),filename="到期气象-保单"+policy.id+".json";
  fs.writeFileSync(path.join(__dirname,filename),raw,{flag:"wx"});
  const window={from:Date.parse(policy.effective)/1000,to:Date.parse(policy.end)/1000};
  const values=hourlyModels(names.map(id=>({id,label:id})),JSON.parse(raw),window);
  results.push({id:policy.id,from:policy.effective,to:policy.end,rawFile:filename,sha256:crypto.createHash("sha256").update(raw).digest("hex"),url:url.href,
    models:values.map(m=>({id:m.id,rainfallMm:m.inWindowMm})),entryThreshold:policy.hours===24?50:30});
 }
 fs.writeFileSync(path.join(__dirname,"到期气象复核.json"),JSON.stringify({time:new Date().toISOString(),results},null,2)+"\n",{flag:"wx"});
 console.log(results);
})().catch(e=>{console.error(e.message);process.exitCode=1;});

