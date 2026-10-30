const t=[["677 RPC","https://rpc.botchain.ai"],["968 RPC","https://rpc.bohr.life"],["677 scan","https://scan.botchain.ai"],["968 scan","https://scan.bohr.life"],["faucet","https://faucet.botchain.ai"],["demo page","https://juice-butterfly.github.io/rainproof/"],["sepolia","https://ethereum-sepolia-rpc.publicnode.com"]];
const mode = process.env.PROBE_MODE || "direct";
(async()=>{
  console.log("== mode="+mode+"  (env HTTPS_PROXY="+(process.env.HTTPS_PROXY||"-")+", NODE_USE_ENV_PROXY="+(process.env.NODE_USE_ENV_PROXY||"-")+") ==");
  for(const [n,u] of t){
    const st=Date.now();
    try{
      const r = n.includes("RPC")||n.includes("sepolia")
        ? await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]}),signal:AbortSignal.timeout(10000)})
        : await fetch(u,{signal:AbortSignal.timeout(10000)});
      let extra="";
      if(n.includes("RPC")||n.includes("sepolia")){ const j=await r.json(); extra=" chainId="+parseInt(j.result,16); }
      console.log("  "+(r.ok?"OK ":"HTTP"+r.status)+" "+(Date.now()-st)+"ms "+n+extra);
    }catch(e){ console.log("  FAIL "+(Date.now()-st)+"ms "+n+" : "+String(e.cause?.code||e.name||e.message).slice(0,60)); }
  }
})();
