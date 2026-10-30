# -*- coding: utf-8 -*-
"""雨证项目合并：单根化 + 去重 + 分类。先 DRY 打印，再 EXECUTE。
所有动作写入 _merge/actions.jsonl，可反向回滚。
"""
import os, sys, json, shutil, hashlib, time

ROOT = r"C:\Users\lenovo\Desktop\汉客松"
S = os.path.join(ROOT, "雨证·Rainproof")
D = os.path.join(ROOT, "雨证")
M = os.path.join(D, "01-参赛材料")
COMP = os.path.join(ROOT, "保险创业赛-2026")
LOG = os.path.join(ROOT, "_merge", "actions.jsonl")
DRY = "--execute" not in sys.argv

os.makedirs(os.path.dirname(LOG), exist_ok=True)
acts = []

def log(kind, src, dst=""):
    acts.append({"t": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": kind,
                 "src": os.path.relpath(src, ROOT) if src else "",
                 "dst": os.path.relpath(dst, ROOT) if dst else ""})
    print(f"[{kind}] {os.path.relpath(src, ROOT) if src else ''} -> {os.path.relpath(dst, ROOT) if dst else ''}")

def mv(src, dst):
    log("move", src, dst)
    if DRY:
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst):
        raise SystemExit(f"目标已存在，拒绝覆盖：{dst}")
    shutil.move(src, dst)

def rm(path, why):
    log("delete:" + why, path)
    if DRY:
        return
    if os.path.isdir(path):
        shutil.rmtree(path)
    elif os.path.exists(path):
        os.remove(path)

def mkdir(p):
    log("mkdir", p)
    if not DRY:
        os.makedirs(p, exist_ok=True)

# ---------- 1. 项目根重命名 ----------
if os.path.exists(S) and not os.path.exists(D):
    mv(S, D)
elif os.path.exists(D):
    print("!! 目标根已存在，跳过重命名"); S = D
else:
    raise SystemExit("找不到 雨证·Rainproof")

for sub in ["交付物/PPT", "交付物/视频", "文案", "_工具", "_历史"]:
    mkdir(os.path.join(M, sub))

# ---------- 2. 保险创业赛-2026 → 01-参赛材料 ----------
if os.path.isdir(COMP):
    for name in sorted(os.listdir(COMP)):
        src = os.path.join(COMP, name)
        if name in ("__pycache__", "_deck.txt", "_归档"):
            continue
        if name == "_history":
            mv(src, os.path.join(M, "_历史", "保险创业赛-历史"))
            continue
        mv(src, os.path.join(M, name))
    rm(os.path.join(COMP, "_归档"), "重复PPT1第3份")
    rm(os.path.join(COMP, "__pycache__"), "Python缓存")
    rm(os.path.join(COMP, "_deck.txt"), "抽取中间文本")
    if not DRY and os.path.isdir(COMP) and not os.listdir(COMP):
        os.rmdir(COMP)

# ---------- 3. 赛事资料 ----------
if os.path.isdir(os.path.join(ROOT, "00-赛事资料")):
    mv(os.path.join(ROOT, "00-赛事资料"), os.path.join(D, "00-赛事资料"))

# ---------- 4. 01-参赛材料 内部归位 ----------
if os.path.isdir(M):
    for name in list(os.listdir(M)):
        p = os.path.join(M, name)
        if not os.path.isfile(p):
            continue
        if name.endswith((".pptx", ".pdf")):
            mv(p, os.path.join(M, "交付物", "PPT", name))
        elif name.endswith(".py"):
            mv(p, os.path.join(M, "_工具", name))
        elif name.endswith(".json") and ("审查" in name or "audit" in name.lower()):
            mv(p, os.path.join(M, "_工具", name))
        elif ".bak-" in name:
            mv(p, os.path.join(M, "_历史", name))

