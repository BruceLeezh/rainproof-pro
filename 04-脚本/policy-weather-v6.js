
"use strict";

const HOUR = 3600;
const VERSION = "ai-collect-v6-hourly@1";
const round = n => Math.round(n * 1e6) / 1e6;

function policyWindow(policy, now, lastFeedAt) {
  const from = Number(policy.effectiveFrom);
  const end = Number(policy.endTime);
  if (!policy.anchored || policy.settled) throw new Error("保单须已锚定且未结清");
  if (now < from || now > end) throw new Error("保单当前不在可提交判定的保障期");
  if (!Number.isSafeInteger(lastFeedAt) || lastFeedAt <= from || lastFeedAt > now) {
    throw new Error("缺少生效后的有效链上降雨更新");
  }
  const to = Math.floor(lastFeedAt / HOUR) * HOUR;
  if (to <= from) throw new Error("生效后尚无可核对的完整小时截止点");
  return { from, to };
}

function slices(window) {
  const result = [];
  for (let end = Math.floor(window.from / HOUR) * HOUR + HOUR; end < window.to + HOUR; end += HOUR) {
    const seconds = Math.min(end, window.to) - Math.max(end - HOUR, window.from);
    if (seconds > 0) result.push({ end, seconds });
  }
  return result;
}

function hourlyModels(models, raw, window) {
  const timestamps = raw.hourly?.time;
  if (raw.utc_offset_seconds !== 28800 || !Array.isArray(timestamps)) throw new Error("缺少北京时间逐小时降水数据");
  const rows = new Map();
  for (const [i, timestamp] of timestamps.entries()) {
    const t = Date.parse(timestamp + "+08:00") / 1000;
    if (!Number.isInteger(t) || t % HOUR !== 0 || rows.has(t)) throw new Error("模型时戳无效或重复");
    rows.set(t, i);
  }
  const required = slices(window);
  // 开始和截止可能落在小时中间。按重叠秒数分摊小时量，估计边界雨量。
  return models.map(model => {
    const key = "precipitation_" + model.id;
    const values = raw.hourly[key];
    if (!Array.isArray(values) || values.length !== timestamps.length || raw.hourly_units?.[key] !== "mm") {
      throw new Error(model.label + " 缺少毫米降水序列");
    }
    const hours = required.map(({ end, seconds }) => {
      const mm = values[rows.get(end)];
      if (typeof mm !== "number" || !Number.isFinite(mm) || mm < 0) {
        throw new Error(model.label + " 保障窗口内缺测，暂停判定");
      }
      return { endUnix: end, seconds, mm };
    });
    return { ...model, hours, inWindowMm: round(hours.reduce((sum, h) => sum + h.mm * h.seconds / HOUR, 0)) };
  });
}

function syntheticHourlyModels(models, window, increment) {
  return models.map((model, i) => {
    const mm = round(increment * [1, 0.94, 1.04][i]);
    const rate = mm * HOUR / (window.to - window.from);
    const hours = slices(window).map(({ end, seconds }) => ({ endUnix: end, seconds, mm: rate }));
    return { ...model, hours, inWindowMm: mm };
  });
}

module.exports = { VERSION, policyWindow, hourlyModels, syntheticHourlyModels };
