/** Expo's Android fromCombined bridge takes bytes, even when its JS type permits base64. */
export function snapshotCiphertextBytes(base64: string): Uint8Array {
  if (!base64 || base64.length > 768 * 1024 || base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64))
    throw new Error('Invalid encrypted snapshot');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const firstPadding = base64.indexOf('=');
  if (firstPadding !== -1 && firstPadding !== base64.length - padding)
    throw new Error('Invalid encrypted snapshot');
  const bytes = new Uint8Array(base64.length / 4 * 3 - padding);
  let offset = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const a = alphabet.indexOf(base64[i]!), b = alphabet.indexOf(base64[i + 1]!);
    const c = base64[i + 2] === '=' ? 0 : alphabet.indexOf(base64[i + 2]!);
    const d = base64[i + 3] === '=' ? 0 : alphabet.indexOf(base64[i + 3]!);
    bytes[offset++] = (a << 2) | (b >> 4);
    if (offset < bytes.length) bytes[offset++] = (b << 4) | (c >> 2);
    if (offset < bytes.length) bytes[offset++] = (c << 6) | d;
  }
  if (bytes.length < 28) throw new Error('Incomplete encrypted snapshot');
  return bytes;
}
