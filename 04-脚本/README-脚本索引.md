# 04-脚本 索引：该跑哪个、哪个别碰

> 只列**会被人手动执行**的脚本。`04-脚本` 里还有 `activate-v6.js`、`canonical.js`、`regions.js`、`active-deployment.js` 这类被 require 的库，不单独跑。

## 现行（V6，2026-10-31 起）

| 用途 | 命令 | 说明 |
|---|---|---|
| 喂价（定时任务跑的就是它） | `node push-rainfall-v6.js --send` | 计划任务 `RainProof-Feed` 每 30 分钟；单次不带 `--send` 是干跑 |
| 补运营钱包 gas | `node fund-v6-ops-gas.js --send` | 任务里排在喂价前，低于 0.5 BOT 才发交易 |
| 理赔扫描 | `node keeper.js` | 计划任务 `RainProof-Keeper-V6`；`--once --dry-run` 单次干跑 |
| 开盘前自检 | `node preflight.js` | 三条计划任务 + 链上读数 + 钱包余额，全绿才上台 |
| 迁移核对 | `node inspect-v6-migration.js` | 只读 |
| 数据源体检 | `node datasource-health.js` | 三模型受理率 / 离散度 / 留档数 |
| 预警哨兵 | `node warning-watch.js --watch=30` | 分钟；不常驻就单跑一轮 |
| 批量代付投保 | `node batch-buy.js --city=420100 --hours=12 --file=名单.txt` | 平台代付，V6 `buyFor` |
| 定价表重算 | `node hubei-pricing.js` | 出 118 区划 236 格 |

## 历史（保留，勿在新流程里用）

| 文件 | 为什么还留着 |
|---|---|
| `push-rainfall-v5.js` / `push-rainfall.js` / `push-rainfall-hourly.js` | V5/V3 合约的喂价器；`rider-v5.html` 演示与旧留痕复核要用 |
| `setgrid-v3/v4/v5.js`、`deploy-v4.js`、`deploy-v5.js`、`set-premium.js` | 旧合约开盘脚本，对 V6 必失败 |
| `hook-watch.js`、`feed-verify.js`、`feed-window.js`、`reprice-review.js`、`shardate.js`、`rehearse-v2.js`、`replay-judgement.js` | V3/V4 时代的辅助工具 |
| `_patch-*.js`、`_fix-runbook-g19.js`、`_gen-v5.js` | **已移到 `12-开发归档/2026-10-31/脚本-一次性补丁/`**（一次性施工脚本，重跑会因锚点已变失败） |

## 铁律

- 任何 `--send` 都是真上链。先不带 `--send` 干跑。
- 私钥只在 `../密钥-本地/` 与 `04-脚本/.env`，永不进仓库、不打屏。
- 计划任务的 `.ps1` 必须存成 **UTF-8 BOM**，否则中文路径会变乱码、任务静默退出 1。
