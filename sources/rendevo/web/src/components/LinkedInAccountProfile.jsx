import React, { useState } from 'react';

// Display only. Opening / refreshing Settings must never make a LinkedIn
// network request or change the account's connection status.
export function LinkedInAccountProfile({ profile }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!profile?.name) {
    return <p className="small soft">Cliquez sur « Tester » pour vérifier la session et récupérer votre profil LinkedIn.</p>;
  }
  const initials = profile.name.split(' ').filter(Boolean).slice(0, 2)
    .map((word) => word[0]).join('').toUpperCase();
  return (
    <div className="row wrap" style={{ gap: 14, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
      {profile.photo_url && !imageFailed
        ? <img src={profile.photo_url} width={52} height={52} alt="" referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
        : <span className="avatar" style={{ width: 52, height: 52 }}>{initials}</span>}
      <div style={{ minWidth: 0 }}>
        <strong>{profile.name}</strong>
        {profile.headline && <div className="small soft">{profile.headline}</div>}
        {profile.profile_url && <a href={profile.profile_url} target="_blank" rel="noopener noreferrer" className="small">Voir mon profil LinkedIn ↗</a>}
      </div>
    </div>
  );
}
