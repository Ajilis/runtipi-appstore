// Form sections shared by onboarding and settings.
import React from 'react';
import { Field, Chips, Seg, Switch } from '../lib.jsx';

export function OfferEditor({ value = {}, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="stack" style={{ '--gap': '14px' }}>
      <div className="grid-2">
        <Field label="Nom de l'offre"><input className="input" value={value.offer_name || ''} onChange={set('offer_name')} placeholder="Ex. Pipeline Express" /></Field>
        <Field label="Objectif de conversation" hint="Ce que l'agent cherche à obtenir."><input className="input" value={value.cta || ''} onChange={set('cta')} placeholder="Appel découverte de 30 minutes" /></Field>
      </div>
      <Field label="Ce que vous proposez" hint="Deux ou trois phrases, comme vous l'expliqueriez à un prospect.">
        <textarea className="textarea" value={value.summary || ''} onChange={set('summary')} />
      </Field>
      <Field label="Promesse principale"><input className="input" value={value.value_prop || ''} onChange={set('value_prop')} placeholder="Un résultat concret et mesurable" /></Field>
      <Field label="Preuves" hint="Chiffres, clients, résultats. L'IA ne citera que ce que vous écrivez ici.">
        <input className="input" value={value.proof || ''} onChange={set('proof')} placeholder="Ex. 40 PME accompagnées, +35 % de rendez-vous qualifiés" />
      </Field>
      <Field label="Site web"><input className="input" value={value.website || ''} onChange={set('website')} placeholder="https://" /></Field>
    </div>
  );
}

export function IcpEditor({ value = {}, onChange, compact }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="stack" style={{ '--gap': '14px' }}>
      <Field label="Postes ciblés" hint="Appuyez sur Entrée après chaque intitulé.">
        <Chips value={value.titles} onChange={set('titles')} placeholder="Fondateur, Directeur commercial…" />
      </Field>
      <div className={compact ? 'stack' : 'grid-2'} style={{ '--gap': '14px' }}>
        <Field label="Secteurs"><Chips value={value.industries} onChange={set('industries')} placeholder="Logiciels, Conseil…" /></Field>
        <Field label="Zones"><Chips value={value.locations} onChange={set('locations')} placeholder="France, Belgique…" /></Field>
        <Field label="Taille d'entreprise"><Chips value={value.company_sizes} onChange={set('company_sizes')} placeholder="11-50, 51-200…" /></Field>
        <Field label="Mots-clés de besoin" hint="Termes qui trahissent un besoin dans un profil."><Chips value={value.keywords} onChange={set('keywords')} placeholder="prospection, croissance…" /></Field>
      </div>
      <Field label="À exclure" hint="Profils jamais contactés : concurrents, étudiants, contacts personnels.">
        <Chips value={value.exclusions} onChange={set('exclusions')} placeholder="Étudiant, Recruteur…" />
      </Field>
      <Field label="Entreprises exclues"><Chips value={value.excluded_companies} onChange={set('excluded_companies')} placeholder="Vos concurrents, vos clients actuels…" /></Field>
    </div>
  );
}

export function VoiceEditor({ value = {}, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const examples = value.examples?.length ? value.examples : [''];
  return (
    <div className="stack" style={{ '--gap': '14px' }}>
      <div className="grid-2">
        <Field label="Nom de l'expéditeur"><input className="input" value={value.sender_name || ''} onChange={set('sender_name')} /></Field>
        <Field label="Tutoiement ou vouvoiement">
          <div><Seg value={value.formality || 'vous'} onChange={(v) => onChange({ ...value, formality: v })} options={[{ value: 'vous', label: 'Vous' }, { value: 'tu', label: 'Tu' }]} /></div>
        </Field>
      </div>
      <Field label="Ton" hint="Ex. direct et chaleureux, expert mais simple, un brin d'humour.">
        <input className="input" value={value.tone || ''} onChange={set('tone')} />
      </Field>
      <Field label="Exemples de vos messages" hint="Collez de vrais messages que vous avez envoyés : l'IA imite votre style.">
        <div className="stack" style={{ '--gap': '8px' }}>
          {examples.map((ex, i) => (
            <textarea key={i} className="textarea" style={{ minHeight: 70 }} value={ex} placeholder={`Exemple ${i + 1}`}
              onChange={(e) => { const next = [...examples]; next[i] = e.target.value; onChange({ ...value, examples: next }); }} />
          ))}
          {examples.length < 4 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...value, examples: [...examples, ''] })}>Ajouter un exemple</button>}
        </div>
      </Field>
      <Field label="Signature" hint="Ajoutée aux messages (pas aux invitations).">
        <input className="input" value={value.signature || ''} onChange={set('signature')} placeholder="Ex. Alex, Pipeline Express" />
      </Field>
    </div>
  );
}

