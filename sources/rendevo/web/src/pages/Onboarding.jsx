import React, { useEffect, useState } from 'react';
import { LuSparkles, LuArrowLeft } from 'react-icons/lu';
import { api, Field, Logo, useRouter, useToast, Switch, Loading } from '../lib.jsx';
import { useSession } from '../session.js';
import { OfferEditor, IcpEditor, VoiceEditor, AvailabilityEditor } from '../components/Editors.jsx';
import { AccountForm, emptyAccount } from '../components/AccountForm.jsx';

const STEPS = ['Votre offre', 'Votre cible', 'Votre voix', 'Compte LinkedIn', 'Agenda', 'Lancement'];

export function Onboarding() {
  const { session, refresh } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(null);
  const [url, setUrl] = useState('');
  const [extra, setExtra] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [angles, setAngles] = useState([]);
  const [account, setAccount] = useState(emptyAccount());
  const [hasAccount, setHasAccount] = useState(false);
  const [validate, setValidate] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/settings').then((r) => {
      const s = r.settings;
      setSettings({ ...s, voice: { ...s.voice, sender_name: s.voice?.sender_name || session.user.name } });
      setUrl(s.offer?.website || '');
    });
    api('/api/accounts').then((a) => setHasAccount(a.length > 0));
  }, [session.user.name]);

  if (!settings) return <Loading />;
  const patch = (k) => (v) => setSettings({ ...settings, [k]: v });

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const r = await api('/api/offer/analyze', { method: 'POST', body: { url, text: extra } });
      const a = r.analysis;
      setSettings({
        ...settings,
        offer: { ...settings.offer, website: url, offer_name: a.offer_name || settings.offer?.offer_name, summary: a.summary, value_prop: a.value_prop, proof: a.proof, cta: a.cta || 'Appel découverte de 30 minutes' },
        icp: { ...settings.icp, ...a.icp, titles: a.icp?.titles?.length ? a.icp.titles : settings.icp?.titles },
        voice: { ...settings.voice, tone: a.tone || settings.voice?.tone },
      });
      setAngles(a.angles || []);
      toast(a.source === 'ai' ? "Offre analysée par l'IA. Vérifiez et ajustez." : "Offre pré-remplie. Vérifiez les champs ; avec l'IA configurée, l'analyse sera plus fine.");
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setAnalyzing(false);
    }
  };

  const save = (body) => api('/api/settings', { method: 'PATCH', body });

  const next = async () => {
    try {
      setBusy(true);
      if (step === 0) await save({ offer: settings.offer });
      if (step === 1) await save({ icp: settings.icp });
      if (step === 2) await save({ voice: settings.voice });
      if (step === 3 && !hasAccount) {
        await api('/api/accounts', { method: 'POST', body: account });
        setHasAccount(true);
      }
      if (step === 4) await save({ availability: settings.availability, goal: settings.goal });
      setStep(step + 1);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (launch) => {
    setBusy(true);
    try {
      const accounts = await api('/api/accounts');
      const camp = await api('/api/campaigns', {
        method: 'POST',
        body: { name: `${settings.offer?.offer_name || 'Prospection'} : ${settings.icp?.titles?.[0] || 'cible principale'}`, account_id: accounts[0]?.id, icp: settings.icp, settings: { validation: validate ? 'first' : 'none', auto_discovery: !['manual', 'linkedin_cookie'].includes(accounts[0]?.provider) } },
      });
      if (accounts[0] && !['manual', 'linkedin_cookie'].includes(accounts[0].provider)) {
        try { await api(`/api/campaigns/${camp.id}/discover`, { method: 'POST', body: { limit: 15 } }); } catch (e) { toast(e.message, 'err'); }
      }
      if (launch) {
        await api(`/api/campaigns/${camp.id}/status`, { method: 'POST', body: { status: 'active' } });
        await api('/api/agent', { method: 'POST', body: { enabled: true } });
      }
      await save({ onboarding_done: true });
      await refresh();
      navigate(launch ? '/' : `/campagnes/${camp.id}`);
      toast(launch ? 'Votre agent est lancé.' : 'Campagne créée. Lancez-la quand vous êtes prêt.');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => { await save({ onboarding_done: true }); await refresh(); navigate('/'); };

  return (
    <div className="public" style={{ alignItems: 'flex-start' }}>
      <div className="onb" style={{ width: '100%' }}>
        <div className="row spread" style={{ marginBottom: 24 }}>
          <span className="row" style={{ fontWeight: 700, fontSize: '1.1rem' }}><Logo />Rendevo</span>
          <button className="btn ghost sm" onClick={skip}>Configurer plus tard</button>
        </div>
        <div className="steps" aria-hidden="true">{STEPS.map((s, i) => <div key={s} className={i <= step ? 'on' : ''} />)}</div>
        <p className="small muted">Étape {step + 1} sur {STEPS.length}</p>
        <h1 style={{ margin: '4px 0 18px' }}>{STEPS[step]}</h1>

        <div className="panel panel-pad">
          {step === 0 && (
            <div className="stack" style={{ '--gap': '16px' }}>
              <p className="soft">Donnez l'adresse de votre site : l'agent lit votre offre et propose une cible. Pour un profil LinkedIn, collez plutôt votre titre et votre section « Infos » ci-dessous.</p>
              <div className="row wrap">
                <input className="input grow" style={{ minWidth: 240 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://votre-site.fr" aria-label="Site web" />
                <button className="btn primary" onClick={analyze} disabled={analyzing || (!url && !extra)}>{analyzing ? <span className="spinner" /> : <LuSparkles />}Analyser mon offre</button>
              </div>
              <Field label="Précisions (facultatif)"><textarea className="textarea" style={{ minHeight: 70 }} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ce que vous vendez, à qui, vos résultats…" /></Field>
              <hr className="divider" />
              <OfferEditor value={settings.offer} onChange={patch('offer')} />
              {angles.length > 0 && (
                <div className="alert info"><strong>Angles d'accroche suggérés :</strong> {angles.join(' ; ')}</div>
              )}
            </div>
          )}
          {step === 1 && <IcpEditor value={settings.icp} onChange={patch('icp')} />}
          {step === 2 && <VoiceEditor value={settings.voice} onChange={patch('voice')} />}
          {step === 3 && (hasAccount
            ? <div className="alert ok">Un compte est déjà configuré pour cet espace. Vous pourrez en ajouter d'autres dans Réglages.</div>
            : <AccountForm value={account} onChange={setAccount} />)}
          {step === 4 && <AvailabilityEditor value={settings.availability} onChange={patch('availability')} goal={settings.goal?.meetings_per_week} onGoal={(g) => setSettings({ ...settings, goal: { meetings_per_week: g } })} />}
          {step === 5 && (
            <div className="stack" style={{ '--gap': '16px' }}>
              <p>Rendevo va créer une première campagne avec votre cible, trouver des prospects puis contacter les plus chauds à rythme humain. Le setter IA répond et place les rendez-vous dans vos créneaux libres.</p>
              <Switch checked={validate} onChange={setValidate} label="Je valide les premiers messages avant leur envoi" />
              <div className="alert">Vous pouvez tout mettre en pause d'un clic depuis le tableau de bord.</div>
            </div>
          )}
        </div>

        <div className="row spread" style={{ marginTop: 18 }}>
          <button className="btn ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><LuArrowLeft />Retour</button>
          {step < 5 ? (
            <button className="btn primary lg" onClick={next} disabled={busy || (step === 3 && !hasAccount && ((account.provider === 'unipile' && (!account.config.dsn || !account.config.api_key || !account.config.account_id)) || (account.provider === 'linkedin_cookie' && (!account.config.li_at || !account.config.jsessionid))))}>Continuer</button>
          ) : (
            <div className="row">
              <button className="btn" onClick={() => finish(false)} disabled={busy}>Créer sans lancer</button>
              <button className="btn primary lg" onClick={() => finish(true)} disabled={busy}>{busy ? <span className="spinner" /> : null}Lancer mon agent</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
