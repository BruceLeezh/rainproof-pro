"use strict";
const MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"];
/** Accept a model only when every completed hour in (from, to] is present. */
function increment(times, perModel, fromIso, nowIso) {
  const empty = { median: null, ok: false, tol: 2.5, windowH: 0, spread: 0, perModel: [], sources: 0 };
  const parse = iso => Date.parse(iso + (iso.endsWith("Z") ? "" : "+08:00"));
  const from = parse(fromIso), to = parse(nowIso);
  if (!Array.isArray(times) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return empty;
  const slots = times.map(parse);
  if (slots.some((t, i) => !Number.isFinite(t) || (i && t <= slots[i - 1]))) return empty;
  const expected = [];
  for (let t = from + 3600000; t <= to; t += 3600000) expected.push(t);
  if (!expected.length || expected.some(t => !slots.includes(t))) return empty;
  const indices = expected.map(t => slots.indexOf(t));
  const sums = MODELS.map(model => {
    const values = perModel[model] || perModel["precipitation_" + model];
    if (!Array.isArray(values) || indices.some(i => typeof values[i] !== "number" || !Number.isFinite(values[i]) || values[i] < 0)) return null;
    return indices.reduce((sum, i) => sum + values[i], 0);
  }).filter(v => v !== null).sort((a, b) => a - b);
  if (sums.length < 2) return { ...empty, sources: sums.length, perModel: sums };
  const median = sums.length === 2 ? (sums[0] + sums[1]) / 2 : sums[1];
  const tol = Math.max(2.5, 0.05 * median);
  const within = sums.filter(v => Math.abs(v - median) <= tol + 1e-9).length;
  return { median, ok: within >= 2, tol, windowH: expected.length,
    spread: sums[sums.length - 1] - sums[0], perModel: sums, sources: sums.length };
}
module.exports = { increment, MODELS };
