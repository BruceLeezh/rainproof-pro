/**
 * 区域表 + 累计起点 —— 全项目【唯一】的一份
 * ============================================================================
 *
 * 【为什么必须单独一个文件】
 *   和 canonical.js 同一个道理：坐标、区域 id、累计起点如果喂价脚本和 AI 判定
 *   各写一份，两边迟早会悄悄不一致 —— 症状是「AI 判定说不达标，链上却说达标」，
 *   而且看起来一切正常。所以只留这一份。
 *
 * 【约束】
 *   regionId 必须与合约里的 regionName() 一一对应：
 *   1=wuhan 2=shanghai 3=beijing 4=guangzhou 5=chengdu
 *   改动这张表就要同步改合约，脚本会自检（assertRegionsMatchContract）。
 */

// 坐标用城市中心点。Open-Meteo 的网格是 ~11km(ECMWF) / ~13km(GFS)，
// 城市级别足够；真要更细可以换成区级坐标，但 id ↔ 名称的对应关系不能动。
const REGIONS = [
  { id: 1, key: "wuhan",     name: "武汉", lat: 30.5928, lon: 114.3055 },
  { id: 2, key: "shanghai",  name: "上海", lat: 31.2304, lon: 121.4737 },
  { id: 3, key: "beijing",   name: "北京", lat: 39.9042, lon: 116.4074 },
  { id: 4, key: "guangzhou", name: "广州", lat: 23.1291, lon: 113.2644 },
  { id: 5, key: "chengdu",   name: "成都", lat: 30.5728, lon: 104.0668 },
];

const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// 累计降雨从这个日期开始算。2026-10-01 = 赛事周的第一天。
// 合约侧按「保单期间增量」判定，这个 epoch 只影响链下脚本怎么算累计值。
const RAIN_EPOCH = process.env.RAIN_EPOCH || "2026-10-01";

/**
 * v5（区划码版）：regionId = 民政部行政区划码，不是 1..5 序号。
 * 合约侧有 regions(uint32) -> (name, active)，没有 regionName(uint8)。
 */
const REGIONS_V5 = [
  { id: 420100, key: "wuhan",     name: "武汉", lat: 30.5928, lon: 114.3055 },
  { id: 310100, key: "shanghai",  name: "上海", lat: 31.2304, lon: 121.4737 },
  { id: 110100, key: "beijing",   name: "北京", lat: 39.9042, lon: 116.4074 },
  { id: 440100, key: "guangzhou", name: "广州", lat: 23.1291, lon: 113.2644 },
  { id: 510100, key: "chengdu",   name: "成都", lat: 30.5728, lon: 104.0668 },
  { id: 330782, key: "yiwu",      name: "义乌", lat: 29.3068, lon: 120.0752 },
];
const REGION_BY_CODE = Object.fromEntries(REGIONS_V5.map((r) => [r.id, r]));

/** 按链上 regionId 取区域：v5 传区划码，v1/v2/v3 传 1..5 —— 两套都认，不用调用方判断版本。 */
function regionOf(regionId) {
  const n = Number(regionId);
  return REGION_BY_CODE[n] || REGION_BY_ID[n];
}

/**
 * 区域表 ↔ 合约一致性断言。会自动判版本：
 *  - 有 regionName(uint8)  ⇒ v1/v2/v3，比 1..5 表的 key；
 *  - 只有 regions(uint32)  ⇒ v5，比区划码表的名字与 active。
 * 对不上就抛 —— 别让错区域悄悄跑一整场。
 */
async function assertRegionsMatchContract(contract) {
  // ethers v6 的 Contract 是 Proxy：任何方法名都「存在」，typeof contract.regions 恒为 "function"，
  // 所以版本只能靠真调一次 + catch 来判断。两个探针都失败 = 调用方拿错了 ABI，要说人话。
  const probe = async (fn, label) => {
    try { return { ok: true, v: await fn() }; }
    catch (e) {
      const code = e && (e.code || "");
      if (/NETWORK|TIMEOUT|SERVER_ERROR|BAD_GATEWAY/.test(code)) throw e;   // 网络问题不许当成「函数不存在」
      return { ok: false, e, label };
    }
  };
  const pLegacy = await probe(() => contract.regionName(1), "regionName(uint8)");
  if (!pLegacy.ok) {
    const pV5 = await probe(() => contract.regions(REGIONS_V5[0].id), "regions(uint32)");
    if (!pV5.ok) {
      const msg = (r) => String((r.e && (r.e.shortMessage || r.e.message)) || r.e).split("\n")[0];
      throw new Error(
        "区域表探针失败：这份 ABI 里既没有 regionName(uint8) 也没有 regions(uint32)，无法核对区域表。\n" +
        "  多半是调用方拿错了 ABI —— v1/v2/v3 用 RainDeliveryInsurance*.abi.json，v5 用 RainDeliveryInsuranceV5.abi.json。\n" +
        `  ${pLegacy.label} → ${msg(pLegacy)}\n  ${pV5.label} → ${msg(pV5)}`
      );
    }
  }
  const legacy = pLegacy.ok;
  const bad = [];
  if (legacy) {
    for (const r of REGIONS) {
      const onchain = await contract.regionName(r.id);
      if (onchain !== r.key) bad.push(`#${r.id} 合约=${onchain} 脚本=${r.key}`);
    }
  } else {
    for (const r of REGIONS_V5) {
      const [onchainName, active] = await contract.regions(r.id);
      if (!active) bad.push(`${r.id} 合约未激活 脚本=${r.name}`);
      else if (!String(onchainName).includes(r.name)) bad.push(`${r.id} 合约=${onchainName} 脚本=${r.name}`);
    }
  }
  if (bad.length) throw new Error("区域表与合约不一致：" + bad.join("; "));
}

module.exports = { REGIONS, REGION_BY_ID, REGIONS_V5, REGION_BY_CODE, regionOf, RAIN_EPOCH, assertRegionsMatchContract };
