import { sql } from 'drizzle-orm';
import { database, firstRow } from './database';
import { AppError } from './errors';
import { bachsConnectRequest, bachsPlatform, requireBachsConnect, bachsPayoutMode, checkedBachsPayout, koboToBachsNgn } from './bachs-connect';
import { bachsNgnToKobo } from './bachs';
import { decryptBankDetails, type BankEnvelope } from './bank-envelope';
import type { Bindings } from '../types';
type Settlement = {
    payout_id: string;
    user_id: string;
    university_id: string;
    bank_net_kobo: number;
    amount_kobo: number;
    recipient_code: string;
    connected_account_id: string;
    provider_mode: string;
    provider_reference: string;
    status: string;
    setup_id: string;
    bank_details_envelope: BankEnvelope;
    funding_amount_kobo: number | null;
    funding_transfer_id: string | null;
    funding_journal_id: string | null;
    provider_payout_id: string | null;
    actual_fee_kobo: number | null;
    recovery_transfer_id: string | null;
    recovery_amount_kobo: number | null;
    recovery_journal_id: string | null;
};
async function settlement(env: Bindings, payoutId: string) {
    const row = firstRow(await database(env).execute<Settlement>(sql `select s.*,p.status,q.account_setup_id as setup_id,a.bank_details_envelope,b.funding_amount_kobo,b.funding_transfer_id,b.funding_journal_id,b.provider_payout_id,b.actual_fee_kobo,b.recovery_transfer_id,b.recovery_amount_kobo,b.recovery_journal_id
 from app_private.agent_payout_settlements s join public.payout_requests p on p.id=s.payout_id join app_private.agent_payout_quotes q on q.id=s.quote_id join app_private.payout_account_setups a on a.id=q.account_setup_id left join app_private.bachs_payout_bridges b on b.payout_id=s.payout_id
 where s.payout_id=${payoutId}::uuid and s.provider='BACHS'`));
    if (!row || row.provider_mode !== bachsPayoutMode(env))
        throw new AppError(409, 'CONFLICT', 'This Bachs withdrawal does not match its saved provider environment.');
    return row;
}
function transferProof(value: Record<string, unknown>, expected: {
    source: string;
    destination: string;
    amount: number;
    group: string;
    id?: string;
}, allowPending = false) {
    if (typeof value.id !== 'string' || !/^tr_[A-Za-z0-9_-]{8,128}$/.test(value.id) || (expected.id && value.id !== expected.id) || value.source !== expected.source || value.destination !== expected.destination || value.currency !== 'NGN' || typeof value.amount !== 'string' || bachsNgnToKobo(value.amount) !== expected.amount || value.transfer_group !== expected.group || (value.status !== 'paid' && !(allowPending && value.status === 'pending')))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs has not confirmed the exact saved payout funding transfer. Its reference remains reserved.');
    return value.id;
}
async function validateDestination(env: Bindings, row: Settlement) {
    const bank = await decryptBankDetails(env, row.bank_details_envelope, row.user_id, row.university_id, row.setup_id);
    const [account, destination] = await Promise.all([bachsConnectRequest(env, '/v1/accounts/' + row.connected_account_id), bachsConnectRequest(env, '/v1/payouts/destinations/' + row.recipient_code, { accountId: row.connected_account_id })]);
    const caps = account.capabilities as Record<string, {
        status?: string;
    }> | undefined;
    if (account.id !== row.connected_account_id || caps?.payouts?.status !== 'active' || caps?.transfers?.status !== 'active' || destination.id !== row.recipient_code || destination.is_usable !== true || destination.currency !== 'NGN' || destination.account_number !== bank.accountNumber || destination.bank_code !== bank.bankCode || destination.account_name !== bank.accountName)
        throw new AppError(409, 'CONFLICT', 'Bachs has not approved the exact saved bank recipient. Keep this payout pending.');
    return account;
}
function fundingAmount(row: Settlement) {
    const gross = Number(row.amount_kobo), net = Number(row.bank_net_kobo);
    if (!Number.isSafeInteger(gross) || gross < net || gross <= 0 || gross > 1000000000)
        throw new AppError(409, 'CONFLICT', 'The approved funding amount does not match this withdrawal.');
    // NGN payouts do not use the FX quote endpoint. Fund the sealed gross
    // withdrawal, send the exact net to the bank, and recover the commission
    // remainder after Bachs reports its actual fee. No invented transfer charge.
    return gross;
}
export async function sendBachsAgentPayout(env: Bindings, payoutId: string) {
    if (env.PAYMENTS_ENABLED !== 'true' || env.PAYOUTS_ENABLED !== 'true')
        throw new AppError(503, 'FEATURE_DISABLED', 'New bank transfers are paused. This payout remains pending.');
    let row = await settlement(env, payoutId);
    await database(env).execute(sql `select * from app_private.prepare_ledger_transfer(${payoutId}::uuid,${row.university_id}::uuid)`);
    const platform = await requireBachsConnect(env), account = await validateDestination(env, row);
    if (account.parent_organization_id !== platform.id)
        throw new AppError(409, 'CONFLICT', 'This bank recipient does not belong to KampusOne.');
    if (row.funding_amount_kobo === null) {
        const amount = fundingAmount(row);
        await database(env).execute(sql `insert into app_private.bachs_payout_bridges(payout_id,funding_amount_kobo)values(${payoutId}::uuid,${amount}::bigint)on conflict(payout_id)do nothing`);
        row = await settlement(env, payoutId);
    }
    const funded = Number(row.funding_amount_kobo);
    if (!row.funding_journal_id) {
        if (!row.funding_transfer_id) {
            const ack = await bachsConnectRequest(env, '/v1/transfers', { key: row.provider_reference + ':fund', body: { destination: row.connected_account_id, amount: koboToBachsNgn(funded), currency: 'NGN', transfer_group: row.provider_reference, description: 'KampusOne approved earnings withdrawal' } });
            const transferId = transferProof(ack, { source: platform.id, destination: row.connected_account_id, amount: funded, group: row.provider_reference }, true);
            const saved = firstRow(await database(env).execute<{
                saved: boolean;
            }>(sql `update app_private.bachs_payout_bridges set funding_transfer_id=${transferId},updated_at=now()where payout_id=${payoutId}::uuid and(funding_transfer_id is null or funding_transfer_id=${transferId}) returning true as saved`));
            if (!saved)
                throw new AppError(409, 'CONFLICT', 'Another funding reference is already saved for this payout.');
            row = await settlement(env, payoutId);
        }
        const proof = await bachsConnectRequest(env, '/v1/transfers/' + row.funding_transfer_id);
        const transferId = transferProof(proof, { id: row.funding_transfer_id!, source: platform.id, destination: row.connected_account_id, amount: funded, group: row.provider_reference });
        await database(env).execute(sql `select app_private.record_bachs_payout_funding(${payoutId}::uuid,${transferId},${funded}::bigint,${row.connected_account_id})`);
    }
    if (!row.provider_payout_id) {
        const ack = checkedBachsPayout(await bachsConnectRequest(env, '/v1/payouts', { accountId: row.connected_account_id, key: row.provider_reference + ':bank', body: { destination: row.recipient_code, amount: koboToBachsNgn(Number(row.bank_net_kobo)), reference: row.provider_reference } }), { reference: row.provider_reference, destination: row.recipient_code, amountKobo: Number(row.bank_net_kobo) });
        const saved = firstRow(await database(env).execute<{
            saved: boolean;
        }>(sql `update app_private.bachs_payout_bridges set provider_payout_id=${ack.id},updated_at=now()where payout_id=${payoutId}::uuid and(provider_payout_id is null or provider_payout_id=${ack.id}) returning true as saved`));
        if (!saved)
            throw new AppError(409, 'CONFLICT', 'Another bank payout reference is already saved.');
    }
    // POST acknowledgement is not a payment receipt. Only an independent GET
    // can seal a paid journal or release a failed withdrawal.
    await reconcileBachsAgentPayout(env, payoutId);
    return { reference: row.provider_reference, status: firstRow(await database(env).execute<{
            status: string;
        }>(sql `select status from public.payout_requests where id=${payoutId}::uuid`))?.status ?? 'PROCESSING' };
}
async function recoverFunds(env: Bindings, row: Settlement) {
    const remaining = ['FAILED'].includes(row.status) ? Number(row.funding_amount_kobo) : Number(row.funding_amount_kobo) - Number(row.bank_net_kobo) - Number(row.actual_fee_kobo);
    if (row.recovery_journal_id || remaining <= 0)
        return;
    const platform = await bachsPlatform(env);
    let transferId = row.recovery_transfer_id, amount = Number(row.recovery_amount_kobo ?? remaining);
    if (!transferId) {
        if (row.recovery_amount_kobo === null) {
            const balances = await bachsConnectRequest(env, '/v1/balances', { accountId: row.connected_account_id });
            if (balances.account_id !== row.connected_account_id)
                throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs returned another recipient balance.');
            const rows = Array.isArray(balances.balances) ? balances.balances : Array.isArray(balances.items) ? balances.items : Array.isArray(balances.data) ? balances.data : [];
            const ngn = rows.find(v => v && v.currency === 'NGN');
            if (!ngn || typeof ngn.available_balance !== 'string')
                throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs payout recovery is awaiting a verified NGN balance.');
            amount = Math.min(remaining, bachsNgnToKobo(ngn.available_balance));
            if (amount <= 0 || row.status === 'FAILED' && amount < Number(row.bank_net_kobo))
                throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs has not returned the failed payout principal yet. Its recovery remains tracked.');
            await database(env).execute(sql `update app_private.bachs_payout_bridges set recovery_amount_kobo=${amount}::bigint where payout_id=${row.payout_id}::uuid and recovery_amount_kobo is null`);
            row = await settlement(env, row.payout_id);
            amount = Number(row.recovery_amount_kobo);
        }
        const ack = await bachsConnectRequest(env, '/v1/transfers', { accountId: row.connected_account_id, key: row.provider_reference + ':recover', body: { destination: 'self', amount: koboToBachsNgn(amount), currency: 'NGN', transfer_group: row.provider_reference, description: 'Recover unused approved payout funds' } });
        transferId = transferProof(ack, { source: row.connected_account_id, destination: platform.id, amount, group: row.provider_reference }, true);
        await database(env).execute(sql `update app_private.bachs_payout_bridges set recovery_transfer_id=${transferId},updated_at=now()where payout_id=${row.payout_id}::uuid and(recovery_transfer_id is null or recovery_transfer_id=${transferId})`);
    }
    const proof = await bachsConnectRequest(env, '/v1/transfers/' + transferId, { accountId: row.connected_account_id });
    if (typeof proof.amount !== 'string')
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs recovery amount could not be verified.');
    amount = bachsNgnToKobo(proof.amount);
    transferProof(proof, { id: transferId, source: row.connected_account_id, destination: platform.id, amount, group: row.provider_reference });
    await database(env).execute(sql `select app_private.record_bachs_payout_recovery(${row.payout_id}::uuid,${transferId},${amount}::bigint)`);
}
export async function reconcileBachsAgentPayout(env: Bindings, payoutId: string) {
    let row = await settlement(env, payoutId);
    if (!row.provider_payout_id) {
        await sendBachsAgentPayout(env, payoutId);
        return true;
    }
    if (!['PAID', 'FAILED'].includes(row.status)) {
        const data = await bachsConnectRequest(env, '/v1/payouts/' + row.provider_payout_id, { accountId: row.connected_account_id });
        const proof = checkedBachsPayout(data, { id: row.provider_payout_id, reference: row.provider_reference, destination: row.recipient_code, amountKobo: Number(row.bank_net_kobo) });
        const reason = typeof data.failure_reason === 'string' ? data.failure_reason.replace(/[\x00-\x1f]/g, ' ').replace(/[0-9]{6,}/g, '[redacted]').replace(/\S+@\S+/g, '[redacted]').trim().slice(0, 240) : null;
        const state = firstRow(await database(env).execute<{
            state: string;
        }>(sql `select app_private.record_bachs_agent_payout(${payoutId}::uuid,${proof.id},${Number(row.bank_net_kobo)}::bigint,${proof.feeKobo}::bigint,${row.recipient_code},${row.connected_account_id},${row.provider_mode},${proof.status},${proof.completedAt}::timestamptz) as state`))?.state;
        if (state !== 'REQUIRES_REVIEW' && reason)
            await database(env).execute(sql `update app_private.bachs_payout_bridges set provider_failure_reason=${reason} where payout_id=${payoutId}::uuid`);
        if (state === 'REQUIRES_REVIEW')
            throw new AppError(409, 'CONFLICT', 'The provider result differs from the sealed payout. Finance review is required.');
        row = await settlement(env, payoutId);
    }
    if (['PAID', 'FAILED'].includes(row.status))
        try {
            await recoverFunds(env, row);
        }
        catch {
            console.error(JSON.stringify({ event: 'payout.bachs_recovery_pending', payoutId }));
        }
    return true;
}
