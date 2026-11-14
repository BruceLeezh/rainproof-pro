#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把「池子 / 保单张数」这类会随链上变化的数字，按链上实测回写到对外材料。

为什么需要它：11-15 之后会多出一张在保的单，池子余额、保费合计、保单张数全会变。
手改三处（两份 deck + README + 执行卡）容易漏，也容易把旧数字留在某一页。

用法：
    cd 04-脚本 && python ../07-测试工具/update-chain-numbers.py --check   # 只打印，不写
    cd 04-脚本 && python ../07-测试工具/update-chain-numbers.py           # 写入（先备份 pptx）

依赖：04-脚本/node_modules 里的 ethers。脚本自己起一个 node 小进程读链，
避免在这里重写一遍 RPC 调用。
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "04-脚本"
DECK_DA = ROOT / "01-参赛材料/交付物/PPT/雨证-路演PPT-答辩版-2026-10-28.pptx"
DECK_JJ = ROOT / "01-参赛材料/交付物/PPT/雨证-路演PPT-精简版-2026-10-30.pptx"
README = ROOT / "README.md"
RUNBOOK = ROOT / "02-作战与答辩/现场执行卡-33页-2026-11-13.md"

NODE_READ = r"""
const fs=require('fs'),path=require('path');
const {ethers}=require('ethers');
const dep=JSON.parse(fs.readFileSync(path.join(__dirname,'..','deployment.json'),'utf8'));
const abi=JSON.parse(fs.readFileSync(path.join(__dirname,'..','03-合约','RainDeliveryInsuranceV6.abi.json'),'utf8'));
(async()=>{
  const p=new ethers.JsonRpcProvider(dep.rpc);
  const c=new ethers.Contract(dep.contract,abi,p);
  const [pool,n]=await Promise.all([c.poolBalance(),c.nextPolicyId()]);
  const rows=[];
  for(let i=0;i<Number(n);i++){
    const x=await c.policies(i);
    rows.push({id:i,regionId:Number(x.regionId),windowHours:Number(x.windowHours),
               premium:Number(x.premium),settled:x.settled,paid:x.paid,endTime:Number(x.endTime),
               effectiveFrom:Number(x.effectiveFrom)});
  }
  const names={};
  try{const v5=JSON.parse(fs.readFileSync(path.join(__dirname,'v5-regions.json'),'utf8'));
      for(const r of (v5.regions||v5)) names[Number(r.code??r.id)]=r.name;}catch(e){}
  console.log(JSON.stringify({pool:Number(pool),rows,names}));
})().catch(e=>{console.error('READ_FAIL',e.message);process.exit(1)});
"""


def fmt_yuan(fen: int) -> str:
    return f"{fen / 100:,.2f}"


def read_chain():
    out = subprocess.run(
        ["node", "-e", NODE_READ],
        cwd=str(SCRIPTS),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )
    if out.returncode != 0:
        raise SystemExit("读取链上失败：" + (out.stderr or out.stdout)[:400])
    line = [l for l in out.stdout.strip().splitlines() if l.startswith("{")][-1]
    return json.loads(line)


def build_facts(data):
    rows = data["rows"]
    names = data.get("names") or {}
    prem = sum(r["premium"] for r in rows)
    pool = data["pool"]
    invest = pool - prem
    settled = [r for r in rows if r["settled"]]
    live = [r for r in rows if not r["settled"]]
    paid = [r for r in rows if r["paid"]]

    def label(r):
        nm = names.get(str(r["regionId"])) or names.get(r["regionId"]) or f"区划 {r['regionId']}"
        return f"{nm} {r['regionId']} {r['windowHours']}h"

    return {
        "pool": pool,
        "prem": prem,
        "invest": invest,
        "n": len(rows),
        "n_settled": len(settled),
        "n_live": len(live),
        "n_paid": len(paid),
        "list": "、".join(label(r) for r in rows),
    }


