import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuUpload, LuDownload, LuSearch, LuPlus, LuExternalLink, LuSparkles, LuList, LuColumns3, LuRefreshCw, LuWandSparkles, LuX } from 'react-icons/lu';
import { api, useApi, useRouter, Loading, ErrorBox, Empty, Modal, Drawer, Field, Seg, useAction, useToast, HeatBadge, StatusBadge, STATUS, KIND, initials, ago, fmtDateTime, Link } from '../lib.jsx';
import { normalizedLinkedinProfileUrl } from '../lib/companion.js';

const SIGNAL_OPTIONS = [
  ['new_role', 'Nouveau poste'], ['hiring', 'Recrute'], ['funding', 'Levée de fonds'], ['profile_visit', 'A visité votre profil'],
  ['post_engagement', 'A réagi à votre publication'], ['competitor_engagement', "Engagé auprès d'un concurrent"], ['topic_post', 'A publié sur votre sujet'], ['company_news', 'Actualité de son entreprise'],
];

export function Prospects({ openId }) {
  const { query, navigate } = useRouter();
  const [filters, setFilters] = useState({ q: '', heat: query.heat || '', status: '', campaign: query.campaign || '', needs_human: '' });
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(new Set());
  const companionUrl = normalizedLinkedinProfileUrl(query.companion_url);
  const [modal, setModal] = useState(query.import === '1' ? 'import' : null);
  const qs = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const { data, error, loading, reload } = useApi(`/api/prospects?limit=300&${qs}`);
  const campaigns = useApi('/api/campaigns');
  const [run, busy] = useAction();
  const toast = useToast();

  useEffect(() => setSelected(new Set()), [qs]);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target ? e.target.value : e });
  const items = data?.items || [];
  const allSel = items.length > 0 && items.every((p) => selected.has(p.id));

  const bulk = (action, value) => run(async () => {
    await api('/api/prospects/bulk', { method: 'POST', body: { ids: [...selected], action, value } });
    setSelected(new Set());
    reload();
  }, 'Modifications appliquées');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Prospects</h1>
          <p>Chaque profil est qualifié selon votre cible et ses signaux d'achat récents. Les plus chauds sont contactés en premier.</p>
        </div>
        <div className="row wrap">
          <a className="btn" href={`/api/prospects/export.csv?${qs}`}><LuDownload />Exporter</a>
          <button className="btn" onClick={() => setModal('add')}><LuPlus />Ajouter</button>
          <button className="btn" onClick={() => setModal('import')}><LuUpload />Importer</button>
          <button className="btn primary" onClick={() => setModal('discover')}><LuSparkles />Trouver des prospects</button>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="row grow" style={{ minWidth: 220, position: 'relative' }}>
          <LuSearch style={{ position: 'absolute', left: 11, color: 'var(--ink-3)' }} aria-hidden="true" />
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Nom, entreprise, poste…" value={filters.q} onChange={set('q')} aria-label="Rechercher" />
        </div>
        <select className="select" style={{ width: 'auto' }} value={filters.heat} onChange={set('heat')} aria-label="Chaleur">
          <option value="">Toutes chaleurs</option><option value="hot">Chauds</option><option value="warm">Tièdes</option><option value="cold">Froids</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={filters.status} onChange={set('status')} aria-label="Statut">
          <option value="">Tous statuts</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={filters.campaign} onChange={set('campaign')} aria-label="Campagne">
          <option value="">Toutes campagnes</option><option value="none">Sans campagne</option>
          {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Seg value={view} onChange={setView} options={[{ value: 'list', label: <span className="row" style={{ gap: 6 }}><LuList />Liste</span> }, { value: 'pipeline', label: <span className="row" style={{ gap: 6 }}><LuColumns3 />Pipeline</span> }]} />
      </div>

      {selected.size > 0 && (
        <div className="panel panel-pad row wrap" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <strong className="num">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</strong>
          <select className="select" style={{ width: 'auto' }} defaultValue="" onChange={(e) => e.target.value && bulk('assign_campaign', e.target.value === 'none' ? null : e.target.value)} disabled={busy}>
            <option value="">Ajouter à une campagne…</option>
            {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">Retirer de la campagne</option>
          </select>
          <select className="select" style={{ width: 'auto' }} defaultValue="" onChange={(e) => e.target.value && bulk('stage', e.target.value)} disabled={busy}>
            <option value="">Étape du pipeline…</option>
            {(data?.stages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="btn sm" onClick={() => bulk('requalify')} disabled={busy}><LuRefreshCw />Requalifier</button>
          <button className="btn sm" onClick={() => bulk('exclude')} disabled={busy}>Exclure</button>
          <button className="btn sm danger" onClick={() => window.confirm('Supprimer définitivement ces prospects et leurs conversations ?') && bulk('delete')} disabled={busy}>Supprimer</button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Annuler</button>
        </div>
      )}

      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && items.length === 0 && (
        <div className="panel"><Empty title="Aucun prospect" action={<button className="btn primary" onClick={() => setModal('discover')}><LuSparkles />Trouver des prospects</button>}>
          Lancez une recherche depuis une campagne, importez un fichier CSV ou collez des URLs LinkedIn.
        </Empty></div>
      )}
      {data && items.length > 0 && view === 'list' && (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sel"><input type="checkbox" aria-label="Tout sélectionner" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(items.map((p) => p.id)))} /></th>
                <th>Prospect</th><th>Signal</th><th>Chaleur</th><th>Statut</th><th>Campagne</th><th>Activité</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/prospects/${p.id}`)}>
                  <td className="sel" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Sélectionner ${p.full_name}`} checked={selected.has(p.id)} onChange={() => { const n = new Set(selected); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setSelected(n); }} />
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className={`avatar ${p.heat === 'hot' ? 'hot' : ''}`}>{initials(p.full_name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{p.heat === 'hot' ? <span className="hl">{p.full_name}</span> : p.full_name}{p.needs_human && <span className="badge warn" style={{ marginLeft: 8 }}>À traiter</span>}</div>
                        <div className="small soft ellipsis" style={{ maxWidth: 320 }}>{p.title || p.headline}{p.company ? `, ${p.company}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="small soft" style={{ maxWidth: 220 }}><span className="ellipsis" style={{ display: 'block' }}>{p.signals?.[0] ? (p.signals[0].detail || p.signals[0].label) : '–'}</span></td>
                  <td><HeatBadge heat={p.heat} /> <span className="small muted num">{p.fit_score ?? ''}</span></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="small soft">{p.campaign_name || '–'}</td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(p.last_reply_at || p.last_contact_at || p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > items.length && <div className="small muted" style={{ padding: 12 }}>{items.length} affichés sur {data.total}. Affinez les filtres pour voir les autres.</div>}
        </div>
      )}
      {data && items.length > 0 && view === 'pipeline' && <Pipeline items={items} stages={data.stages} onMove={async (id, stage) => { await api(`/api/prospects/${id}`, { method: 'PATCH', body: { stage } }); reload(); }} onOpen={(id) => navigate(`/prospects/${id}`)} />}

      {modal === 'import' && <ImportModal campaigns={campaigns.data || []} initialUrls={companionUrl || ''} initialCampaign={filters.campaign} onClose={() => setModal(null)} onDone={(r) => { setModal(null); reload(); toast(`${r.created} importés, ${r.duplicates} doublons ignorés${r.invalid ? `, ${r.invalid} lignes invalides` : ''}.`); }} />}
      {modal === 'add' && <AddModal campaigns={campaigns.data || []} onClose={() => setModal(null)} onDone={(id) => { setModal(null); reload(); navigate(`/prospects/${id}`); }} />}
      {modal === 'discover' && <DiscoverModal campaigns={campaigns.data || []} onClose={() => setModal(null)} onDone={(r) => { setModal(null); reload(); toast(`${r.created} nouveaux prospects qualifiés sur ${r.found} trouvés.`); }} />}
      {openId && <ProspectDrawer id={openId} campaigns={campaigns.data || []} onClose={() => navigate('/prospects')} onChange={reload} />}
    </>
  );
}

function Pipeline({ items, stages, onMove, onOpen }) {
  const [over, setOver] = useState(null);
  return (
    <div className="kanban">
      {stages.map((s) => {
        const col = items.filter((p) => p.stage === s.id);
        return (
          <div key={s.id} className={`kcol ${over === s.id ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) onMove(id, s.id); }}>
            <h4><span>{s.label}</span><span className="num muted">{col.length}</span></h4>
            {col.map((p) => (
              <div key={p.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => onOpen(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}>
                <div style={{ fontWeight: 600 }}>{p.heat === 'hot' ? <span className="hl">{p.full_name}</span> : p.full_name}</div>
                <div className="small soft ellipsis">{p.company || p.title}</div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}><StatusBadge status={p.status} /></div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CampaignSelect({ campaigns, value, onChange, allowNone = true }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Aucune campagne (à trier plus tard)</option>}
      {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function ImportModal({ campaigns, initialCampaign, initialUrls = '', onClose, onDone }) {
  const [mode, setMode] = useState(initialUrls ? 'urls' : 'csv');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [urls, setUrls] = useState(initialUrls);
  const [campaign, setCampaign] = useState(initialCampaign && initialCampaign !== 'none' ? initialCampaign : campaigns[0]?.id || '');
  const [signal, setSignal] = useState('');
  const [signalDetail, setSignalDetail] = useState('');
  const [run, busy] = useAction();
  const submit = () => run(async () => {
    const body = { campaign_id: campaign || null };
    if (initialUrls && mode === 'urls') body.source = 'companion';
    if (mode === 'csv') body.csv = csv; else body.urls = urls;
    if (signal) body.signal = { type: signal, detail: signalDetail };
    const r = await api('/api/prospects/import', { method: 'POST', body });
    onDone(r);
  });
  return (
    <Modal title="Importer des prospects" onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={busy || (mode === 'csv' ? !csv : !urls)} onClick={submit}><LuUpload />Importer</button>
    </>}>
      <div className="stack" style={{ '--gap': '16px' }}>
        <Seg value={mode} onChange={setMode} options={[{ value: 'csv', label: 'Fichier CSV' }, { value: 'urls', label: 'URLs LinkedIn' }]} />
        {mode === 'csv' ? (
          <Field label="Fichier CSV" hint="Colonnes reconnues : nom, prénom, poste, entreprise, localisation, linkedin_url, e-mail. Export Sales Navigator, Waalaxy ou tableur.">
            <input className="input" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files[0]; if (f) { setFileName(f.name); setCsv(await f.text()); } }} />
            {fileName && <div className="small soft">{fileName} : {Math.max(0, csv.split(/\r?\n/).filter(Boolean).length - 1)} lignes</div>}
          </Field>
        ) : (
          <Field label="URLs de profils" hint="Une par ligne. Rendevo prépare les brouillons, sans lire automatiquement les profils ni envoyer de messages. Ajoutez ensuite le poste et l'entreprise si besoin.">
            <textarea className="textarea" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={'https://www.linkedin.com/in/…\nhttps://www.linkedin.com/in/…'} />
          </Field>
        )}
        <Field label="Campagne"><CampaignSelect campaigns={campaigns} value={campaign} onChange={setCampaign} /></Field>
        <div className="grid-2">
          <Field label="Signal commun (facultatif)" hint="Ex. ils ont tous commenté le même post.">
            <select className="select" value={signal} onChange={(e) => setSignal(e.target.value)}>
              <option value="">Aucun</option>
              {SIGNAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {signal && <Field label="Détail du signal"><input className="input" value={signalDetail} onChange={(e) => setSignalDetail(e.target.value)} placeholder="Ex. Commentaire sur le post de X du 12/10" /></Field>}
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ campaigns, onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', linkedin_url: '', title: '', company: '', location: '', email: '', campaign_id: campaigns[0]?.id || '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  return (
    <Modal title="Ajouter un prospect" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={busy || !f.full_name} onClick={() => run(async () => { const r = await api('/api/prospects', { method: 'POST', body: { ...f, campaign_id: f.campaign_id || null } }); onDone(r.id); })}>Ajouter</button>
    </>}>
      <div className="stack" style={{ '--gap': '12px' }}>
        <Field label="Nom complet"><input className="input" value={f.full_name} onChange={set('full_name')} autoFocus /></Field>
        <Field label="URL LinkedIn"><input className="input" value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/in/…" /></Field>
        <div className="grid-2">
          <Field label="Poste"><input className="input" value={f.title} onChange={set('title')} /></Field>
          <Field label="Entreprise"><input className="input" value={f.company} onChange={set('company')} /></Field>
          <Field label="Localisation"><input className="input" value={f.location} onChange={set('location')} /></Field>
          <Field label="E-mail (facultatif)"><input className="input" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Campagne"><CampaignSelect campaigns={campaigns} value={f.campaign_id} onChange={set('campaign_id')} /></Field>
      </div>
    </Modal>
  );
}

function DiscoverModal({ campaigns, onClose, onDone }) {
  const automatic = campaigns.filter((c) => c.account_provider && !['manual', 'linkedin_cookie', 'linkedin_companion'].includes(c.account_provider));
  const companionCampaigns = campaigns.filter((c) => c.account_provider === 'linkedin_companion');
  const assisted = campaigns.filter((c) => ['manual', 'linkedin_cookie', 'linkedin_companion'].includes(c.account_provider));
  const config = useApi('/api/discovery/config');
  const [mode, setMode] = useState(companionCampaigns.length ? 'linkedin' : 'web');
  const [campaign, setCampaign] = useState(assisted[0]?.id || '');
  const [limit, setLimit] = useState(20);
  const [criteria, setCriteria] = useState({ title: '', industry: '', location: '', keywords: '' });
  const [titleTags, setTitleTags] = useState([]);
  const [titleTagsEdited, setTitleTagsEdited] = useState(false);
  const [jobTitles, setJobTitles] = useState(null);
  const [titleSource, setTitleSource] = useState('');
  const [selectedSuggestedTitle, setSelectedSuggestedTitle] = useState('');
  const [runWizard, wizardBusy] = useAction();
  const [results, setResults] = useState(null);
  const [searchInfo, setSearchInfo] = useState(null);
  const [searchedInput, setSearchedInput] = useState(null);
  const [pagingMode, setPagingMode] = useState('pages');
  const [loadingNext, setLoadingNext] = useState(false);
  const loadingNextRef = useRef(false);
  const endOfResults = useRef(null);
  const toast = useToast();
  const [chosen, setChosen] = useState({});
  const [names, setNames] = useState({});
  const [run, busy] = useAction();
  const currentCampaign = campaigns.find((c) => c.id === campaign);
  const fromCampaign = (property) => Array.isArray(currentCampaign?.icp?.[property]) ? currentCampaign.icp[property][0] || '' : '';
  const chosenItems = (results || []).filter((r) => !!chosen[r.linkedin_url]);
  const canLoadMore = searchInfo?.provider === 'degoog'
    && !!searchInfo.has_more && !!searchedInput && (results || []).length < 200;
  const clearSearch = () => {
    setResults(null); setSearchInfo(null); setSearchedInput(null);
    setChosen({}); setNames({});
  };
  const generateJobTitles = () => runWizard(async () => {
    const keyword = (criteria.title || titleTags[0] || fromCampaign('titles')).trim();
    if (!keyword) throw new Error('Saisissez d’abord un mot-clé dans « Poste recherché »');
    const response = await api('/api/discovery/job-titles', {
      method: 'POST', body: { keyword },
    });
    setJobTitles(response.rows);
    setTitleSource(response.keyword);
    setSelectedSuggestedTitle('');
    return response;
  }, (response) => `${response.rows.length} intitulés proposés par le modèle IA actif`);
  const addTitleTag = (value) => {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    if (title.length > 70) { toast('Un intitulé ne peut pas dépasser 70 caractères', 'err'); return; }
    if (titleTags.length >= 8) { toast('8 intitulés maximum pour un même dork', 'err'); return; }
    if (titleTags.some((item) => item.toLocaleLowerCase('fr') === title.toLocaleLowerCase('fr'))) {
      toast('Cet intitulé est déjà sélectionné', 'err');
      return;
    }
    // The keyword is only a seed: selecting the first title REPLACES it.
    setTitleTags((prev) => [...prev, title]);
    setTitleTagsEdited(true);
    setCriteria((previous) => ({ ...previous, title: '' }));
    setSelectedSuggestedTitle('');
    clearSearch();
  };
  const removeTitleTag = (title) => {
    setTitleTags((previous) => previous.filter((item) => item !== title));
    setTitleTagsEdited(true);
    clearSearch();
  };
  const applySuggestedTitle = () => addTitleTag(selectedSuggestedTitle);
  const suggestion = (title) => {
    const lead = String(title || '').split(/\s+[-–—|]\s+/)[0].trim();
    return lead.split(/\s+/).length <= 5 ? lead : '';
  };
  const search = () => run(async () => {
    const input = {
      ...(titleTags.length
        ? { titles: titleTags }
        : { title: criteria.title || (titleTagsEdited ? '' : fromCampaign('titles')) }),
      industry: criteria.industry || fromCampaign('industries'),
      location: criteria.location || fromCampaign('locations'),
      keywords: criteria.keywords || fromCampaign('keywords'),
      limit,
    };
    const response = await api('/api/discovery/search', { method: 'POST', body: input });
    setResults(response.items);
    setSearchInfo(response);
    setSearchedInput(input);
    setChosen({});
    setNames(Object.fromEntries(response.items.map((item) => [item.linkedin_url, suggestion(item.title)])));
    return response;
  }, (response) => response?.found
    ? `${response.found} profils trouvés : vérifiez-les avant import`
    : 'Aucun profil trouvé ; consultez le détail des dorks et élargissez les critères');
  const loadMore = useCallback(async () => {
    if (loadingNextRef.current || busy || !searchedInput || !searchInfo?.has_more
      || (results || []).length >= 200) return;
    loadingNextRef.current = true;
    setLoadingNext(true);
    try {
      const response = await api('/api/discovery/search', {
        method: 'POST',
        body: { ...searchedInput, page: searchInfo.page + 1, dork_index: searchInfo.dork_index },
      });
      const seen = new Set((results || []).map((item) => item.linkedin_url));
      const added = response.items.filter((item) => !seen.has(item.linkedin_url));
      const merged = [...(results || []), ...added].slice(0, 200);
      setResults(merged);
      setNames((prev) => ({
        ...Object.fromEntries(added.map((item) => [item.linkedin_url, suggestion(item.title)])),
        ...prev,
      }));
      setSearchInfo({
        ...response, has_more: response.has_more && merged.length < 200,
        attempts: [...(searchInfo.attempts || []), ...(response.attempts || [])],
      });
    } catch (err) {
      toast(err.message || 'Impossible de charger les autres pages', 'err');
    } finally {
      loadingNextRef.current = false;
      setLoadingNext(false);
    }
  }, [busy, searchedInput, searchInfo, results, toast]);

  useEffect(() => {
    if (pagingMode !== 'infinite' || !canLoadMore || loadingNext || busy
      || typeof IntersectionObserver === 'undefined' || !endOfResults.current) return undefined;
    let timer;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        timer = setTimeout(() => { void loadMore(); }, 1200);
      }
    }, { rootMargin: '120px' });
    observer.observe(endOfResults.current);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [pagingMode, canLoadMore, loadingNext, busy, loadMore]);

  const importSelected = () => run(async () => {
    const response = await api('/api/discovery/import', {
      method: 'POST',
      body: {
        campaign_id: campaign || null,
        items: chosenItems.map((item) => ({
          linkedin_url: item.linkedin_url,
          full_name: String(names[item.linkedin_url] || '').trim(),
        })),
      },
    });
    onDone({ ...response, found: chosenItems.length });
  });
  const runAutomatic = () => run(async () => {
    const response = await api(`/api/campaigns/${campaign}/discover`, { method: 'POST', body: { limit } });
    onDone(response);
  });
  return (
    <Modal title="Trouver des prospects" onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Fermer</button>
      {mode === 'web' && results && <button className="btn primary" disabled={busy || !chosenItems.length} onClick={importSelected}>
        Importer les {chosenItems.length} profils sélectionnés
      </button>}
      {mode === 'provider' && <button className="btn primary" disabled={busy || !campaign} onClick={runAutomatic}>
        {busy ? <span className="spinner" /> : <LuSparkles />}Lancer la recherche automatique
      </button>}
    </>}>
      <div className="stack" style={{ '--gap': '14px' }}>
        {(automatic.length > 0 || companionCampaigns.length > 0) && <Seg value={mode} onChange={(next) => {
          setMode(next);
          clearSearch();
          setJobTitles(null);
          setTitleTags([]);
          setTitleTagsEdited(false);
          setCampaign(next === 'provider' ? automatic[0]?.id || '' : next === 'linkedin' ? companionCampaigns[0]?.id || '' : assisted[0]?.id || '');
        }} options={[
          ...(companionCampaigns.length ? [{ value: 'linkedin', label: 'Dans mon LinkedIn (Companion)' }] : []),
          { value: 'web', label: 'Recherche web publique' },
          ...(automatic.length ? [{ value: 'provider', label: 'Connecteur automatique' }] : []),
        ]} />}
        {mode === 'linkedin' ? (
          <div className="stack" style={{ '--gap': '12px' }}>
            <div className="alert info">
              Recherche directement sur <strong>LinkedIn dans ton navigateur connecté</strong>, sans moteur web externe ni cookie transféré.
              Le compagnon peut lire sur clic les liens des résultats chargés dans l'onglet LinkedIn ; tu vérifies les liens avant import.
            </div>
            <Field label="Campagne Companion">
              <CampaignSelect campaigns={companionCampaigns} value={campaign} onChange={setCampaign} allowNone={false} />
            </Field>
            <div className="panel panel-pad stack" style={{ '--gap': '10px' }}>
              <strong>Depuis Chrome, en 3 étapes</strong>
              <p>1. Ouvre l'extension <strong>Rendevo Companion</strong> dans la barre de Chrome.</p>
              <p>2. Sélectionne la campagne, vérifie les mots-clés issus de ta cible et clique <strong>« Rechercher dans mon LinkedIn »</strong>.</p>
              <p>3. Sur la page LinkedIn de résultats Personnes, rouvre Companion et clique <strong>« Lire les profils de cette page LinkedIn »</strong>. Vérifie la liste préremplie et confirme l'import des profils choisis ; tu peux toujours ajouter un profil isolé ou coller manuellement des liens.</p>
              <p className="small soft">Si l'extension n'est pas installée, récupère-la dans Réglages → Intégrations → Rendevo Companion.</p>
            </div>
            <p className="small soft">Cette recherche ouvre LinkedIn dans la session Chrome active. Elle lit uniquement sur demande les liens des profils présents dans la page déjà chargée (pas les pages suivantes), puis propose une prévisualisation avant import ; les données disponibles dépendent de ton compte et des filtres LinkedIn.</p>
          </div>
        ) : mode === 'provider' ? (
          <div className="stack" style={{ '--gap': '12px' }}>
            <p className="soft">Recherche avec le fournisseur de la campagne (hors comptes assistés).</p>
            <Field label="Campagne"><CampaignSelect campaigns={automatic} value={campaign} onChange={setCampaign} allowNone={false} /></Field>
            <Field label="Nombre de profils"><input className="input num" type="number" min="1" max="20"
              value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(20, Number(e.target.value) || 10)))} /></Field>
          </div>
        ) : (
          <>
            <div className="alert info small">
              Recherche des profils professionnels <strong>déjà indexés sur le web</strong> par ton moteur de recherche configuré,
              à l'aide de requêtes ciblées <code>site:linkedin.com/in/</code> (dorks LinkedIn).
              Ni Rendevo ni Chrome Companion ne consultent LinkedIn automatiquement. Les résultats sont des suggestions à vérifier :
              certains postes ou entreprises peuvent être anciens.
            </div>
            <Field label="Campagne de destination">
              <CampaignSelect campaigns={assisted} value={campaign} onChange={(id) => { setCampaign(id); clearSearch(); setJobTitles(null); setTitleTags([]); setTitleTagsEdited(false); }} />
            </Field>
            <div className="grid-2">
              {[
                ['title', 'Poste recherché', 'titles', 'Ex. Directeur marketing'],
                ['industry', 'Secteur', 'industries', 'Ex. Logiciel B2B'],
                ['location', 'Localisation', 'locations', 'Ex. Paris'],
                ['keywords', 'Mots-clés', 'keywords', 'Ex. SaaS'],
              ].map(([field, label, source, example]) => (
                <Field key={field} label={label} hint={fromCampaign(source) ? `Cible campagne : ${fromCampaign(source)}` : undefined}>
                  {field === 'title' ? <>
                    <div className="row" style={{ gap: 6 }}>
                      <div className="job-title-selector">
                        {titleTags.map((title, index) => (
                          <span key={title} className={`job-title-tag job-title-tag-${index % 4}`}>
                            <span>{title}</span>
                            <button type="button" className="job-title-tag-remove"
                              aria-label={`Retirer le poste ${title}`} title={`Retirer ${title}`}
                              onClick={() => removeTitleTag(title)}><LuX /></button>
                          </span>
                        ))}
                        <input className="job-title-input" value={criteria.title} maxLength={70}
                          aria-label="Ajouter un intitulé de poste"
                          placeholder={titleTags.length ? 'Ajouter un poste…' : example}
                          onChange={(e) => { setCriteria((prev) => ({ ...prev, title: e.target.value })); setJobTitles(null); clearSearch(); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && criteria.title.trim()) {
                              e.preventDefault(); addTitleTag(criteria.title);
                            }
                          }} />
                      </div>
                      {criteria.title.trim() && <button type="button" className="btn sm icon"
                        title="Ajouter ce poste comme tag" aria-label="Ajouter ce poste comme tag"
                        disabled={titleTags.length >= 8} onClick={() => addTitleTag(criteria.title)}>
                        <LuPlus />
                      </button>}
                      <button type="button" className="btn sm icon"
                        aria-label="Générer les intitulés de poste avec l’IA" title="Générer les intitulés avec l’IA"
                        disabled={wizardBusy || busy || !(criteria.title.trim() || titleTags.length || fromCampaign('titles'))}
                        onClick={generateJobTitles}>
                        {wizardBusy ? <span className="spinner" /> : <LuWandSparkles />}
                      </button>
                    </div>
                    <p className="small soft">Chaque tag est un poste recherché. Plusieurs tags = OU logique dans le dork ; clique sur × pour en retirer un (maximum 8).</p>
                  </> : <input className="input" value={criteria[field]} maxLength={90} placeholder={example}
                    onChange={(e) => { setCriteria((prev) => ({ ...prev, [field]: e.target.value })); clearSearch(); }} />}
                </Field>
              ))}
            </div>
            {jobTitles && <div className="panel panel-pad stack" style={{ '--gap': '12px' }} role="region"
              aria-label="Intitulés de postes suggérés par l’IA">
              <div className="row spread wrap">
                <strong>Fonctions proposées pour « {titleSource} »</strong>
                <button className="btn sm ghost" type="button" onClick={() => setJobTitles(null)}>
                  Fermer les suggestions
                </button>
              </div>
              <p className="small soft">Choisis plusieurs intitulés : chacun s’ajoute comme tag et sera relié aux autres par OU dans le dork. Le mot-clé initial est remplacé à la première sélection. Aucun import automatique.</p>
              <Field label="Ajouter un intitulé ou une variante aux tags du poste recherché">
                <div className="row wrap" style={{ gap: 8 }}>
                  <select className="select" style={{ flex: 1, minWidth: 220 }}
                    value={selectedSuggestedTitle} onChange={(e) => setSelectedSuggestedTitle(e.target.value)}>
                    <option value="">— Choisir un intitulé —</option>
                    {[...new Set(jobTitles.map((row) => row.category))].map((category) => (
                      <optgroup key={category} label={category}>
                        {jobTitles.filter((row) => row.category === category).flatMap((row) => [
                          <option key={row.title + ':main'} value={row.title}>{row.title}</option>,
                          ...row.variants.map((variant) => <option key={row.title + ':' + variant}
                            value={variant}>{variant} (variante de {row.title})</option>),
                        ])}
                      </optgroup>
                    ))}
                  </select>
                  <button className="btn primary" type="button" disabled={!selectedSuggestedTitle || titleTags.length >= 8}
                    onClick={applySuggestedTitle}>Ajouter ce poste</button>
                </div>
              </Field>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Catégorie</th><th>Intitulé principal</th><th>Variantes et synonymes LinkedIn</th><th>Lien avec le mot-clé</th></tr></thead>
                  <tbody>
                    {jobTitles.map((row, index) => <tr key={row.title + ':' + index}>
                      <td>{row.category}</td>
                      <td><strong>{row.title}</strong></td>
                      <td>{row.variants.join(', ') || '—'}</td>
                      <td>{row.relation || '—'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>}
            <div className="grid-2">
              <Field label="Profils retenus par page (1–50)">
                <input className="input num" type="number" min="1" max="50" value={limit}
                  onChange={(e) => { setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 20))); clearSearch(); }} />
              </Field>
              <Field label="Affichage des résultats DeGoog">
                <select className="select" value={pagingMode} onChange={(e) => setPagingMode(e.target.value)}>
                  <option value="pages">Bouton Charger plus</option>
                  <option value="infinite">Défilement infini</option>
                </select>
              </Field>
            </div>
            <p className="small soft">DeGoog définit le nombre de résultats disponibles par page. Rendevo parcourt au maximum 20 pages et peut importer jusqu’à 200 profils sélectionnés ensemble.</p>
            {!config.loading && !config.data?.configured && (
              <p className="small soft">Aucun moteur de recherche configuré. <a href="/reglages?tab=recherche">Configurer dans Réglages → Recherche</a>.</p>
            )}
            <div className="row wrap">
              <button className="btn primary" disabled={busy || !config.data?.configured} onClick={search}>
                {busy ? <span className="spinner" /> : <LuSearch />}Rechercher des profils
              </button>
              <span className="small soft">Aucun import sans sélection et confirmation (200 profils maximum).</span>
            </div>
            {results && (
              <div className="stack" style={{ '--gap': '10px' }}>
                <div className="row spread wrap">
                  <strong>{results.length} profils publics suggérés — {chosenItems.length} sélectionnés</strong>
                  <button className="btn sm" onClick={() => setChosen(Object.fromEntries(results.map((item) => [item.linkedin_url, true])))}>
                    Tout sélectionner
                  </button>
                </div>
                {searchInfo?.provider === 'degoog' && <div className="panel panel-pad stack" style={{ '--gap': '5px' }}>
                  <strong className="small">Dorks réellement envoyés à DeGoog</strong>
                  {(searchInfo.attempts || []).map((attempt, index) =>
                    <div key={index} className="small">
                      <code style={{ overflowWrap: 'anywhere' }}>{attempt.query}</code>
                      <span className="soft"> — page {attempt.page || 1}, {attempt.results} résultats du moteur, {attempt.profiles} profil(s) LinkedIn retenus</span>
                    </div>)}
                </div>}
                {!results.length && <p className="small soft">
                  Aucun profil LinkedIn exploitable trouvé dans l'index public.
                  Essayez un seul poste ou une seule ville. Vérifiez aussi que l'instance DeGoog
                  utilise des moteurs qui indexent les profils LinkedIn publics (le test de connexion valide l'API,
                  pas la présence de profils).
                </p>}
                {results.map((item) => (
                  <div className="panel panel-pad stack" style={{ '--gap': '7px' }} key={item.linkedin_url}>
                    <label className="row" style={{ gap: 10 }}>
                      <input type="checkbox" checked={!!chosen[item.linkedin_url]}
                        onChange={(e) => setChosen((prev) => ({ ...prev, [item.linkedin_url]: e.target.checked }))} />
                      <strong>{item.title || 'Profil LinkedIn'}</strong>
                    </label>
                    <a className="small" href={item.linkedin_url} target="_blank" rel="noopener noreferrer">
                      Voir le profil source <LuExternalLink />
                    </a>
                    {item.description && <p className="small soft">{item.description}</p>}
                    <Field label="Nom à enregistrer (vérifier avant import)">
                      <input className="input" value={names[item.linkedin_url] ?? ''}
                        onChange={(e) => setNames((prev) => ({ ...prev, [item.linkedin_url]: e.target.value }))} />
                    </Field>
                  </div>
                ))}
                {searchInfo?.provider === 'degoog' && <div className="row wrap" style={{ justifyContent: 'center', gap: 10 }}>
                  <span className="small soft">Page {searchInfo.page}{searchInfo.total_pages ? ` / ${Math.min(searchInfo.total_pages, 20)}` : ''}</span>
                  {canLoadMore && pagingMode === 'pages' && <button className="btn" disabled={busy || loadingNext}
                    onClick={() => { void loadMore(); }}>{loadingNext ? 'Chargement…' : 'Charger la page suivante'}</button>}
                  {loadingNext && <span className="small soft">Chargement des profils suivants…</span>}
                  {!canLoadMore && <span className="small soft">Fin des résultats disponibles</span>}
                </div>}
                {pagingMode === 'infinite' && canLoadMore && <div ref={endOfResults} style={{ minHeight: 2 }} aria-hidden="true" />}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function ProspectDrawer({ id, campaigns, onClose, onChange }) {
  const { data: p, error, loading, reload } = useApi(`/api/prospects/${id}`);
  const [run, busy] = useAction();
  const [notes, setNotes] = useState(null);
  const [sig, setSig] = useState({ type: 'new_role', detail: '' });
  const [incoming, setIncoming] = useState('');

  const patch = (body, msg) => run(async () => { await api(`/api/prospects/${id}`, { method: 'PATCH', body }); reload(); onChange?.(); }, msg);

  return (
    <Drawer onClose={onClose} head={p ? (
      <div>
        <div className="row wrap" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 'var(--step-1)' }}>{p.heat === 'hot' ? <span className="hl">{p.full_name}</span> : p.full_name}</h2>
          <HeatBadge heat={p.heat} /><StatusBadge status={p.status} />
          {p.simulated && <span className="badge">Bac à sable</span>}
        </div>
        <div className="soft small" style={{ marginTop: 4 }}>{p.title || p.headline}{p.company ? `, ${p.company}` : ''}{p.location ? `, ${p.location}` : ''}</div>
      </div>
    ) : null}>
      {loading && !p && <Loading />}
      {error && <ErrorBox error={error} />}
      {p && (
        <div className="stack" style={{ '--gap': '22px' }}>
          <div className="row wrap">
            {p.linkedin_url && <a className="btn sm" href={p.linkedin_url} target="_blank" rel="noreferrer"><LuExternalLink />Profil LinkedIn</a>}
            <Link className="btn sm" to={`/messages/${p.id}`}>Ouvrir la conversation</Link>
            {['excluded', 'low_fit', 'not_accepted'].includes(p.status) && <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'qualified' }, 'Prospect requalifié')}>Contacter quand même</button>}
            {!['excluded', 'lost', 'won'].includes(p.status) && <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'excluded' }, 'Prospect exclu')}>Exclure</button>}
            {p.status === 'invited' && ['manual', 'linkedin_cookie', 'linkedin_companion'].includes(p.account?.provider) && <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api(`/api/prospects/${p.id}/accepted`, { method: 'POST' }); reload(); }, 'Invitation acceptée')}>Invitation acceptée</button>}
            {!['won', 'lost'].includes(p.status) && <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'won' }, 'Marqué gagné')}>Gagné</button>}
            {!['won', 'lost'].includes(p.status) && <button className="btn sm ghost" disabled={busy} onClick={() => patch({ status: 'lost' }, 'Marqué perdu')}>Perdu</button>}
          </div>

          {p.needs_human && <div className="alert warn">{p.human_reason || 'Ce prospect attend votre réponse.'} <Link to={`/messages/${p.id}`}>Répondre</Link></div>}

          <section>
            <div className="section-title">Pourquoi ce prospect</div>
            <p className="soft">{p.fit_reasoning || 'Pas encore qualifié.'}</p>
            {(p.signals || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {p.signals.map((s, i) => (
                  <div key={i} className="signal"><span className="hl small" style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{s.label}</span><span className="small soft grow">{s.detail}</span><span className="small muted">{s.date ? ago(s.date) : ''}</span></div>
                ))}
              </div>
            )}
            <div className="row wrap" style={{ marginTop: 10 }}>
              <select className="select" style={{ width: 'auto' }} value={sig.type} onChange={(e) => setSig({ ...sig, type: e.target.value })} aria-label="Type de signal">
                {SIGNAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="input grow" style={{ minWidth: 160 }} placeholder="Détail du signal" value={sig.detail} onChange={(e) => setSig({ ...sig, detail: e.target.value })} />
              <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api(`/api/prospects/${p.id}/signals`, { method: 'POST', body: sig }); setSig({ ...sig, detail: '' }); reload(); onChange?.(); }, 'Signal ajouté, prospect requalifié')}>Ajouter un signal</button>
            </div>
          </section>

          <section className="grid-2">
            <Field label="Campagne">
              <select className="select" value={p.campaign_id || ''} onChange={(e) => patch({ campaign_id: e.target.value || null }, 'Campagne mise à jour')}>
                <option value="">Aucune</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Étape commerciale" hint="Indépendante du statut LinkedIn.">
              <select className="select" value={p.stage} onChange={(e) => patch({ stage: e.target.value })}>
                {p.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </section>

          <section>
            <div className="section-title">Coordonnées</div>
            <dl className="kv">
              <dt>Source</dt><dd>{p.source}</dd>
              <dt>E-mail</dt><dd>{p.email || '–'}</dd>
              <dt>Téléphone</dt><dd>{p.phone || '–'}</dd>
              <dt>Ajouté</dt><dd>{ago(p.created_at)}</dd>
              {p.callback_at && <><dt>À relancer le</dt><dd>{new Date(p.callback_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></>}
            </dl>
          </section>

          <section>
            <div className="section-title">Notes</div>
            <textarea className="textarea" value={notes ?? p.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== p.notes && patch({ notes }, 'Notes enregistrées')} placeholder="Contexte utile à l'IA et à vous" />
          </section>

          {p.meetings.length > 0 && (
            <section>
              <div className="section-title">Rendez-vous</div>
              {p.meetings.map((m) => <div key={m.id} className="row spread small" style={{ padding: '4px 0' }}><span>{fmtDateTime(m.starts_at)}</span><span className={`badge ${m.status === 'confirmed' ? 'ok' : m.status === 'no_show' ? 'err' : ''}`}>{{ confirmed: 'Confirmé', done: 'Effectué', no_show: 'Absent', cancelled: 'Annulé' }[m.status]}</span></div>)}
            </section>
          )}

          <section>
            <div className="section-title">Conversation</div>
            {p.messages.length === 0 && <p className="small muted">Aucun message pour l'instant.</p>}
            <div className="stack" style={{ '--gap': '8px' }}>
              {p.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : m.status === 'pending_approval' ? 'pending' : m.status === 'queued' ? 'queued' : 'out'}`} style={{ maxWidth: '100%' }}>
                  {m.body || <em className="muted">Invitation sans note</em>}
                  <div className="bubble-meta">{KIND[m.kind] || m.kind}, {m.status === 'pending_approval' ? 'à valider' : m.status === 'queued' ? 'programmé' : m.status === 'failed' ? `échec : ${m.error}` : ago(m.sent_at || m.created_at)}</div>
                </div>
              ))}
            </div>
            {p.account?.provider !== 'unipile' && (
              <div className="row" style={{ marginTop: 10 }}>
                <input className="input grow" placeholder="Coller une réponse reçue sur LinkedIn" value={incoming} onChange={(e) => setIncoming(e.target.value)} />
                <button className="btn sm" disabled={busy || !incoming} onClick={() => run(async () => { await api(`/api/prospects/${p.id}/incoming`, { method: 'POST', body: { text: incoming } }); setIncoming(''); reload(); }, 'Réponse enregistrée, le setter prend le relais')}>Enregistrer</button>
              </div>
            )}
          </section>

          <section>
            <div className="section-title">Historique</div>
            <div className="timeline">
              {p.events.map((e, i) => <div key={i} className="ev"><span className="soft">{eventLabel(e)}</span> <span className="muted">{ago(e.created_at)}</span></div>)}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function eventLabel(e) {
  return {
    'prospect.found': 'Trouvé et qualifié',
    'invite.sent': 'Invitation envoyée',
    'invite.accepted': 'Invitation acceptée',
    'message.sent': `Message envoyé (${KIND[e.data?.kind] || e.data?.kind || ''})`,
    'message.received': 'Réponse reçue',
    'prospect.replied': 'Première réponse',
    'meeting.booked': 'Rendez-vous réservé',
    'meeting.no_show': 'Absent au rendez-vous',
    'meeting.cancelled': 'Rendez-vous annulé',
    'meeting.done': 'Rendez-vous effectué',
    'prospect.handoff': `Transmis à vous : ${e.data?.reason || ''}`,
    'callback.scheduled': 'Relance programmée',
  }[e.type] || e.type;
}
