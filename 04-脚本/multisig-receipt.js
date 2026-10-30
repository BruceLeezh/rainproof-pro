"use strict";
/** Use the receipt's own proposal, never a shared txCount observed before/after mining. */
function submittedTxId(ms, receipt, target, data) {
  const logs = receipt.logs.filter(log => log.address.toLowerCase() === String(ms.target).toLowerCase());
  for (const log of logs) {
    let event; try { event = ms.interface.parseLog(log); } catch { continue; }
    if (!event || event.name !== "Submitted") continue;
    if (event.args.target.toLowerCase() !== target.toLowerCase() || event.args.data.toLowerCase() !== data.toLowerCase() || event.args.value !== 0n) throw new Error("Multisig receipt payload mismatch");
    return event.args.txId;
  }
  throw new Error("Multisig receipt has no matching Submitted event");
}
module.exports = { submittedTxId };
