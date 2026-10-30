# -*- coding: utf-8 -*-
import io, os
d = r"C:\Users\lenovo\Desktop\汉客松\雨证\04-脚本\_silent"
for f in ("feed.vbs", "keeper.vbs", "opsdaily.vbs"):
    p = os.path.join(d, f)
    s = open(p, "rb").read().decode("utf-16")
    n = s.count("雨证·Rainproof")
    s2 = s.replace("雨证·Rainproof", "雨证")
    assert "雨证·Rainproof" not in s2
    open(p, "wb").write(b"\xff\xfe" + s2.encode("utf-16-le"))
    print(f, "替换", n, "处", os.path.getsize(p), "B")
