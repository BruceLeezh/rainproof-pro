"use strict";

function assertV6PayDecision(decision) {
  // V6 accepts a judgement only inside coverage and only once. A DENY at
  // any accepted time can consume the slot before the final rain is known.
  if (BigInt(decision) !== 1n) {
    throw new Error("V6 只提交可赔判定：拒赔或未达线结果仅留痕，到期未达标的保单按合约规则到期结算");
  }
}

async function assertV6Payable(contract, args, block) {
  const [policyId, decision, confidence, sources, reading] = args.map(BigInt);
  assertV6PayDecision(decision);
  const at = { blockTag: block.number };
  const [policy, judgement, minimumConfidence] = await Promise.all([
    contract.policies(policyId, at), contract.judgements(policyId, at), contract.MIN_CONFIDENCE(at),
  ]);
  const now = BigInt(block.timestamp);
  if (!policy.exists || policy.settled || policy.paid || !policy.anchored || judgement.exists
      || now < policy.effectiveFrom || now > policy.endTime) {
    throw new Error("V6 保单不在可提交判定的保障状态");
  }
  if (confidence < minimumConfidence || confidence > 100n || sources < 2n) {
    throw new Error("V6 判定置信度或来源数不足以给付");
  }
  const rainfall = await contract.rainfall(policy.regionId, at);
  if (reading < policy.rainfallAtBuy || reading > rainfall
      || reading - policy.rainfallAtEffective < policy.thresholdMm) {
    throw new Error("V6 判定读数无效或未达给付档线，保留本单后续判定机会");
  }
  return { policy, rainfall };
}

module.exports = { assertV6PayDecision, assertV6Payable };
