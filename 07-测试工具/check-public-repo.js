// 公开仓库合规自检 —— 这个仓库是 public 的，本脚本保证「不该公开的东西」没进去。
//
// 四类断言（全部基于 git 跟踪的清单，不看未跟踪/被 ignore 的本地文件）：
//   ① 禁止入库清单：主办方材料与本地密钥文件绝不能出现在跟踪列表里
//   ② 没有任何「看起来是私钥」的赋值被跟踪（PRIVATE_KEY = 0x<64 hex>）
//   ③ 被跟踪的文本文件里没有中国大陆手机号 / 身份证号
//      —— 「不能是更长 token 的一部分」：前后紧邻数字或字母的一律排除。
//      没有这条就会把 0.051239317305124842 这种 18 位小数当成身份证号（真踩过）。
//   ④ 若本地存在 04-脚本/.env*（.env.example 除外），把其中**形状像密钥的值**（0x+64 hex / 12 词助记词 /
//      其它长且非 URL、非地址的串）拿去反查全部被跟踪文件，必须 0 命中（拿不到 .env* 时打印「跳过」并单独
//      计数 —— CI 里本来就没有 .env，SKIP 不算失败，但也不再混进「通过」里假装跑过）
//
// 背景：2026-10-11 实测发现 01-赛事资料/handbook_v0.8.txt:255 里有主办方联系人姓名+手机号+微信，
// 而仓库是公开的。这条检查就是为了让同类问题不可能再悄悄进仓库一次。
//
// 跑法：node 07-测试工具/check-public-repo.js   （挂在 07-测试工具/npm test 里）
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0, skip = 0;
const ok = (t, c, x = "") => { if (c) { pass++; console.log("  [OK] " + t); } else { fail++; console.log("  [FAIL] " + t + (x ? "  -> " + x : "")); } };

// 本机 git 不一定在 PATH 上（开发机用的是 D:\Claude\Git\cmd\git.exe），逐个候选试
function gitExe() {
  const cands = [process.env.GIT_EXE, "git", "D:\\Claude\\Git\\cmd\\git.exe", "/usr/bin/git"].filter(Boolean);
  for (const c of cands) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* 试下一个 */ }
  }
  throw new Error("找不到 git 可执行文件（设 GIT_EXE 环境变量指定）");
}
const GIT = gitExe();
// 命中返回 stdout；git grep 无命中时退出码是 1，这不是错误
function gitGrep(args) {
  const r = spawnSync(GIT, ["-C", ROOT, "grep", ...args], { encoding: "utf8" });
  if (r.status === 1 && !r.stdout) return "";
  if (r.status !== 0 && r.status !== 1) throw new Error((r.stderr || "").trim() || "git grep 失败");
  return r.stdout || "";
}

// 手机号/身份证：前后不能紧邻数字或拉丁字母（这样哈希、小数、长数字串里的片段都不算）
const RE_PHONE = /(?<![\dA-Za-z])(1[3-9]\d{9})(?![\dA-Za-z])/;
const RE_IDCARD = /(?<![\dA-Za-z.])(\d{17}[\dXx])(?![\dA-Za-z])/;

