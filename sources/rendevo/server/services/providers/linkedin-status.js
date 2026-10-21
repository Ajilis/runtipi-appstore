// Persistent changes are made only after an explicit account verification.
// Transient LinkedIn errors must not disconnect an otherwise working account.
export function linkedinVerificationChange(account, result) {
  if (result.ok) {
    return {
      status: account.status === 'paused' ? 'paused' : 'active',
      detail: null,
      profile: result.profile || account.config?.profile || null,
    };
  }
  if (result.invalid_session === true) {
    return {
      status: 'error',
      detail: result.detail || 'Session expirée. Renouvelez les cookies puis cliquez sur Tester.',
      profile: account.config?.profile || null,
    };
  }
  return null;
}
