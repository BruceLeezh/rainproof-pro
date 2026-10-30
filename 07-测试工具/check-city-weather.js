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
assert.equal(windowFor({mode:'real',epoch:'2026-09-01',until:'2026-10-08'},now).end,Date.parse('2026-10-08T23:00:00Z'));
console.log('City weather: hourly boundaries, valid zero, missing values, invalid values, gaps, duplicate hours, units and historical range passed');
