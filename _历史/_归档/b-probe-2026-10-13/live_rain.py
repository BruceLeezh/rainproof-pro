# 只读：拉 Open-Meteo 现网雨量，算「最近 24h / 72h 累计」与「未来 24h 预报」，不写任何仓库文件
import json, urllib.request, datetime, sys

CITIES = [("武汉", 30.5928, 114.3055), ("上海", 31.2304, 121.4737), ("北京", 39.9042, 116.4074),
          ("广州", 23.1291, 113.2644), ("成都", 30.5728, 104.0668)]
URL = ("https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
       "&hourly=precipitation&past_days=3&forecast_days=2&timezone=Asia%2FShanghai")

now = datetime.datetime.now()
print("本机时间:", now.strftime("%Y-%m-%d %H:%M:%S"), "| 数据源: api.open-meteo.com (forecast)")
print(f"{'城市':<6}{'最近24h':>10}{'最近72h':>10}{'未来24h':>10}   最新一小时")
for name, lat, lon in CITIES:
    try:
        with urllib.request.urlopen(URL.format(lat=lat, lon=lon), timeout=25) as r:
            j = json.load(r)
    except Exception as e:
        print(f"{name:<6}  拉取失败: {e}")
        continue
    t = j["hourly"]["time"]; p = j["hourly"]["precipitation"]
    idx_now = max(i for i, s in enumerate(t) if s <= now.strftime("%Y-%m-%dT%H:00"))
    w24 = sum(x or 0 for x in p[max(0, idx_now - 23):idx_now + 1])
    w72 = sum(x or 0 for x in p[max(0, idx_now - 71):idx_now + 1])
    f24 = sum(x or 0 for x in p[idx_now + 1:idx_now + 25])
    print(f"{name:<6}{w24:>10.2f}{w72:>10.2f}{f24:>10.2f}   {t[idx_now]} 时 {p[idx_now]:.2f} mm  (阈值 50mm/72h)")
