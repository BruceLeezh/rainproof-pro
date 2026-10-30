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
  root.RainproofRuntime = { esc, addresses, wallet, provider };
  if (typeof module !== "undefined") module.exports = root.RainproofRuntime;
})(typeof window === "undefined" ? globalThis : window);
