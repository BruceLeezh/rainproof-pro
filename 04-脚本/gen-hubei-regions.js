#!/usr/bin/env node
/**
 * gen-hubei-regions.js —— 生成湖北 118 个区划（13 地级市 + 105 县级）的链上注册清单
 *
 * 口径（与前端 cn-cities.js 同源）：
 *   · 地级市链上 regionId = 4 位行政区划码 + "00"（武汉 4201 → 420100）
 *   · 县级单位本身就是 6 位码（江岸区 420102、仙桃市 429004）
 *   · 4290「省直辖县级行政区划」是容器，不是城市：不注册 429000，只注册其下 4 个县级单位
 *
 * 坐标来自阿里 DataV 行政区划 GeoJSON 的 properties.center（无 center 时用 centroid），
 * 供 Open-Meteo 取数；注册名取行政区全称（武汉市 / 江岸区 / 恩施土家族苗族自治州）。
 *
 * 用法：node gen-hubei-regions.js [--force]
 * 产物：04-脚本/hubei-regions.json
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CITIES_FILE = path.join(ROOT, "05-演示站点", "cn-cities.json");
const OUT = path.join(__dirname, "hubei-regions.json");
const FORCE = process.argv.includes("--force");

const PROV = "42";

async function fetchJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "rainproof-hubei-setup/1.0" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 800 * (i + 1))); }
  }
  throw last;
}

(async () => {
  if (fs.existsSync(OUT) && !FORCE) {
    const cur = JSON.parse(fs.readFileSync(OUT, "utf8"));
    if (cur.regions && cur.regions.length === 118) { console.log(`已存在 118 个区划：${OUT}（--force 重生成）`); return; }
  }
  const tree = JSON.parse(fs.readFileSync(CITIES_FILE, "utf8"));
  const hb = tree.find((p) => String(p.code) === PROV);
  if (!hb) throw new Error("cn-cities.json 里没有湖北省");

  const rows = [];
  for (const c of hb.children) {
    const cityCode4 = String(c.code);
    const isDirect = cityCode4.endsWith("90"); // 4290 省直辖县级行政区划：容器
    if (!isDirect) {
      const code = Number(cityCode4 + "00");
      rows.push({ code, name: c.name, kind: "city", parent: null, adcode: code });
    }
    for (const a of c.children) {
      rows.push({ code: Number(a.code), name: a.name, kind: "county", parent: isDirect ? null : Number(cityCode4 + "00"), adcode: Number(a.code) });
    }
  }

  console.log(`湖北：地级市 ${rows.filter((r) => r.kind === "city").length} · 县级 ${rows.filter((r) => r.kind === "county").length} · 合计 ${rows.length}`);

  for (const r of rows) {
    if (r.lat != null) continue;
    const j = await fetchJson(`https://geo.datav.aliyun.com/areas_v3/bound/${r.adcode}.json`);
    const p = j && j.features && j.features[0] && j.features[0].properties;
    const c = (p && (p.center || p.centroid)) || null;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      // 开发区/管理区/新改制的县级市在 DataV 没有独立边界：落到母市坐标，绝不回退到省中心
      const parent = rows.find((x) => x.code === r.parent);
      if (parent && parent.lat != null) {
        r.lon = parent.lon; r.lat = parent.lat;
        console.warn(`⚠️ ${r.code} ${r.name} 无独立边界，用母市 ${parent.name} 坐标`);
      } else {
        r.lon = 114.3; r.lat = 30.6;
        console.warn(`⚠️ ${r.code} ${r.name} 无坐标，退回省中心`);
      }
      r.geoSource = "parent-fallback";
    } else { r.lon = c[0]; r.lat = c[1]; r.geoSource = "datav-areas_v3"; }
    await new Promise((res) => setTimeout(res, 120));
  }

  const out = {
    schema: "rainproof/hubei-regions@1",
    generatedAt: new Date().toISOString(),
    province: { code: 420000, name: "湖北省" },
    note: "地级市 = 4位码+00；县级 = 6位码；4290 容器不注册；105 县级含仙桃/潜江/天门/神农架 4 个省直辖单位",
    counts: { city: rows.filter((r) => r.kind === "city").length, county: rows.filter((r) => r.kind === "county").length, total: rows.length },
    regions: rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`已写 ${OUT}`);
})().catch((e) => { console.error("💥 " + (e.message || e)); process.exit(1); });
