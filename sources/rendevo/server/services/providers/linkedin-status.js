// The account status records a successful verification of the configured
// session, not the result of every subsequent network probe.
//
// Even HTTP 401 is not definitive proof that the underlying browser session
// expired: Voyager is an unsupported internal endpoint and may reject a
// repeated request, challenge the client or throttle requests. Never erase
// a previously verified status based on a single failed test.
export function linkedinVerificationChange(account, result) {
  if (!result.ok) return null;
  return {
    status: account.status === 'paused' ? 'paused' : 'active',
    detail: null,
    profile: result.profile || account.config?.profile || null,
  };
}
