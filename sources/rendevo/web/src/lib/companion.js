// Read only the explicitly selected public profile URL.
// Never request LinkedIn pages, read their DOM, cookies or authentication tokens.
export function normalizedLinkedinProfileUrl(input) {
  if (typeof input !== 'string' || input.length > 512) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(parsed.hostname.toLowerCase())
      || parsed.username || parsed.password || parsed.port) return null;
    const matched = /^\/in\/([a-z0-9][a-z0-9_.%-]{0,199})\/?$/i.exec(parsed.pathname);
    if (!matched) return null;
    return 'https://www.linkedin.com/in/' + matched[1] + '/';
  } catch {
    return null;
  }
}
