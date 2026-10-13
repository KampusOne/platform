import type { Bindings } from '../types';
import { AppError } from './errors';
type BankDetails = {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    contactEmail: string;
};
export type BankEnvelope = {
    version: 1;
    nonce: string;
    ciphertext: string;
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function key(env: Bindings) {
    if (!/^[a-f0-9]{64}$/i.test(env.KYC_ENCRYPTION_KEY ?? ''))
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Secure bank storage is unavailable. Your saved bank details have not changed.');
    return crypto.subtle.importKey('raw', Uint8Array.from(env.KYC_ENCRYPTION_KEY!.match(/../g)!, v => parseInt(v, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const aad = (owner: string, campus: string, setup: string) => new TextEncoder().encode(`K1:BANK:v1:${owner}:${campus}:${setup}`);
export async function encryptBankDetails(env: Bindings, details: BankDetails, owner: string, campus: string, setup: string): Promise<BankEnvelope> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(owner, campus, setup) }, await key(env), new TextEncoder().encode(JSON.stringify(details)));
    return { version: 1, nonce: encode(nonce), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function decryptBankDetails(env: Bindings, envelope: BankEnvelope, owner: string, campus: string, setup: string): Promise<BankDetails> {
    try {
        if (envelope.version !== 1)
            throw Error('version');
        const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce), additionalData: aad(owner, campus, setup) }, await key(env), decode(envelope.ciphertext));
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (!/^[0-9]{10}$/.test(value.accountNumber) || !/^[0-9]{3,20}$/.test(value.bankCode) || typeof value.accountName !== 'string' || typeof value.contactEmail !== 'string')
            throw Error('shape');
        return value;
    }
    catch {
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The saved bank details could not be read securely. Keep this request pending for review.');
    }
}