# 旧版 PPT 进历史（保留最新三套在交付物）
HIST = os.path.join(M, "_历史")
PPT = os.path.join(M, "交付物", "PPT")
if os.path.isdir(PPT):
    for name in list(os.listdir(PPT)):
        if name.startswith(("雨证-初赛答辩PPT", "雨证-路演PPT-定稿")):
            mv(os.path.join(PPT, name), os.path.join(HIST, "旧版PPT", name))

# ---------- 5. 提交材料 拆解 ----------
SUB = os.path.join(D, "提交材料")
if os.path.isdir(SUB):
    for name in sorted(os.listdir(SUB)):
        p = os.path.join(SUB, name)
        if name.endswith(".mp4"):
            mv(p, os.path.join(M, "交付物", "视频", name))
        elif name.endswith(".md"):
            mv(p, os.path.join(M, "文案", name))
        elif name.endswith(".m4a"):
            mv(p, os.path.join(M, "交付物", "视频", name))
        elif name == "神麻组-雨证-路演PPT1.pptx":
            rm(p, "重复PPT1第4份-旧版9.2M")
        else:
            mv(p, os.path.join(M, "文案", name))
    if not DRY and os.path.isdir(SUB) and not os.listdir(SUB):
        os.rmdir(SUB)

# ---------- 6. 直接删除项 ----------
rm(os.path.join(ROOT, "路演与展示"), "重复PPT1第1份-整目录")
rm(os.path.join(D, "site-dist"), "构建产物-可重建")
rm(os.path.join(D, "启动.bat"), "GitHub同步脚本-与本地唯一副本冲突")
rm(os.path.join(M, "_历史", "保险创业赛-历史", "审查前-2026-10-28"), "同哈希审查前快照两份")
rm(os.path.join(M, "交付物", "PPT", "神麻组-雨证-路演PPT-答辩版-2026-10-28-968v5.pptx"), "同哈希改名副本")
rm(os.path.join(M, "交付物", "PPT", "神麻组-雨证-路演PPT-答辩版-2026-10-28-968v5.pdf"), "同哈希改名副本")
rm(os.path.join(M, "交付物", "PPT", "神麻组-雨证-项目计划书-2026-11-16x9-预览.pdf"), "同哈希改名副本")
if os.path.isdir(os.path.join(D, "_归档")):
    mv(os.path.join(D, "_归档"), os.path.join(D, "_历史", "_归档"))
rm(os.path.join(D, "_历史", "_归档", "b-probe-2026-10-13", "ppt_render"), "与ppt参考_ref_render同哈希两份")

# 08 截图同哈希重复
SH = os.path.join(D, "08-截图存证")
keep = os.path.join(SH, "2026-10-29-城市三模式与排版", "全站回归")
drop_dir = os.path.join(SH, "2026-10-29-v6迁移")
if os.path.isdir(keep) and os.path.isdir(drop_dir):
    kh = {}
    for f in os.listdir(keep):
        kh[hashlib.sha256(open(os.path.join(keep, f), "rb").read()).hexdigest()] = f
    for f in list(os.listdir(drop_dir)):
        fp = os.path.join(drop_dir, f)
        if os.path.isfile(fp) and hashlib.sha256(open(fp, "rb").read()).hexdigest() in kh:
            rm(fp, "截图重复-" + kh[hashlib.sha256(open(fp,'rb').read()).hexdigest()])

# 锁文件
for base, dirs, files in os.walk(D):
    if "node_modules" in base or ".git" in base:
        continue
    for f in files:
        if f.startswith("~$"):
            rm(os.path.join(base, f), "Office锁文件")

if not DRY:
    with open(LOG, "w", encoding="utf-8") as fh:
        for a in acts:
            fh.write(json.dumps(a, ensure_ascii=False) + "\n")
    print(f"\n已执行 {len(acts)} 个动作，日志 {LOG}")
else:
    print(f"\nDRY RUN：{len(acts)} 个动作未执行")
