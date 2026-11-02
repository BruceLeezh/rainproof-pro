/* Shared, dependency-free guards for rider and platform transactions. */
(function (root) {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  function addresses(text, ethers) {
    const rows = text.trim().split(/[\s,，]+/).filter(Boolean);
    if (!rows.length) throw new Error("请填写骑手地址名单");
    const seen = new Set();
    return rows.map((row, i) => {
      if (!ethers.isAddress(row) || /^0x0{40}$/i.test(row)) throw new Error(`第 ${i + 1} 个地址无效`);
      const addr = ethers.getAddress(row);
      if (seen.has(addr.toLowerCase())) throw new Error(`第 ${i + 1} 个地址重复，请先去重`);
      seen.add(addr.toLowerCase());
      return addr;
    });
  }
  async function wallet(ethers, ethereum, rpc) {
    if (!ethereum) throw new Error("未检测到钱包，请先连接钱包");
    await ethereum.request({ method: "eth_requestAccounts" });
    if (Number(await ethereum.request({ method: "eth_chainId" })) !== 968) {
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3c8" }] });
      } catch (error) {
        if (Number(error.code) !== 4902) throw error; // 用户拒绝时不再次弹出添加网络
        await ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: "0x3c8", chainName: "BOT Chain Testnet",
          nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
          rpcUrls: [rpc], blockExplorerUrls: ["https://scan.bohr.life"]
        }] });
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3c8" }] });
      }
    }
    if (Number(await ethereum.request({ method: "eth_chainId" })) !== 968) throw new Error("请切换到测试网 968 后重试");
    return new ethers.BrowserProvider(ethereum).getSigner();
  }
  function provider(ethers, url) {
    const request = new ethers.FetchRequest(url);
    request.timeout = 10000;
    return new ethers.JsonRpcProvider(request);
  }
  function feedState(lastFeed, maxAge, now) {
    const last = Number(lastFeed), max = Number(maxAge), timestamp = Number(now);
    if (![last, max, timestamp].every(Number.isSafeInteger) || last <= 0 || max <= 0 || timestamp < last) {
      return { available: false, tone: "red", label: "喂价未确认 · 暂不可投保" };
    }
    const age = timestamp - last;
    if (age > max) return { available: false, tone: "red", label: "喂价已过期 · 暂不可投保" };
    return { available: true, tone: age > max - 4 * 3600 ? "warn" : "gold",
      label: `喂价 ${(age / 3600).toFixed(1)}h 前${age > max - 4 * 3600 ? " · 临近保鲜期" : ""}` };
  }
  async function feedStatus(contract, regionId) {
    const reader = contract.runner.provider || contract.runner;
    const [last, max, block, paused, region, risk] = await Promise.all([
      contract.lastFeedAt(regionId), contract.MAX_FEED_AGE(), reader.getBlock("latest"),
      contract.paused(), contract.regions(regionId), contract.riskLevel(regionId)
    ]);
    if (!block) throw new Error("无法确认最新区块，请稍后重试");
    if (paused) return { available: false, tone: "red", label: "投保已暂停，请稍后重试" };
    if (!region.active) return { available: false, tone: "red", label: "该区划暂未开放投保" };
    if (Number(risk) === 2) return { available: false, tone: "red", label: "该区划暂停承保" };
    return feedState(last, max, block.timestamp);
  }
  root.RainproofRuntime = { esc, addresses, wallet, provider, feedState, feedStatus };
  if (typeof module !== "undefined") module.exports = root.RainproofRuntime;
})(typeof window === "undefined" ? globalThis : window);
