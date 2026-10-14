/** A navigation reference is never proof of payment; the owned API receipt is. */
export function validPaymentReference(value: unknown): value is string {
  return typeof value === 'string' && /^K1-(?:B-)?(?:AI|O|T|M|L|RC)-[A-Za-z0-9-]{1,80}$/.test(value);
}

export function paymentReturnPath(reference?: unknown) {
  return validPaymentReference(reference)
    ? '/payment-return?reference=' + encodeURIComponent(reference)
    : '/payment-return';
}

export function nativePaymentReturnUrl(reference?: unknown) {
  return 'kampusone://' + paymentReturnPath(reference);
}

/** Accept current app links and callbacks already issued by previous versions. */
export function normalizePaymentReturn(path: string): string | null {
  try {
    const url = new URL(path, 'kampusone:///');
    if (url.username || url.password) return null;
    const native = url.protocol === 'kampusone:';
    const web = url.protocol === 'https:' && url.hostname === 'links.kampusone.app' && !url.port;
    if (!native && !web) return null;
    const route = (native ? url.hostname : '') + url.pathname;
    if (!['payment-return', '/payment-return', 'payment/return', '/payment/return'].includes(route.replace(/\/$/, ''))) return null;
    const references = [...url.searchParams.getAll('reference'), ...url.searchParams.getAll('trxref')];
    const reference = references[0];
    return paymentReturnPath(references.length > 0 && references.every(value => value === reference) ? reference : undefined);
  } catch {
    return null;
  }
}
