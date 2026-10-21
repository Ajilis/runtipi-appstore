import React, { useEffect, useState } from 'react';
import { api } from '../lib.jsx';

// Verifies the existing account once when the settings panel opens.
// No session cookie is handled in the browser: the server returns display-only data.
export function LinkedInAccountProfile({ accountId, onChecked }) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState({ loading: true, result: null, error: '' });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ loading: true, result: null, error: '' });
    setImageFailed(false);
    api('/api/accounts/' + encodeURIComponent(accountId) + '/test', { method: 'POST' }).then(
      (result) => {
        if (!active) return;
        setState({ loading: false, result, error: '' });
        onChecked?.();
      },
      (error) => { if (active) setState({ loading: false, result: null, error: error.message }); },
    );
    return () => { active = false; };
  }, [accountId, refresh]);

  const profile = state.result?.profile;
  const initials = (profile?.name || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return (
    <div className="row wrap" style={{ gap: 14, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
      {state.loading ? (
        <span className="small soft">Récupération de votre profil LinkedIn…</span>
      ) : profile ? (
        <div className="row grow" style={{ gap: 12, minWidth: 220 }}>
          {profile.photo_url && !imageFailed
            ? <img src={profile.photo_url} width={52} height={52} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)}
                style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
            : <span className="avatar" style={{ width: 52, height: 52 }}>{initials}</span>}
          <div style={{ minWidth: 0 }}>
            <strong>{profile.name}</strong>
            {profile.headline && <div className="small soft">{profile.headline}</div>}
            {profile.profile_url && <a href={profile.profile_url} target="_blank" rel="noopener noreferrer" className="small">Voir mon profil LinkedIn ↗</a>}
          </div>
        </div>
      ) : (
        <span className={state.error || state.result?.ok === false ? 'small muted' : 'small soft'}>
          {state.error || state.result?.detail || 'Profil indisponible.'}
        </span>
      )}
      <button className="btn sm" type="button" disabled={state.loading} onClick={() => setRefresh((v) => v + 1)}>
        {state.loading ? 'Vérification…' : 'Actualiser mon profil'}
      </button>
    </div>
  );
}