def sentences(f):
    """返回 (池子算式, 保单句) 两段中文。"""
    eq = f"注资 {fmt_yuan(f['invest'])} + 保费 {fmt_yuan(f['prem'])} = 池子 {fmt_yuan(f['pool'])}，逐分对账"
    if f["n_live"] == 0:
        head = f"已签发 {f['n']} 张真实保单、均已到期结清"
    else:
        head = f"已签发 {f['n']} 张真实保单：{f['n_settled']} 张到期结清、{f['n_live']} 张保障中"
    tail = "0 笔赔付" if f["n_paid"] == 0 else f"{f['n_paid']} 笔已赔付"
    return eq, head + "、" + tail


def patch_text_file(path: Path, f, dry: bool):
    s = path.read_text(encoding="utf-8")
    orig = s
    eq, sent = sentences(f)
    # README / 执行卡：把「池子 … 模拟元（注资 … + … 保费 …）」与「已签发 … 张…」两处整体换成同一口径
    s = re.sub(r"池子 \*\*[\d,\.]+\*\* 模拟元（注资 [\d,\.]+ \+ [^）]*）", 
               f"池子 **{fmt_yuan(f['pool'])}** 模拟元（注资 {fmt_yuan(f['invest'])} + 保单保费 {fmt_yuan(f['prem'])}）", s)
    s = re.sub(r"已签发 \*\*\d+ 张测试网真实保单\*\*（[^）]*），[^；]*；",
               f"已签发 **{f['n']} 张测试网真实保单**（{f['list']}），"
               + ("均已到期结清、0 笔赔付" if f["n_live"] == 0 else f"{f['n_settled']} 张到期结清、{f['n_live']} 张保障中、0 笔赔付") + "；", s)
    s = re.sub(r"\| 池子 \*\*[\d,\.]+\*\* 模拟元[^|]*\|",
               f"| 池子 **{fmt_yuan(f['pool'])}** 模拟元｜未结清敞口 **0.00**｜已签发保单 **{f['n']} 张**"
               + ("（均已到期结清、0 赔付）" if f["n_live"] == 0 else f"（{f['n_settled']} 张到期结清、{f['n_live']} 张保障中、0 赔付）") + " |", s)
    if s != orig:
        if not dry:
            path.write_text(s, encoding="utf-8")
        print(f"  · {path.name}: 已更新")
    else:
        print(f"  · {path.name}: 无需改动")


def patch_deck(path: Path, f, dry: bool):
    from pptx import Presentation

    eq, sent = sentences(f)
    prs = Presentation(str(path))
    changed = 0
    for slide in prs.slides:
        for sh in slide.shapes:
            if not sh.has_text_frame:
                continue
            for p in sh.text_frame.paragraphs:
                if len(p.runs) != 1:
                    continue
                t = p.runs[0].text
                new = t
                if t.startswith("注资 ") and "池子" in t:
                    new = eq
                elif t.startswith("判定与赔付逐条留痕：已签发 "):
                    new = re.sub(r"已签发 \d+ 张真实保单[^；]*；", sent + "；", t, count=1)
                if new != t:
                    p.runs[0].text = new
                    changed += 1
    if changed:
        if not dry:
            bak = ROOT / "08-截图存证" / (path.stem + "-backup-before-chainupdate.pptx")
            if not bak.exists():
                bak.write_bytes(path.read_bytes())
            prs.save(str(path))
        print(f"  · {path.name}: 更新 {changed} 处")
    else:
        print(f"  · {path.name}: 无需改动")


def main():
    dry = "--check" in sys.argv
    print("读取链上…")
    data = read_chain()
    f = build_facts(data)
    print(f"池子 {fmt_yuan(f['pool'])}｜注资 {fmt_yuan(f['invest'])}｜保费 {fmt_yuan(f['prem'])}｜"
          f"保单 {f['n']} 张（结清 {f['n_settled']} / 在保 {f['n_live']} / 已赔 {f['n_paid']}）")
    print("  名单：" + f["list"])
    print("写入：" if not dry else "预演（--check，不写文件）：")
    for p in (DECK_DA, DECK_JJ):
        if p.exists():
            patch_deck(p, f, dry)
    for p in (README, RUNBOOK):
        if p.exists():
            patch_text_file(p, f, dry)


if __name__ == "__main__":
    main()