const tracked = execFileSync(GIT, ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
console.log(`\n[公开仓库自检] 被跟踪文件 ${tracked.length} 个\n`);

// ① 禁止入库清单
console.log("[① 禁止入库清单]");
{
  const banned = [
    { re: /^01-赛事资料\//, why: "主办方材料（含他人联系方式），不是我们的作品" },
    { re: /(^|\/)\.env$/, why: "本地环境变量（含私钥）" },
    { re: /_local_chain\.json$/, why: "本地彩排链快照（含明文私钥）" },
  ];
  for (const b of banned) {
    const hit = tracked.filter(f => b.re.test(f));
    ok(`${b.re.source} 不在跟踪列表里`, hit.length === 0, hit.slice(0, 3).join(", ") + (hit.length > 3 ? ` …共 ${hit.length} 个` : "") + ` —— ${b.why}`);
  }
  const keyFiles = tracked.filter(f => !/\.env\.example$/.test(f) && /\.(key|pem|p12|jks)$/i.test(f));
  ok("没有 *.key / *.pem / *.p12 被跟踪", keyFiles.length === 0, keyFiles.join(", "));
}

// ② 私钥赋值
console.log("\n[② 私钥赋值]");
{
  const out = gitGrep(["-I", "-n", "-E", "(PRIVATE_KEY|SECRET_KEY|MNEMONIC|SEED_PHRASE)[[:space:]]*[:=][[:space:]]*0x[0-9a-fA-F]{64}"]);
  ok("没有 PRIVATE_KEY/SECRET_KEY/MNEMONIC = 0x…64 的赋值", out.trim() === "", out.trim().split("\n").slice(0, 3).join(" | "));
}

// ③ 个人信息（手机号 / 身份证），排除更长 token 里的片段
console.log("\n[③ 个人信息]");
{
  const out = gitGrep(["-I", "-n", "-E", "1[3-9][0-9]{9}|[0-9]{17}[0-9Xx]"]);
  const lines = out.split("\n").filter(Boolean);
  const real = lines.filter(l => RE_PHONE.test(l) || RE_IDCARD.test(l));
  ok("被跟踪的文本文件里没有手机号 / 身份证号", real.length === 0, real.slice(0, 3).join("\n            "));
  if (real.length === 0) console.log(`  （粗筛命中 ${lines.length} 行，都属于十六进制串/长小数的一部分，已按 token 边界排除）`);
}

// ④ 用 .env 里的真值反查（最硬的一条）
console.log("\n[④ 真实密钥反查]");
{
  // 覆盖 04-脚本/ 下所有 .env*（.env.local / .env.v3 之类同样是真密钥），但排除 .env.example
  const envDir = path.join(ROOT, "04-脚本");
  const envFiles = (fs.existsSync(envDir) ? fs.readdirSync(envDir) : [])
    .filter(f => /^\.env/.test(f) && !/\.example$/.test(f))
    .map(f => path.join(envDir, f))
    .filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  if (envFiles.length === 0) {
    skip++;   // SKIP 单列，不混进 pass：这条从未真正执行过，不能打印成「通过」
    console.log("  [SKIP] 04-脚本/ 下没有 .env*（CI 环境正常如此），本项未执行 —— 不算失败，也不算通过");
  } else {
    // 只挑「形状像密钥」的值：URL 和 40 位地址本来就要出现在文档里，不算秘密
    const isSecret = (v) =>
      /^0x[0-9a-fA-F]{64}$/.test(v) ||
      /^(?:[a-z]{3,}\s+){11,}[a-z]{3,}$/.test(v) ||
      (v.length >= 32 && !/^https?:\/\//i.test(v) && !/^0x[0-9a-fA-F]{40}$/.test(v));
    const secrets = [];
    for (const envFile of envFiles) {
      for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || !t.includes("=")) continue;
        const name = t.slice(0, t.indexOf("=")).trim();
        const val = t.slice(t.indexOf("=") + 1).trim();
        if (isSecret(val)) secrets.push({ name: `${path.basename(envFile)}:${name}`, val });
      }
    }
    let leaked = [];
    for (const s of secrets) {
      const out = gitGrep(["-I", "-l", "-F", "-e", s.val]);
      if (out.trim()) leaked.push(`[${s.name}] → ` + out.trim().split("\n").slice(0, 3).join(", "));
    }
    console.log(`  （${envFiles.map(f => path.basename(f)).join(", ")} 里被判为「密钥形状」的变量：${secrets.map(s => s.name).join(", ") || "无"}）`);
    ok(`${envFiles.length} 个 .env* 里 ${secrets.length} 个密钥形状的值在被跟踪文件里 0 命中`, leaked.length === 0, leaked.join("\n            "));
  }
}

console.log(`\n通过 ${pass} 项 · 跳过 ${skip} 项 · 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