const DAYS = [
  { v: 1, l: 'Lun' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mer' }, { v: 4, l: 'Jeu' }, { v: 5, l: 'Ven' }, { v: 6, l: 'Sam' }, { v: 7, l: 'Dim' },
];

export function DaysPicker({ value = [], onChange }) {
  const set = new Set((value || []).map(Number));
  return (
    <div className="seg" role="group" aria-label="Jours">
      {DAYS.map((d) => (
        <button key={d.v} type="button" className={set.has(d.v) ? 'on' : ''} aria-pressed={set.has(d.v)}
          onClick={() => { const n = new Set(set); if (n.has(d.v)) n.delete(d.v); else n.add(d.v); onChange([...n].sort()); }}>{d.l}</button>
      ))}
    </div>
  );
}

export function AvailabilityEditor({ value = {}, onChange, goal, onGoal }) {
  const set = (k, num) => (e) => onChange({ ...value, [k]: num ? Number(e.target.value) : e.target.value });
  return (
    <div className="stack" style={{ '--gap': '14px' }}>
      <Field label="Jours de rendez-vous"><div><DaysPicker value={value.days} onChange={(days) => onChange({ ...value, days })} /></div></Field>
      <div className="grid-3">
        <Field label="Début"><input className="input" type="time" value={value.start || '09:00'} onChange={set('start')} /></Field>
        <Field label="Fin"><input className="input" type="time" value={value.end || '18:00'} onChange={set('end')} /></Field>
        <Field label="Durée d'un RDV">
          <select className="select" value={value.slot_minutes || 30} onChange={set('slot_minutes', true)}>
            {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Field>
        <Field label="Pause déjeuner, début"><input className="input" type="time" value={value.lunch_start || ''} onChange={set('lunch_start')} /></Field>
        <Field label="Pause déjeuner, fin"><input className="input" type="time" value={value.lunch_end || ''} onChange={set('lunch_end')} /></Field>
        <Field label="Battement entre RDV">
          <select className="select" value={value.buffer_minutes ?? 15} onChange={set('buffer_minutes', true)}>
            {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Field>
        <Field label="Délai minimum avant un RDV">
          <select className="select" value={value.min_notice_hours ?? 20} onChange={set('min_notice_hours', true)}>
            {[2, 4, 12, 20, 24, 48].map((h) => <option key={h} value={h}>{h} heures</option>)}
          </select>
        </Field>
        <Field label="Maximum par jour"><input className="input num" type="number" min="1" max="20" value={value.max_per_day ?? 4} onChange={set('max_per_day', true)} /></Field>
        <Field label="Rappel avant le RDV">
          <select className="select" value={value.reminder_hours ?? 3} onChange={set('reminder_hours', true)}>
            {[1, 2, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h} h avant</option>)}
          </select>
        </Field>
      </div>
      <Field label="Lien de visio" hint="Votre salle Meet, Zoom ou Teams permanente. Vide : une salle Jitsi unique est créée pour chaque RDV.">
        <input className="input" value={value.meeting_url || ''} onChange={set('meeting_url')} placeholder="https://meet.google.com/…" />
      </Field>
      <Field label="Agenda existant (adresse iCal secrète)" hint="Google Agenda : Paramètres > votre agenda > Adresse secrète au format iCal. Vos créneaux occupés ne seront jamais proposés.">
        <input className="input" value={value.busy_ics_url || ''} onChange={set('busy_ics_url')} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
      </Field>
      <Field label="Fuseau horaire"><input className="input" value={value.timezone || 'Europe/Paris'} onChange={set('timezone')} /></Field>
      {onGoal && (
        <Field label="Objectif de rendez-vous par semaine">
          <input className="input num" type="number" min="1" max="50" style={{ maxWidth: 120 }} value={goal ?? 5} onChange={(e) => onGoal(Number(e.target.value))} />
        </Field>
      )}
    </div>
  );
}

export function ScheduleEditor({ value = {}, onChange }) {
  return (
    <div className="stack" style={{ '--gap': '14px' }}>
      <Field label="Jours d'activité de l'agent"><div><DaysPicker value={value.days} onChange={(days) => onChange({ ...value, days })} /></div></Field>
      <div className="grid-3">
        <Field label="De"><input className="input" type="time" value={value.start || '08:30'} onChange={(e) => onChange({ ...value, start: e.target.value })} /></Field>
        <Field label="À"><input className="input" type="time" value={value.end || '19:00'} onChange={(e) => onChange({ ...value, end: e.target.value })} /></Field>
        <Field label="Fuseau"><input className="input" value={value.timezone || 'Europe/Paris'} onChange={(e) => onChange({ ...value, timezone: e.target.value })} /></Field>
      </div>
    </div>
  );
}

export function CampaignToggles({ value, onChange }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="stack" style={{ '--gap': '14px' }}>
      <Field label="Validation humaine" hint="Les messages à valider attendent dans Messages.">
        <div><Seg value={value.validation} onChange={set('validation')} options={[{ value: 'none', label: 'Pilote automatique' }, { value: 'first', label: 'Premiers messages' }, { value: 'all', label: 'Tous les messages' }]} /></div>
      </Field>
      <Switch checked={value.setter_enabled} onChange={set('setter_enabled')} label="Setter IA : répond aux prospects et réserve les rendez-vous" />
      <Switch checked={value.followups_enabled} onChange={set('followups_enabled')} label="Relances automatiques tant que le prospect ne répond pas" />
      <Switch checked={value.auto_discovery} onChange={set('auto_discovery')} label="Recherche automatique de nouveaux prospects" />
    </div>
  );
}
