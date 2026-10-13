import { describe, expect, it } from 'vitest';
import { kiraPricingError } from './kira-billing';

describe('Kira PostgreSQL errors through the production Drizzle wrapper', () => {
  it('reports an active saved checkout without exposing its query or suggesting another quote', () => {
    const error = new Error('Failed query: private checkout SQL and parameters', { cause: new Error('KIRA_CHECKOUT_ALREADY_ACTIVE') });
    expect(() => kiraPricingError(error)).toThrow('A Kira payment is already saved.');
    try { kiraPricingError(error); } catch (result) {
      expect(result).toMatchObject({ status: 409, code: 'CONFLICT', details: { reason: 'KIRA_CHECKOUT_ALREADY_ACTIVE', reaccept: false } });
      expect((result as Error).message).not.toContain('private');
    }
  });

  it('preserves expiration and discount causes through nested database wrappers', () => {
    for (const [message, reason] of [['KIRA_QUOTE_EXPIRED', 'KIRA_QUOTE_EXPIRED'], ['DISCOUNT_CANNOT_COMBINE', 'DISCOUNT_CANNOT_COMBINE']]) {
      const error = new Error('Failed query', { cause: new Error('Driver wrapper', { cause: new Error(message) }) });
      try { kiraPricingError(error); } catch (result) {
        expect(result).toMatchObject({ status: 409, details: { reason, reaccept: true } });
      }
    }
  });

  it('keeps unrelated failures and cyclic causes intact instead of treating SQL text as a pricing reason', () => {
    for (const error of [new Error('Failed query: KIRA_PRICE_CHANGED in SQL'), new Error('Connection failed')]) {
      error.cause = error;
      try { kiraPricingError(error); } catch (result) { expect(result).toBe(error); }
    }
  });
});
