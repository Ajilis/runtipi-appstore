import React, { useState } from 'react';
import { api, Field, Logo, useAction } from '../lib.jsx';

export function AuthPage({ auth, onDone }) {
  const [mode, setMode] = useState(auth.needsSetup ? 'setup' : 'login');
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState('');
  const [run, busy] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const path = mode === 'setup' ? '/api/auth/setup' : mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    try {
      await api(path, { method: 'POST', body: form });
      await onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  void run;

  const title = { setup: 'Créer le compte administrateur', login: 'Se connecter', signup: 'Créer un compte' }[mode];
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="row" style={{ fontWeight: 700, fontSize: '1.2rem' }}><Logo size={30} light />Rendevo</div>
        <div>
          <p className="quote">Votre LinkedIn repère les <span className="hl">signaux chauds</span> et remplit votre agenda.</p>
          <div className="agenda" aria-hidden="true">
            <div /><div className="b">Mar 10h<br />Sophie M.</div><div /><div className="b">Jeu 14h<br />Marc L.</div><div />
            <div className="b">Lun 9h<br />Inès D.</div><div /><div /><div /><div className="b">Ven 11h<br />Julie R.</div>
          </div>
        </div>
        <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Agent de prospection auto-hébergé. Vos données restent sur votre serveur.</p>
      </div>
      <div className="auth-main">
        <form className="auth-card stack" style={{ '--gap': '16px' }} onSubmit={submit}>
          <div>
            <h1 style={{ fontSize: 'var(--step-2)' }}>{title}</h1>
            {mode === 'setup' && <p className="soft" style={{ marginTop: 6 }}>Premier démarrage : ce compte administre l'instance et ses espaces.</p>}
          </div>
          {mode !== 'login' && <Field label="Votre nom" htmlFor="name"><input id="name" className="input" value={form.name} onChange={set('name')} autoComplete="name" required /></Field>}
          <Field label="E-mail" htmlFor="email"><input id="email" className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></Field>
          <Field label="Mot de passe" htmlFor="pw" hint={mode !== 'login' ? '10 caractères minimum' : undefined}>
            <input id="pw" className="input" type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 10} />
          </Field>
          {mode !== 'login' && <Field label="Nom de votre activité" htmlFor="ws"><input id="ws" className="input" value={form.workspaceName} onChange={set('workspaceName')} placeholder="Ex. Studio Martin Conseil" /></Field>}
          {error && <div className="alert err" role="alert">{error}</div>}
          <button className="btn primary lg" type="submit" disabled={busy}>{mode === 'login' ? 'Se connecter' : 'Créer le compte'}</button>
          {!auth.needsSetup && auth.allowSignup && (
            <p className="small soft">
              {mode === 'login' ? <>Pas encore de compte ? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }}>Créer un compte</a></> : <>Déjà inscrit ? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>Se connecter</a></>}
            </p>
          )}
        </form>
        {auth.version && <div className="auth-version" aria-label="Version de Rendevo">Rendevo v{auth.version}</div>}
      </div>
    </div>
  );
}
