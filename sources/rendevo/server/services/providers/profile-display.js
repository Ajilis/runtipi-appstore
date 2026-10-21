// Minimal display-only view of a normalized member profile response.
// We never expose or persist the raw upstream payload.
function safeText(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeImage(value) {
  if (typeof value !== 'string' || value.length > 3000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'licdn.com' || url.hostname.endsWith('.licdn.com'))
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function photo(value) {
  if (typeof value === 'string') return safeImage(value);
  if (!value || typeof value !== 'object') return null;
  const vector = value['com.linkedin.common.VectorImage'] || value;
  if (vector !== value) return photo(vector);
  if (safeImage(vector.url)) return safeImage(vector.url);
  const assets = Array.isArray(vector.artifacts) ? vector.artifacts : [];
  const sorted = [...assets].sort((a, b) => Math.abs((a.width || 200) - 200) - Math.abs((b.width || 200) - 200));
  for (const item of sorted) {
    const candidate = safeImage(item?.url || item?.identifiers?.[0]?.identifier);
    if (candidate) return candidate;
    if (vector.rootUrl && item?.fileIdentifyingUrlPathSegment) {
      const combined = safeImage(vector.rootUrl + item.fileIdentifyingUrlPathSegment);
      if (combined) return combined;
    }
  }
  return safeImage(vector.rootUrl);
}

export function profileDisplay(json) {
  const data = json?.data && typeof json.data === 'object' ? json.data : {};
  const included = Array.isArray(json?.included) ? json.included : [];
  const miniProfiles = included.filter((item) => item && String(item.$type || '').includes('MiniProfile'));
  const reference = data['*miniProfile'] || data.miniProfile?.entityUrn;
  const mini = (reference
    ? miniProfiles.find((item) => item.entityUrn === reference)
    : miniProfiles.length === 1 ? miniProfiles[0] : null)
    || (data.miniProfile && typeof data.miniProfile === 'object' ? data.miniProfile : data);
  const name = safeText([mini.firstName, mini.lastName].filter(Boolean).join(' ') || mini.name, 180);
  const headline = safeText(mini.occupation || mini.headline, 220);
  const identifier = safeText(mini.publicIdentifier || data.publicIdentifier, 160);
  const slug = /^[a-z0-9._-]{2,160}$/i.test(identifier) ? identifier : '';
  if (!name && !slug) return null;
  return {
    name: name || slug,
    headline,
    photo_url: photo(mini.picture) || photo(mini.profilePicture) || photo(data.picture),
    profile_url: slug ? 'https://www.linkedin.com/in/' + encodeURIComponent(slug) + '/' : null,
  };
}
