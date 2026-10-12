# RainProof — verifiable AI parametric rain cover for delivery riders

> Standalone English one-pager (executive summary) for the online/global submission.
> Provenance: this is the one-pager from `提交材料/B3-英文材料-一页纸与README摘要-2026-10-11.md` §1, exported as a standalone file by A on 2026-10-11, with three A-side corrections (marked ▸): the demo baseline is mainnet 677 (not 968), the offline snapshot fallback is now part of the product, and the source-verify / CI evidence added below. Everything else is B's wording, unchanged.

**One line:** We don't sell insurance — we sell settlement you can verify yourself.

### Problem

1. **A rainstorm stops the work, not just the rider.** Delivery riders are paid per order with no base wage; on a rainstorm day platforms shorten delivery windows and throttle dispatch, so income simply stops. Meituan stated on 2025-06-26 that it provides free heat-illness cover to 3 million riders — a platform-side, first-hand figure, quoted here as scale only.
2. **Existing research measures heat and accidents, not rain × income.** A 2024 HBR study of 1,272 riders and 580,000 orders in Shanghai and Hangzhou found delivery delays up 21.8% on heatwave days, with roughly CNY 545 extra earnings against roughly CNY 501 in health cost over two months. A 2024 Thai rider study (Epidemiol Health 46:e2024095, n=257) reports an odds ratio of 6.79 for accidents while riding in rain (95% CI 1.52–30.32, p=0.012). A 2024 study of 1,473 rider accidents in Xi'an found a +22.04% marginal severe-injury rate on wet roads. We found no direct study of rain and rider income; that gap is the space we work in.
3. **Loss adjustment costs about as much as the payout.** Manually establishing "did it rain, how much, and did the rider lose income" costs an industry order of magnitude of CNY 100–200, against payouts of tens of CNY. Insurers rationally decline to sell this product.

### Solution — four steps

1. **Buy** — the rider picks a city and a cover window; the contract freezes the on-chain cumulative rainfall at purchase time as the baseline (`rainfallAtBuy`), so only rainfall after the purchase counts.
2. **Feed** — the oracle writes cumulative rainfall with a confidence score, a source count and an evidence hash. The contract genuinely rejects feeds: confidence below 60, a cumulative value that decreases, or a feed older than the 24-hour freshness window.
3. **Judge** — three independent weather models (ECMWF, GFS, ICON) are cross-checked, and deterministic rules R1–R5 return PAY or DENY with a confidence score; the input hash and the output hash of the decision go on-chain. The LLM only writes a human-readable rationale, and that text never enters the hash.
4. **Payout** — when the on-chain increase crosses the tier line, with an AI decision of PAY and confidence of at least 60, anyone can call `claim()`. The money can only go to the rider's registered address, and the contract has no automatic trigger of its own.

### Why it is verifiable

Payout tiers, thresholds and caps are `constant`: after deployment they cannot be changed, not even by the deployer. Every price change emits an event carrying a rationale hash, so a third party can recompute how a price was derived. The verifier is a single file with no backend: it asks an RPC node directly and decodes raw `eth_getLogs` and `eth_getTransactionByHash` output, so no block explorer is required.

▸ **It stays usable when the RPC is not.** The demo page tries mainnet 677 first, then a read-only relay, then testnet 968, and finally falls back to a bundled snapshot of real 677 readings (block 25,950,600). When the snapshot is in use the page says so in its own banner — it never presents stale readings as live ones.

▸ **Anyone can rebuild the deployed bytecode.** The two deployed contracts have no imports, so the single source file *is* the flatten result; `07-测试工具/make-verify-pack.js` recompiles them with the pinned settings (solc `0.8.37+commit.f401782d`, optimizer on / 200 runs, EVM `paris`, `viaIR` for v3), checks the on-disk creation code byte-for-byte and the runtime length against the chain, and prints a manifest (`03-合约/verify-manifest.json`) with the SHA-256 of source, creation code and runtime, plus the constructor arguments for the multisig. A clean machine reproduces the same hashes; `npm test` runs 14 gates / 473 assertions locally and 472 in GitHub Actions, all green.

### On-chain status

| Chain | chainId | Version | Runtime code | Deploy transaction |
|---|---|---|---|---|
| Sepolia | 11155111 | v1 (phase-1 record) | 10,758 B | `0x197ef6ca029dd59df77e28951ed6eb0cd18b26fc20463fb2d0b1bdf882eaaf03` |
| BOT Chain Testnet | 968 | v2 (testnet trace) | 12,378 B | `0xa294f0293ab391b0ff458964333bc23a9109f8b72d31a905211b1c30e9e53515` |
| **BOT Chain Mainnet** | **677** | **v3 — demo baseline, deployed 2026-10-08** | **15,823 B** | `0x54fc1e694748338d63a2e9f6f46cf2c8623eaa141b71a10904a7b56dc3b9f436` |

Contract address on all three: `0x89e7C942535930B61cB61631051E8b0bD670596a` — the **same address is three different contracts** (each chain's deployer nonce started at 0), so an address must always be quoted together with its chainId. On 677 the operator is a 2-of-3 multisig, `0x676b791da72Ef072718c9f078377bF21be1b160f`; the pool holds 0.05105 BOT and no payout has settled there yet (3 purchases, 2 cooling-period refunds). The 968 pool holds 0.0643 BOT with six policies already paid. Explorer (mainnet): https://scan.botchain.ai/address/0x89e7C942535930B61cB61631051E8b0bD670596a — **on mainland China networks this link needs a proxy; a direct connection is blocked.**

### Honest boundaries

1. **One data source.** Rainfall comes from Open-Meteo public data. The three models give us a consistency check, not three independent vendors.
2. **The AI never decides the payout.** It verifies data trustworthiness and writes the explanation; the decision itself is deterministic rules, and the explanation is deliberately excluded from the hash.
3. **Two loss ratios, both true.** Under the earlier flat 0.001 ETH price, an equal-weight five-city portfolio shows a 53.8% loss ratio while Guangzhou alone shows 115.7%. That difference is exactly why pricing is now per city rather than flat.
4. **Feed freshness is bounded.** Feeds older than 24 hours are rejected at purchase, and the interval between two feeds is still a window we do not price.
5. **No live purchase on 677 right now.** The last mainnet feeds were written on 2026-10-09 10:12–10:18 (+0800) and have since passed the 24-hour window, so `buyPolicy` would revert `stale feed`; a fresh feed requires two of the three multisig owners, which we can schedule. The business runs on real rider flows, not on these demo transactions.
