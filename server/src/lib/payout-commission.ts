export type WithdrawalCommissionTier = {
    upToKobo: number | null;
    basisPoints: number;
};
export const withdrawalCommissionTiers: WithdrawalCommissionTier[] = [
    { upToKobo: 1000000, basisPoints: 800 },
    { upToKobo: 5000000, basisPoints: 600 },
    { upToKobo: null, basisPoints: 500 },
];
/** Graduated bands avoid fee cliffs and make splitting a withdrawal no cheaper. */
export function withdrawalCommission(amountKobo: number, tiers: WithdrawalCommissionTier[] = []) {
    if (!Number.isSafeInteger(amountKobo) || amountKobo < 0 || amountKobo > 1000000000)
        throw new RangeError('Choose a valid withdrawal amount.');
    if (!tiers.length)
        return 0;
    if (tiers.length > 8 || tiers.at(-1)?.upToKobo !== null)
        throw new RangeError('The withdrawal commission policy is incomplete.');
    let previous = 0, previousRate = 800, weighted = 0n;
    for (const [index, tier] of tiers.entries()) {
        if (!Number.isSafeInteger(tier.basisPoints) || tier.basisPoints < 500 || tier.basisPoints > previousRate ||
            tier.upToKobo === null && index !== tiers.length - 1 || tier.upToKobo !== null && (!Number.isSafeInteger(tier.upToKobo) || tier.upToKobo <= previous))
            throw new RangeError('The withdrawal commission policy is invalid.');
        const end = tier.upToKobo ?? amountKobo;
        weighted += BigInt(Math.max(0, Math.min(amountKobo, end) - previous)) * BigInt(tier.basisPoints);
        previous = end;
        previousRate = tier.basisPoints;
    }
    return Number((weighted + 5000n) / 10000n);
}
