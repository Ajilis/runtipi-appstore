import React, { useRef, useState } from 'react';
import { LuUpload, LuCopy, LuTrash2, LuFileText } from 'react-icons/lu';
import { api, useApi, Loading, ErrorBox, Empty, useToast, copy, ago } from '../lib.jsx';

export function Media() {
  const { data, error, loading, reload } = useApi('/api/media');
  const [progress, setProgress] = useState(null);
  const input = useRef(null);
  const toast = useToast();

  const upload = (file) => {
    if (!file) return;
    const title = window.prompt('Titre de la vidéo ou du document', file.name.replace(/\.[^.]+$/, '')) || file.name;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-title', encodeURIComponent(title));
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) { toast('Fichier ajouté'); reload(); } else {
        let msg = 'Envoi impossible';
        try { msg = JSON.parse(xhr.responseText).error; } catch { /* keep default */ }
        toast(msg, 'err');
      }
    };
    xhr.onerror = () => { setProgress(null); toast('Envoi interrompu', 'err'); };
    xhr.send(file);
  };

  const remove = async (m) => {
    if (!window.confirm(`Supprimer « ${m.title} » ? Les liens déjà envoyés ne fonctionneront plus.`)) return;
    await api(`/api/media/${m.id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Médias</h1>
          <p>Enregistrez une fois une courte vidéo de présentation : l'agent la glisse dans une relance au bon moment, quand un prospect hésite. Les liens s'ouvrent sur une page de lecture à votre nom.</p>
        </div>
        <div>
          <input ref={input} type="file" accept="video/*,image/*,application/pdf" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
          <button className="btn primary" onClick={() => input.current.click()} disabled={progress !== null}><LuUpload />{progress !== null ? `Envoi ${progress} %` : 'Ajouter un fichier'}</button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && <div className="panel"><Empty title="Aucun média" action={<button className="btn primary" onClick={() => input.current.click()}><LuUpload />Ajouter une vidéo</button>}>Une vidéo de 30 à 60 secondes, face caméra, qui explique ce que vous faites pour des profils comme le prospect.</Empty></div>}
      {data && data.length > 0 && (
        <div className="grid-3">
          {data.map((m) => (
            <div key={m.id} className="panel" style={{ overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16 / 9', background: 'var(--surface-2)', display: 'grid', placeItems: 'center', borderBottom: '1px solid var(--line)' }}>
                {m.kind === 'video' && <video src={`/api/public/media/${m.share_token}`} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {m.kind === 'image' && <img src={`/api/public/media/${m.share_token}`} alt={m.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {m.kind === 'document' && <LuFileText size={40} color="var(--ink-3)" />}
              </div>
              <div className="panel-pad stack" style={{ '--gap': '8px' }}>
                <div style={{ fontWeight: 600 }} className="ellipsis">{m.title}</div>
                <div className="small muted">{(m.size / 1048576).toFixed(1)} Mo, ajouté {ago(m.created_at)}</div>
                <div className="row">
                  <button className="btn sm" onClick={() => copy(m.share_url.startsWith('http') ? m.share_url : window.location.origin + m.share_url, toast)}><LuCopy />Copier le lien</button>
                  <button className="btn sm ghost icon danger" aria-label={`Supprimer ${m.title}`} onClick={() => remove(m)}><LuTrash2 /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
