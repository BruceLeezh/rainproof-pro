/* Browser-only weather comparisons. No wallet, feed, or insurance decision writes. */
(function (root) {
  'use strict';
  const HOUR = 3600000, cache = new Map(), coordinates = new Map();
  const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
  async function json(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('数据服务 HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function point(code) {
    const known = (root.RAINPROOF_CITY_COORDS || {})[code];
    if (validPoint(known)) return known;
    if (coordinates.has(code)) return coordinates.get(code);
    const pending = json('https://geo.datav.aliyun.com/areas_v3/bound/' + code + '.json').then(data => {
      const feature = (data.features || []).find(f => Number(f.properties?.adcode) === Number(code));
      const xy = feature?.properties?.center || feature?.properties?.centroid;
      const result = Array.isArray(xy) ? [xy[1], xy[0]] : null;
      if (!validPoint(result)) throw new Error('未找到此区划的气象坐标；不会使用邻近城市替代');
      return result;
    }).catch(error => { coordinates.delete(code); throw error; });
    coordinates.set(code, pending);
    return pending;
  }
  function sumHourly(data, start, end) {
    const times = data?.hourly?.time, rain = data?.hourly?.precipitation;
    if (!Array.isArray(times) || !Array.isArray(rain) || times.length !== rain.length) throw new Error('气象时间轴或雨量字段缺失');
    if (data.hourly_units?.precipitation !== 'mm') throw new Error('气象雨量单位不是 mm');
    const values = new Map();
    for (let i = 0; i < times.length; i++) {
      const key = String(times[i]);
      if (values.has(key)) throw new Error('气象时间轴重复');
      values.set(key, rain[i]);
    }
    let sum = 0;
    for (let t = start; t <= end; t += HOUR) {
      const key = new Date(t).toISOString().slice(0, 16), v = values.get(key);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('雨量缺测或时间窗口不完整（' + key + '）');
      sum += v;
    }
    return Math.round(sum * 100) / 100;
  }
  function windowFor(options, now) {
    if (options.mode === 'real') {
      const start = Date.parse(options.epoch + 'T00:00:00Z');
      const end = Date.parse(options.until + 'T23:00:00Z');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('历史区间无效');
      return { start, end };
    }
    if (![12, 24].includes(options.hours)) throw new Error('仅支持 12 或 24 小时窗口');
    // API precipitation at 10:00 covers the preceding hour, ending at 10:00.
    const end = Math.floor((now + 8 * HOUR) / HOUR) * HOUR;
    return { start: end - (options.hours - 1) * HOUR, end };
  }
  async function read(city, options) {
    const now = Date.now(), range = windowFor(options, now);
    const key = [city.code, options.mode, range.start, range.end].join(':');
    const old = cache.get(key);
    if (old?.pending) return old.pending;
    if (!options.force && old && now < old.expires) {
      if (old.error) throw new Error(old.error);
      return old.value;
    }
    const entry = {};
    entry.pending = (async () => {
      try {
        const [lat, lon] = await point(city.code);
        const params = new URLSearchParams({ latitude: lat, longitude: lon, hourly: 'precipitation', timezone: 'Asia/Shanghai' });
        let endpoint;
        if (options.mode === 'real') {
          endpoint = 'https://archive-api.open-meteo.com/v1/archive';
          params.set('start_date', options.epoch); params.set('end_date', options.until);
        } else {
          endpoint = 'https://api.open-meteo.com/v1/forecast';
          params.set('past_days', '2'); params.set('forecast_days', '1');
        }
        const url = endpoint + '?' + params;
        const data = await json(url);
        const value = { mm: sumHourly(data, range.start, range.end), at: Date.now(), lat, lon, url,
          start: new Date(range.start).toISOString().slice(0,16), end: new Date(range.end).toISOString().slice(0,16) };
        entry.value = value; entry.expires = Date.now() + (options.mode === 'real' ? 86400000 : 600000);
        return value;
      } catch (error) {
        entry.error = error.message || String(error); entry.expires = Date.now() + 30000;
        throw error;
      } finally { entry.pending = null; }
    })();
    cache.set(key, entry);
    // Bound memory when users explore many cities and windows.
    if (cache.size > 80) for (const [k, v] of cache) { if (!v.pending && k !== key) { cache.delete(k); break; } }
    return entry.pending;
  }
  root.RainproofCityWeather = { read, sumHourly, windowFor };
  if (typeof module !== 'undefined') module.exports = root.RainproofCityWeather;
})(typeof window === 'undefined' ? globalThis : window);
