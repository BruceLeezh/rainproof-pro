"use strict";
/**
 * 演示保命模式（Demo Protection Window）
 *
 * 2026-11-13 夜起因 gas 只有 0.8 BOT，喂价改成「只保台上会念到的七个区划」，
 * 到 2026-11-17 00:00 自动失效、恢复全量。
 *
 * 这个文件是**唯一事实来源**：push-rainfall-v6.js（决定喂谁）、preflight.js（怎么报告）、
 * stage-card.js（读数卡怎么写）都从这里读，避免三处各写一份日期、改一处漏两处。
 */
const PRIORITY = [420100, 420113, 420116, 440100, 110100, 310100, 510100];
const NAMES = {
  420100: "武汉主城", 420113: "汉南区", 420116: "黄陂区",
  440100: "广州", 110100: "北京", 310100: "上海", 510100: "成都",
};
const UNTIL_ISO = "2026-11-17T00:00:00+08:00";
const untilMs = Date.parse(UNTIL_ISO);

module.exports = {
  PRIORITY,
  PRIORITY_SET: new Set(PRIORITY),
  NAMES,
  UNTIL_ISO,
  untilMs,
  active: () => Date.now() < untilMs,
  names: () => PRIORITY.map((c) => NAMES[c] || String(c)).join("/"),
};
