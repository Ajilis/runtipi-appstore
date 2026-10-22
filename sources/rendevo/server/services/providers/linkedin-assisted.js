// Human-operated LinkedIn workflow. Cookies only verify the account identity:
// neither this policy nor the worker may transmit invitations or messages.
export function isLinkedinAssisted(provider) {
  return provider === 'linkedin_cookie' || provider === 'linkedin_companion';
}

export function assistedCampaignSettings(settings, provider) {
  if (!isLinkedinAssisted(provider)) return settings;
  return { ...settings, validation: 'all', auto_discovery: false };
}

export function assistedMessageApproval(provider, kind, requestedApproval) {
  if (isLinkedinAssisted(provider) && kind !== 'manual') return true;
  return requestedApproval;
}
