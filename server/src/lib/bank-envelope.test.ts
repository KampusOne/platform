import { describe, it, expect } from 'vitest';
import { encryptBankDetails, decryptBankDetails } from './bank-envelope';
import type { Bindings } from '../types';
const env = { KYC_ENCRYPTION_KEY: '71'.repeat(32) } as Bindings;
const details = { bankCode: '058', accountNumber: '0123456789', accountName: 'ADA TEST', contactEmail: 'fixture@example.invalid' };
describe('encrypted bank details', () => {
    it('round trips without leaving bank details in the envelope', async () => {
        const a = await encryptBankDetails(env, details, 'owner', 'campus', 'setup'), b = await encryptBankDetails(env, details, 'owner', 'campus', 'setup');
        expect(a.ciphertext).not.toBe(b.ciphertext);
        expect(JSON.stringify(a)).not.toContain(details.accountNumber);
        expect(await decryptBankDetails(env, a, 'owner', 'campus', 'setup')).toEqual(details);
    });
    it.each([['another-owner', 'campus', 'setup'], ['owner', 'another-campus', 'setup'], ['owner', 'campus', 'another-setup']])('rejects changing the owner, campus or setup binding', async (owner, campus, setup) => {
        const sealed = await encryptBankDetails(env, details, 'owner', 'campus', 'setup');
        await expect(decryptBankDetails(env, sealed, owner, campus, setup)).rejects.toThrow('could not be read securely');
    });
    it('rejects ciphertext tampering and a missing encryption key', async () => {
        const sealed = await encryptBankDetails(env, details, 'owner', 'campus', 'setup');
        await expect(decryptBankDetails(env, { ...sealed, ciphertext: (sealed.ciphertext[0] === 'A' ? 'B' : 'A') + sealed.ciphertext.slice(1) }, 'owner', 'campus', 'setup')).rejects.toThrow('could not be read securely');
        await expect(encryptBankDetails({} as Bindings, details, 'owner', 'campus', 'setup')).rejects.toThrow('Secure bank storage is unavailable');
    });
});
