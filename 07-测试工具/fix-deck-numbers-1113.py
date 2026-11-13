# -*- coding: utf-8 -*-
"""修正两份 deck 的过期读数、保单口径、队名、学号与页码（2026-11-13）"""
import shutil, re
from pptx import Presentation
from pathlib import Path

PPT = Path(r"C:\Users\lenovo\Desktop\雨证\01-参赛材料\交付物\PPT")
BK = Path(r"C:\Users\lenovo\Desktop\雨证\08-截图存证")
DA = PPT / "神麻组-雨证-路演PPT-答辩版-2026-10-28.pptx"
JJ = PPT / "神麻组-雨证-路演PPT-精简版-2026-10-30.pptx"

for f in (DA, JJ):
    dst = BK / ("deck-backup-before-numfix-" + f.name)
    if not dst.exists():
        shutil.copy2(f, dst)

REPL = [
    ("五城雨量直读链上：上海 173、武汉 88、北京 64、广州 53、成都 24 mm；24h 档线 50 / 100，成都未到第一档。",
     "五地雨量直读链上（11-13 14:30）：上海 226、北京 82、广州 79、成都 27、汉南 173 mm；24h 档线 50 / 100，成都未到第一档。"),
    ("判定与赔付逐条留痕：968 上 0 张保单、0 笔赔付，122 个区划每次喂价都可核验。区块号与证据哈希可逐条回溯。",
     "判定与赔付逐条留痕：已签发 2 张真实保单、均已到期结清、0 笔赔付；122 个区划每次喂价都可核验，区块号与证据哈希可逐条回溯。"),
    ("入口页把基数 100 元、最高 75 元/份、窗口 24 小时摆上台面；武汉 24h 8.80 元见中图 —— 均为合约返回。",
     "入口页把基数 100 元、最高 75 元/份、窗口 24 小时摆上台面；汉南 24h 10.50 元 / 黄陂 6.00 元见中图 —— 均为合约返回。"),
    ("保单 #0 · 上海 · 判定留痕 · V5 合约", "V5 历史单 · 上海 · 已归档留痕"),
    ("注资 + 保费 − 赔付 = 池子 4,958.40 元，逐分对账",
     "注资 4,958.40 + 保费 14.70 = 池子 4,973.10，逐分对账"),
    ("雨证 · RainProof\u3000·\u3000TEAM 神麻", "雨证 · RainProof\u3000·\u3000中南财经政法大学"),
    ("TEAM 神麻", "队伍：雨证"),
]


def set_para(para, new):
    if len(para.runs) == 1:
        para.runs[0].text = new
    else:
        para.runs[0].text = new
        for r in para.runs[1:]:
            r.text = ""


def patch(path, label):
    prs = Presentation(str(path))
    hits, xuehao = {}, 0
    for slide in prs.slides:
        for shape in list(slide.shapes):
            if not shape.has_text_frame:
                continue
            tf = shape.text_frame
            if "学号" in tf.text and tf.text.strip().startswith("学号"):
                shape._element.getparent().remove(shape._element)
                xuehao += 1
                continue
            for para in tf.paragraphs:
                text = "".join(r.text for r in para.runs)
                if not text.strip():
                    continue
                if "学号" in text:
                    for r in para.runs:
                        r.text = ""
                    xuehao += 1
                    continue
                for i, (old, new) in enumerate(REPL):
                    if text == old:
                        set_para(para, new)
                        hits[i] = hits.get(i, 0) + 1
                        break

    if label == "精简":
        sldIdLst = prs.slides._sldIdLst
        sld = list(sldIdLst)[14]
        prs.part.drop_rel(sld.rId)
        sldIdLst.remove(sld)
        n = len(list(prs.slides._sldIdLst))
        for i, slide in enumerate(prs.slides, 1):
            for shape in slide.shapes:
                if shape.has_text_frame and re.fullmatch(r"\d+\s*/\s*\d+", shape.text_frame.text.strip()):
                    p = shape.text_frame.paragraphs[0]
                    if p.runs:
                        p.runs[0].text = "%02d / %d" % (i, n)
    prs.save(str(path))
    print(label, "页数", len(list(prs.slides._sldIdLst)), "删学号", xuehao,
          "命中", {REPL[i][0][:12]: v for i, v in sorted(hits.items())})


patch(DA, "答辩")
patch(JJ, "精简")
