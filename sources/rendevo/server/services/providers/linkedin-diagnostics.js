// A bounded, display-only verification record. Never copy upstream headers,
// response bodies, cookie values or exception messages into the database.
export const LINKEDIN_CHECK_COOLDOWN_SECONDS = 90;
export const LINKEDIN_ERROR_CODES = Object.freeze([
  'http_rejected', 'http_error', 'rate_limited', 'unexpected_response',
  'timeout', 'network_error', 'credentials_unavailable', 'unexpected_error',
]);

export function linkedinCheckPatch(result, now = new Date()) {
  const stamp = now.toISOString();
  const ok = result?.ok === true;
  const errorCode = LINKEDIN_ERROR_CODES.includes(result?.error_code)
    ? result.error_code : 'unexpected_error';
  const httpStatus = Number.isInteger(result?.http_status)
    && result.http_status >= 100 && result.http_status <= 999
    ? result.http_status : null;
  if (ok) {
    return {
      last_success_at: stamp,
      last_outcome: 'success',
      last_error_code: null,
      last_http_status: null,
    };
  }
  return {
    last_failure_at: stamp,
    last_outcome: 'failure',
    last_error_code: errorCode,
    last_http_status: httpStatus,
  };
}

export function linkedinRetrySeconds(verification, now = Date.now()) {
  const timestamp = Date.parse(verification?.last_attempt_at || '');
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.ceil((timestamp + LINKEDIN_CHECK_COOLDOWN_SECONDS * 1000 - now) / 1000));
}
