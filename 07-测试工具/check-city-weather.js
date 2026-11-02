'use strict';
const assert=require('node:assert/strict');
const {sumHourly,windowFor}=require('../05-演示站点/city-weather.js');
const now=Date.parse('2026-10-29T04:45:00Z'), range=windowFor({mode:'live',hours:12},now);
assert.equal(new Date(range.end).toISOString(),'2026-10-29T12:00:00.000Z');
const times=Array.from({length:12},(_,i)=>new Date(range.start+i*3600000).toISOString().slice(0,16));
const data={hourly_units:{precipitation:'mm'},hourly:{time:times,precipitation:Array(12).fill(1.25)}};
assert.equal(sumHourly(data,range.start,range.end),15);
assert.equal(sumHourly({...data,hourly:{time:times,precipitation:Array(12).fill(0)}},range.start,range.end),0);
for(const value of [null,undefined,'1',-1,NaN]){
 const broken=structuredClone(data);broken.hourly.precipitation[4]=value;
 assert.throws(()=>sumHourly(broken,range.start,range.end),/缺测/);
}
const gap=structuredClone(data);gap.hourly.time.splice(2,1);gap.hourly.precipitation.splice(2,1);
assert.throws(()=>sumHourly(gap,range.start,range.end),/不完整/);
const dup=structuredClone(data);dup.hourly.time[2]=dup.hourly.time[1];assert.throws(()=>sumHourly(dup,range.start,range.end),/重复/);
assert.throws(()=>sumHourly({...data,hourly_units:{precipitation:'inch'}},range.start,range.end),/单位/);
assert.throws(()=>windowFor({mode:'live',hours:72},now),/12 或 24/);
const historical=windowFor({mode:'real',epoch:'2026-09-01',until:'2026-10-08'},now);
assert.equal(historical.start,Date.parse('2026-09-01T01:00:00Z'));
assert.equal(historical.end,Date.parse('2026-10-09T00:00:00Z'));
assert.equal((historical.end-historical.start)/3600000+1,38*24);
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),ctx={window:{}};
const site=path.resolve(__dirname,'../05-演示站点');
vm.runInNewContext(fs.readFileSync(path.join(site,'historical-rainfall.js'),'utf8'),ctx);
const baseline=ctx.window.RAINPROOF_HISTORICAL_RAINFALL;
assert.equal(baseline.model,'ERA5');assert.equal(baseline.regions.length,5);
for(const row of baseline.regions){
 const bytes=fs.readFileSync(path.join(site,row.rawFile)),raw=JSON.parse(bytes);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256);
 const url=new URL(row.url);assert.equal(url.searchParams.get('models'),'era5');assert.equal(url.searchParams.get('end_date'),'2026-10-09');
 assert.equal(row.hours,912);assert.equal(sumHourly(raw,historical.start,historical.end),row.mm);
 assert.equal(row.status,undefined);assert.equal(row.gateDays,undefined);
 const csv=fs.readFileSync(path.join(site,row.csvFile),'utf8');
 assert.equal(crypto.createHash('sha256').update(csv).digest('hex'),row.csvSha256);
 const values=csv.trim().split('\n').slice(1).map(line=>Number(line.split(',')[1]));assert.equal(values.length,912);
 assert.equal(Math.round(values.reduce((s,v)=>s+Math.round(v*1000),0)/10)/100,row.mm);
}
console.log('City weather: hourly boundaries, valid zero, missing values, invalid values, gaps, duplicate hours, units and historical range passed');
console.log('Historical baseline: five ERA5 sources, original hashes, complete 912-hour window and CSV sums passed');
