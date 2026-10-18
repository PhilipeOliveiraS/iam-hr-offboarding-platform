// Fixed demo targets. Never derive an account ID from visitor input.
export const SYNTHETIC_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  "john.carter@demo-corp.com": "iamhr-john-carter",
  "sarah.connor@demo-corp.com": "iamhr-sarah-connor",
  "tchalla.udaku@demo-corp.com": "iamhr-tchalla-udaku",
  "ellen.ripley@demo-corp.com": "iamhr-ellen-ripley",
  "arthur.dent@demo-corp.com": "iamhr-arthur-dent",
  "marty.mcfly@demo-corp.com": "iamhr-marty-mcfly",
  "dana.scully@demo-corp.com": "iamhr-dana-scully"
});

export function isSyntheticEmail(email: string): boolean {
  return Object.hasOwn(SYNTHETIC_TARGETS, email);
}
