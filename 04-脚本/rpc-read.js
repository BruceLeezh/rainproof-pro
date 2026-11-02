"use strict";

// Retry reads only. Never wrap transaction submission: a lost reply may already be mined.
const TRANSIENT = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|TIMEOUT|NETWORK_ERROR|socket hang up|fetch failed|HTTP (429|502|503|504)|too many requests/i;
function transient(error) {
  const text = [error?.code, error?.message, error?.shortMessage,
    error?.cause?.code, error?.cause?.message, error?.info?.error?.code,
    error?.info?.error?.message, error?.info?.responseStatus].filter(Boolean).join(" ");
  return TRANSIENT.test(text);
}
async function withRetry(read, { attempts = 4, delayMs = 500,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt + 1 >= attempts || !transient(error)) throw error;
      await sleep(delayMs * (attempt + 1));
    }
  }
}
function provider(ethers, url) {
  const request = new ethers.FetchRequest(url);
  request.timeout = 12000;
  return new ethers.JsonRpcProvider(request, undefined, { cacheTimeout: 0 });
}
module.exports = { withRetry, provider, transient };
