import type { Bindings } from '../types';
import { AppError } from './errors';
import { bachsNgnToKobo, koboToBachsNgn } from './bachs';
export const bachsAgentProvider = (env: Bindings) => env.BACHS_PRICED_CHECKOUT_ENABLED === 'true';
export function bachsPayoutMode(env: Bindings) {
    if (!/^sk_(live|sandbox)_[A-Za-z0-9_-]+$/.test(env.BACHS_API_KEY ?? ''))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs bank verification is not configured.');
    const live = env.BACHS_API_KEY!.startsWith('sk_live_');
    if ((env.ENVIRONMENT === 'production') !== live)
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The Bachs bank configuration does not match this environment.');
    return live ? 'live' as const : 'test' as const;
}
export async function bachsConnectRequest(env: Bindings, path: string, options: {
    body?: Record<string, unknown>;
    accountId?: string;
    key?: string;
} = {}) {
    const mode = bachsPayoutMode(env);
    if (options.accountId && !/^acct_[A-Za-z0-9_-]{8,128}$/.test(options.accountId))
        throw new AppError(409, 'CONFLICT', 'The saved Bachs recipient is invalid.');
    let response: Response;
    try {
        response = await fetch((mode === 'live' ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io') + path, { method: options.body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + env.BACHS_API_KEY, 'Content-Type': 'application/json', ...(options.accountId ? { 'X-Account-Id': options.accountId } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(10000) });
    }
    catch {
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs could not confirm this request. Its saved reference is kept; check its status before retrying.');
    }
    const value = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !value || Array.isArray(value)) {
        const code = typeof value?.error_code === 'string' && /^[a-zA-Z_]{1,80}$/.test(value.error_code) ? value.error_code : 'UNCLASSIFIED';
        const message = code === 'INSUFFICIENT_BALANCE' ? 'Bachs has not settled enough funds for this payout. The request remains pending.' : code === 'FORBIDDEN' ? 'Bachs has not enabled the required transfer permission. The request remains pending.' : response.status === 400 || response.status === 422 ? 'Bachs could not verify these bank details. Check the bank and account number.' : 'Bachs could not confirm this request. The saved reference remains available.';
        throw new AppError(response.status === 429 ? 429 : 503, response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', message, { provider: 'BACHS', providerCode: code, providerStatus: response.status });
    }
    return value;
}
export async function bachsPlatform(env: Bindings) {
    const value = await bachsConnectRequest(env, '/v1/accounts/me');
    if (typeof value.id !== 'string' || !/^acct_[A-Za-z0-9_-]{8,128}$/.test(value.id) || !Array.isArray(value.enabled_capabilities))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs platform permissions could not be verified.');
    return { id: value.id, connect: value.enabled_capabilities.includes('connect') };
}
export async function requireBachsConnect(env: Bindings) {
    const platform = await bachsPlatform(env);
    if (!platform.connect)
        throw new AppError(503, 'FEATURE_DISABLED', 'Bachs Connect is not enabled for KampusOne. Bank details can be saved, but agent transfers are awaiting provider activation.', { reason: 'BACHS_CONNECT_DISABLED' });
    return platform;
}
export async function bachsBanks(env: Bindings) {
    const data = await bachsConnectRequest(env, '/v1/reference/banks?country=NG');
    if (data.country !== 'NG' || !Array.isArray(data.banks))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The Nigerian bank list could not be confirmed.');
    return data.banks.map(v => { if (!v || typeof v !== 'object' || typeof v.code !== 'string' || !/^[0-9]{3,20}$/.test(v.code) || typeof v.name !== 'string' || !v.name.trim())
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs returned an incomplete bank list.'); return { code: v.code, name: v.name }; }).sort((a, b) => a.name.localeCompare(b.name));
}
export async function bachsBankName(env: Bindings, bankCode: string, accountNumber: string) {
    const data = await bachsConnectRequest(env, '/v1/misc/bank-accounts/resolve', { body: { country: 'NG', bank_code: bankCode, account_number: accountNumber } });
    if (data.resolved !== true || data.account_number !== accountNumber || typeof data.account_name !== 'string' || data.account_name.trim().length < 2)
        throw new AppError(400, 'BAD_REQUEST', 'Bachs could not resolve this account. Check the bank and account number.');
    return data.account_name.trim();
}
export async function provisionBachsBank(env: Bindings, setupId: string, details: {
    accountName: string;
    accountNumber: string;
    bankCode: string;
    contactEmail: string;
}) {
    const platform = await requireBachsConnect(env);
    const account = await bachsConnectRequest(env, '/v1/accounts', { key: 'k1-bank:' + setupId + ':account', body: { contact_email: details.contactEmail, display_name: details.accountName, country: 'NG', entity_type: 'individual', configuration: { recipient: { capabilities: { transfers: { requested: true }, payouts: { requested: true } } } } } });
    if (typeof account.id !== 'string' || !/^acct_[A-Za-z0-9_-]{8,128}$/.test(account.id) || account.parent_organization_id !== platform.id)
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs did not confirm this recipient belongs to KampusOne.');
    const names = details.accountName.split(/\s+/);
    if (names.length < 2)
        throw new AppError(409, 'CONFLICT', 'Your bank name needs an identity review before Bachs recipient setup.');
    await bachsConnectRequest(env, '/v1/accounts/' + account.id, { key: 'k1-bank:' + setupId + ':requirements', body: { fields: { persons: [{ first_name: names[0], last_name: names.slice(1).join(' '), relationship: { representative: true } }], payout_destination: { currency: 'NGN', type: 'bank_account', account_number: details.accountNumber, account_name: details.accountName, bank_code: details.bankCode } } } });
    const [current, destinations] = await Promise.all([bachsConnectRequest(env, '/v1/accounts/' + account.id), bachsConnectRequest(env, '/v1/payouts/destinations?limit=100', { accountId: account.id })]);
    const rows = Array.isArray(destinations.items) ? destinations.items : Array.isArray(destinations.data) ? destinations.data : Array.isArray(destinations.destinations) ? destinations.destinations : [];
    const destination = rows.find(v => v && typeof v === 'object' && v.currency === 'NGN' && v.bank_code === details.bankCode && v.account_number === details.accountNumber && v.account_name === details.accountName) as Record<string, unknown> | undefined;
    const capabilities = current.capabilities as Record<string, {
        status?: string;
    }> | undefined;
    if (!destination || typeof destination.id !== 'string' || !/^pd_[A-Za-z0-9_-]{8,128}$/.test(destination.id))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs did not return the exact saved bank destination.');
    return { connectedAccountId: account.id, destinationId: destination.id, usable: destination.is_usable === true && capabilities?.payouts?.status === 'active' && capabilities?.transfers?.status === 'active' };
}
export function checkedBachsPayout(value: Record<string, unknown>, expected: {
    reference: string;
    destination: string;
    amountKobo: number;
    id?: string;
}) {
    if (typeof value.id !== 'string' || !/^pay_[A-Za-z0-9_-]{8,128}$/.test(value.id) || (expected.id && value.id !== expected.id) || value.reference !== expected.reference || value.destination !== expected.destination || value.currency !== 'NGN' || value.source_currency !== 'NGN' || typeof value.amount !== 'string' || bachsNgnToKobo(value.amount) !== expected.amountKobo || typeof value.fee !== 'string' || typeof value.total_debited !== 'string' || bachsNgnToKobo(value.total_debited) !== expected.amountKobo + bachsNgnToKobo(value.fee) || !['pending', 'processing', 'completed', 'failed'].includes(String(value.status)))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The Bachs payout does not match its saved bank amount and destination. Keep it for finance review.');
    if (value.status === 'completed' && (typeof value.completed_at !== 'string' || !Number.isFinite(Date.parse(value.completed_at))))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Bachs completion evidence is incomplete.');
    return { id: value.id, status: String(value.status), feeKobo: bachsNgnToKobo(value.fee), completedAt: typeof value.completed_at === 'string' ? value.completed_at : null };
}
export { koboToBachsNgn };
