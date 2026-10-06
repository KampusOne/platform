// Google Play builds are consumption-only until Play Billing is connected.
// The website and directly distributed APK keep their existing Paystack flow.
export function isPlayDistribution(platform: string, distribution: string | undefined): boolean {
  return platform === 'android' && distribution === 'play';
}
