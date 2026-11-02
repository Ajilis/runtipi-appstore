// Envoi d'e-mails sans dépendance : client SMTP minimal (STARTTLS, SSL/TLS implicite ou connexion simple ;
// authentification PLAIN ou LOGIN), message MIME UTF-8 texte + HTML, et modèles des messages de Vigie.
import { formatNumber } from './format.js';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export const SECURITY_MODES = ['starttls', 'tls', 'none'];
const COMMAND_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 12_000;

export class SmtpError extends Error {
  constructor(message, { stage = '', code = null, response = '' } = {}) {
    super(message);
    this.stage = stage;
    this.code = code;
    this.response = response;
  }
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

// --- Réponses SMTP ------------------------------------------------------------------------------------------------
// Une réponse peut tenir sur plusieurs lignes (« 250-… » puis « 250 … »).
class SmtpReader {
  constructor() {
    this.buf = '';
    this.lines = [];
    this.ready = [];
    this.waiter = null;
    this.failure = null;
  }

  attach(socket) {
    this.socket = socket;
    this.onData = (d) => this.push(d);
    this.onError = (e) => this.fail(e);
    this.onClose = () => this.fail(new SmtpError('Le serveur a fermé la connexion.', { stage: 'connexion' }));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  detach() {
    if (!this.socket) return;
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.socket = null;
  }

  push(chunk) {
    this.buf += chunk.toString('utf8');
    if (this.buf.length > 64 * 1024) { this.fail(new SmtpError('Réponse du serveur trop longue.', { stage: 'protocole' })); return; }
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const resp = { code: Number(line.slice(0, 3)), lines: this.lines.map((l) => l.slice(4)), text: this.lines.join(' | ') };
        this.lines = [];
        if (this.waiter) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.resolve(resp); } else this.ready.push(resp);
      }
    }
  }

  fail(err) {
    if (!this.failure) this.failure = err;
    if (this.waiter) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.reject(err); }
  }

  read(stage, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (this.ready.length) return Promise.resolve(this.ready.shift());
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(new SmtpError('Le serveur ne répond pas.', { stage, code: 'TIMEOUT' })); }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function connectSocket(conf) {
  return new Promise((resolve, reject) => {
    const opts = { host: conf.host, port: conf.port };
    const socket = conf.security === 'tls'
      ? tls.connect({ ...opts, servername: net.isIP(conf.host) ? undefined : conf.host, rejectUnauthorized: !conf.allow_invalid_cert, minVersion: 'TLSv1.2' })
      : net.connect(opts);
    const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, CONNECT_TIMEOUT_MS);
    socket.once(conf.security === 'tls' ? 'secureConnect' : 'connect', () => { clearTimeout(timer); socket.off('error', onError); resolve(socket); });
    const onError = (err) => { clearTimeout(timer); reject(err); };
    socket.once('error', onError);
  });
}

function upgradeSocket(socket, conf) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: net.isIP(conf.host) ? undefined : conf.host, rejectUnauthorized: !conf.allow_invalid_cert, minVersion: 'TLSv1.2' });
    const timer = setTimeout(() => { secure.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, CONNECT_TIMEOUT_MS);
    secure.once('secureConnect', () => { clearTimeout(timer); secure.off('error', onError); resolve(secure); });
    const onError = (err) => { clearTimeout(timer); reject(err); };
    secure.once('error', onError);
  });
}

// Message d'erreur compréhensible pour une panne de connexion ou de chiffrement.
function explainNetworkError(err, conf) {
  if (err instanceof SmtpError) return err;
  const code = err.code || '';
  const where = `${conf.host}:${conf.port}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new SmtpError(`Serveur introuvable : « ${conf.host} ». Vérifiez son nom.`, { stage: 'connexion', code });
  if (code === 'ECONNREFUSED') return new SmtpError(`Connexion refusée par ${where}. Vérifiez le port, ou que le conteneur peut sortir sur Internet.`, { stage: 'connexion', code });
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return new SmtpError(`Pas de réponse de ${where}. Le port est peut-être bloqué par votre fournisseur d'accès ou un pare-feu.`, { stage: 'connexion', code });
  if (code === 'ECONNRESET' || code === 'EPIPE') return new SmtpError(`Connexion coupée par ${where}. Vérifiez le mode de sécurité : SSL/TLS pour le port 465, STARTTLS pour le port 587.`, { stage: 'connexion', code });
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(code)) {
    return new SmtpError(`Certificat du serveur refusé (${code}). Vérifiez le nom du serveur. Pour un relais de votre réseau local seulement, cochez « Accepter un certificat non vérifié ».`, { stage: 'chiffrement', code });
  }
  if (/WRONG_VERSION_NUMBER|wrong version number|packet length too long|SSL routines/i.test(`${code} ${err.message}`)) {
    return new SmtpError(`Le serveur ne parle pas SSL/TLS sur le port ${conf.port} : choisissez STARTTLS (port 587) ou « Aucune ».`, { stage: 'chiffrement', code: code || 'TLS' });
  }
  return new SmtpError(`Échec de la connexion à ${where} : ${err.message}`, { stage: 'connexion', code });
}

function explainReply(stage, resp) {
  const detail = `réponse ${resp.text}`.slice(0, 300);
  if (stage === 'authentification') {
    if (resp.code === 535 || resp.code === 534) return `Identifiant ou mot de passe refusé par le serveur (${detail}). Pour Gmail, iCloud ou Outlook, utilisez un mot de passe d'application.`;
    return `Authentification refusée (${detail}).`;
  }
  if (stage === 'expéditeur') {
    if (resp.code === 530) return `Le serveur exige une authentification avant l'envoi (${detail}) : renseignez l'identifiant et le mot de passe.`;
    return `Adresse d'expéditeur refusée (${detail}). Beaucoup de serveurs n'acceptent que l'adresse du compte utilisé.`;
  }
  if (stage === 'destinataire') return `Destinataire refusé (${detail}).`;
  if (stage === 'accueil') return `Le serveur refuse la connexion (${detail}).`;
  return `Le serveur a refusé l'étape « ${stage} » (${detail}).`;
}

class Session {
  constructor(conf) { this.conf = conf; this.reader = new SmtpReader(); this.socket = null; }

  use(socket) { this.reader.detach(); this.socket = socket; this.reader.attach(socket); }

  async expect(stage, codes) {
    const resp = await this.reader.read(stage);
    if (!codes.includes(resp.code)) throw new SmtpError(explainReply(stage, resp), { stage, code: resp.code, response: resp.text });
    return resp;
  }

  async command(line, stage, codes) {
    this.socket.write(`${line}\r\n`);
    return this.expect(stage, codes);
  }

  async hello(name) {
    this.socket.write(`EHLO ${name}\r\n`);
    const resp = await this.reader.read('présentation');
    if (resp.code === 250) {
      const caps = resp.lines.slice(1).map((l) => l.toUpperCase());
      const auth = caps.find((c) => c.startsWith('AUTH')) || '';
      return { starttls: caps.some((c) => c === 'STARTTLS'), auth: auth.replace(/^AUTH[ =]/, '').split(/\s+/).filter(Boolean) };
    }
    await this.command(`HELO ${name}`, 'présentation', [250]);
    return { starttls: false, auth: [] };
  }

  close() {
    this.reader.detach();
    if (this.socket) { this.socket.end(); this.socket.destroy(); }
  }
}

// Envoie un message déjà construit (voir buildMessage). Renvoie la dernière réponse du serveur.
export async function sendMail(conf, { to, raw }) {
  if (!isEmail(to)) throw new SmtpError('Adresse du destinataire invalide.', { stage: 'destinataire' });
  const s = new Session(conf);
  const name = conf.hello_name || 'localhost';
  try {
    try { s.use(await connectSocket(conf)); } catch (err) { throw explainNetworkError(err, conf); }
    try {
      await s.expect('accueil', [220]);
    } catch (err) {
      if (err.code === 'TIMEOUT' && conf.security !== 'tls') throw new SmtpError(`Aucun message d'accueil du serveur. Sur le port 465, choisissez « SSL/TLS ».`, { stage: 'accueil', code: 'TIMEOUT' });
      throw explainNetworkError(err, conf);
    }
    let caps = await s.hello(name);
    if (conf.security === 'starttls') {
      if (!caps.starttls) throw new SmtpError("Le serveur ne propose pas STARTTLS sur ce port : choisissez « SSL/TLS » (port 465) ou « Aucune » pour un relais local.", { stage: 'chiffrement' });
      await s.command('STARTTLS', 'chiffrement', [220]);
      const plain = s.socket;
      s.reader.detach();
      try { s.use(await upgradeSocket(plain, conf)); } catch (err) { throw explainNetworkError(err, conf); }
      caps = await s.hello(name);
    }
    if (conf.username) {
      if (caps.auth.includes('PLAIN') || !caps.auth.includes('LOGIN')) {
        await s.command(`AUTH PLAIN ${b64(`\0${conf.username}\0${conf.password || ''}`)}`, 'authentification', [235]);
      } else {
        await s.command('AUTH LOGIN', 'authentification', [334]);
        await s.command(b64(conf.username), 'authentification', [334]);
        await s.command(b64(conf.password || ''), 'authentification', [235]);
      }
    }
    await s.command(`MAIL FROM:<${conf.from_address}>`, 'expéditeur', [250]);
    await s.command(`RCPT TO:<${to}>`, 'destinataire', [250, 251]);
    await s.command('DATA', 'envoi', [354]);
    // Point en début de ligne doublé (RFC 5321, 4.5.2), fin du message par une ligne contenant un seul point.
    s.socket.write(`${raw.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
    const done = await s.expect('envoi', [250]);
    try { await s.command('QUIT', 'fin', [221]); } catch { /* sans importance */ }
    return { response: done.text };
  } catch (err) {
    throw explainNetworkError(err, conf);
  } finally {
    s.close();
  }
}

// --- Message MIME -------------------------------------------------------------------------------------------------
const oneLine = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();

// En-tête encodé (RFC 2047) découpé en mots de 75 caractères au plus, sans couper un caractère UTF-8.
export function encodeHeader(value) {
  const v = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  const words = [];
  let cur = '';
  for (const ch of v) {
    if (Buffer.byteLength(cur + ch) > 45) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
}

const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');

export function buildMessage({ fromAddress, fromName, to, subject, text, html, date = new Date() }) {
  if (!isEmail(fromAddress) || !isEmail(to)) throw new SmtpError('Adresse e-mail invalide.', { stage: 'message' });
  const domain = fromAddress.split('@')[1];
  const boundary = `vigie-${crypto.randomBytes(12).toString('hex')}`;
  const name = oneLine(fromName);
  const from = name ? (/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}" <${fromAddress}>` : `${encodeHeader(name)} <${fromAddress}>`) : fromAddress;
  const headers = [
    `From: ${from}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace(/GMT$/, '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(body, 'utf8').toString('base64'))].join('\r\n');
  return [...headers, '', part('text/plain', text.replace(/\r?\n/g, '\r\n')), part('text/html', html), `--${boundary}--`, ''].join('\r\n');
}

// --- Modèles des messages ----------------------------------------------------------------------------------------
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE_LABEL = { admin: 'administrateur (tout, y compris les comptes et les sauvegardes)', editor: 'éditeur (avoirs, valeurs et catégories)', viewer: 'lecture seule (consultation et export)' };
export const frDateTime = (ms) => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function layout({ title, paragraphs, button, footer }) {
  const font = 'font-family:Arial,Helvetica,sans-serif';
  const p = paragraphs.map((x) => `<p style="margin:0 0 14px">${x}</p>`).join('');
  const btn = button ? `<p style="margin:24px 0"><a href="${escHtml(button.url)}" style="display:inline-block;background:#1e5a4e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${escHtml(button.label)}</a></p>
    <p style="margin:0 0 14px;font-size:13px;color:#5d6b68">Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br><a href="${escHtml(button.url)}" style="color:#1e5a4e;word-break:break-all">${escHtml(button.url)}</a></p>` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f6f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border:1px solid #dfe7e4;border-radius:12px">
<tr><td style="padding:22px 28px 4px;${font};color:#1e5a4e;font-size:15px;font-weight:bold">Vigie Patrimoine</td></tr>
<tr><td style="padding:8px 28px 18px;${font};color:#17201e;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;font-weight:bold">${escHtml(title)}</h1>${p}${btn}</td></tr>
<tr><td style="padding:14px 28px 18px;border-top:1px solid #dfe7e4;${font};font-size:12px;line-height:1.5;color:#6f7d7a">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

// Chaque modèle renvoie { subject, text, html } ; les valeurs saisies par les utilisateurs sont échappées.
export const templates = {
  test({ host, port, security, by, at }) {
    const sec = { starttls: 'STARTTLS', tls: 'SSL/TLS', none: 'sans chiffrement' }[security] || security;
    return {
      subject: "Test d'envoi de Vigie Patrimoine",
      text: `L'envoi d'e-mails fonctionne.\n\nVigie pourra envoyer les invitations et les liens « Mot de passe oublié ».\n\nServeur : ${host}:${port} (${sec})\nTest demandé par ${by} le ${frDateTime(at)}.\n`,
      html: layout({
        title: "L'envoi d'e-mails fonctionne",
        paragraphs: ['Vigie pourra envoyer les invitations et les liens « Mot de passe oublié ».', `Serveur : <b>${escHtml(host)}:${escHtml(port)}</b> (${escHtml(sec)})`],
        footer: `Test demandé par ${escHtml(by)} le ${escHtml(frDateTime(at))}.`,
      }),
    };
  },

  // Proposition de partage d'un avoir (compte, placement, bien, crédit…) avec un autre compte du serveur.
  holdingShare({ firstName, inviter, holdingName, categoryName, ownershipPct, url, expiresAt }) {
    const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
    const percent = formatNumber(ownershipPct);
    const what = categoryName ? `l'avoir « ${holdingName} » (${categoryName})` : `l'avoir « ${holdingName} »`;
    const title = 'Demande de partage sur Vigie Patrimoine';
    return {
      subject: `${inviter} propose de partager un avoir avec vous sur Vigie Patrimoine`,
      text: `${hello}\n\n${inviter} vous propose une quote-part de ${percent} % sur ${what} dans Vigie.\n\nConnectez-vous avec votre compte habituel sur le même serveur : la demande s'affiche en haut de vos Avoirs, avec les boutons Accepter et Refuser.\n${url}\n\nCette proposition expire le ${frDateTime(expiresAt)}. Rien n'est ajouté à votre patrimoine sans votre accord.\n\nCe partage organise le suivi patrimonial dans Vigie et ne constitue pas un acte de transfert de propriété.\n`,
      html: layout({
        title,
        paragraphs: [escHtml(hello),
          `${escHtml(inviter)} vous propose une quote-part de <b>${escHtml(percent)} %</b> sur ${escHtml(what)}.`,
          'Connectez-vous à votre compte sur le même serveur : la demande s\'affiche en haut de vos Avoirs. Rien n\'est ajouté à votre patrimoine avant votre accord.'],
        button: { label: 'Voir la demande de partage', url },
        footer: `Demande valable jusqu'au ${escHtml(frDateTime(expiresAt))}. Un partage dans Vigie ne constitue pas un acte juridique de transfert de propriété.`,
      }),
    };
  },

  invitation({ firstName, inviter, role, url, expiresAt }) {
    const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
    return {
      subject: `${inviter} vous invite sur Vigie Patrimoine`,
      text: `${hello}\n\n${inviter} vous invite à rejoindre Vigie Patrimoine, le suivi de patrimoine de votre foyer, avec le rôle ${ROLE_LABEL[role]}.\n\nCréez votre compte en ouvrant ce lien :\n${url}\n\nVous choisirez votre nom d'utilisateur et votre mot de passe. Ce lien est valable jusqu'au ${frDateTime(expiresAt)} et ne sert qu'une fois.\n\nSi vous ne vous attendiez pas à cette invitation, ignorez ce message : aucun compte n'est créé sans votre action.\n`,
      html: layout({
        title: `${inviter} vous invite sur Vigie Patrimoine`,
        paragraphs: [escHtml(hello), `${escHtml(inviter)} vous invite à rejoindre <b>Vigie Patrimoine</b>, le suivi de patrimoine de votre foyer, avec le rôle <b>${escHtml(ROLE_LABEL[role])}</b>.`,
          "Vous choisirez votre nom d'utilisateur et votre mot de passe."],
        button: { label: 'Créer mon compte', url },
        footer: `Ce lien est valable jusqu'au ${escHtml(frDateTime(expiresAt))} et ne sert qu'une fois. Si vous ne vous attendiez pas à cette invitation, ignorez ce message : aucun compte n'est créé sans votre action.`,
      }),
    };
  },

  reset({ firstName, username, url, expiresAt, ip, at }) {
    const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
    return {
      subject: 'Réinitialisation de votre mot de passe Vigie Patrimoine',
      text: `${hello}\n\nUne réinitialisation du mot de passe du compte « ${username} » a été demandée le ${frDateTime(at)} depuis l'adresse ${ip}.\n\nChoisissez un nouveau mot de passe en ouvrant ce lien :\n${url}\n\nCe lien est valable jusqu'au ${frDateTime(expiresAt)} et ne sert qu'une fois. Si la double authentification est activée, elle restera demandée.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.\n`,
      html: layout({
        title: 'Réinitialisation de votre mot de passe',
        paragraphs: [escHtml(hello), `Une réinitialisation du mot de passe du compte <b>${escHtml(username)}</b> a été demandée le ${escHtml(frDateTime(at))} depuis l'adresse ${escHtml(ip)}.`],
        button: { label: 'Choisir un nouveau mot de passe', url },
        footer: `Ce lien est valable jusqu'au ${escHtml(frDateTime(expiresAt))} et ne sert qu'une fois. Si la double authentification est activée, elle restera demandée. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.`,
      }),
    };
  },

  passwordChanged({ firstName, username, ip, at, how }) {
    const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
    const what = how === 'reset' ? 'à la suite d\'une demande « Mot de passe oublié »' : 'depuis Mon compte';
    return {
      subject: 'Votre mot de passe Vigie Patrimoine a été modifié',
      text: `${hello}\n\nLe mot de passe du compte « ${username} » a été modifié le ${frDateTime(at)} ${what}, depuis l'adresse ${ip}. Les autres sessions ont été fermées.\n\nSi vous n'êtes pas à l'origine de ce changement, contactez immédiatement l'administrateur de Vigie.\n`,
      html: layout({
        title: 'Votre mot de passe a été modifié',
        paragraphs: [escHtml(hello), `Le mot de passe du compte <b>${escHtml(username)}</b> a été modifié le ${escHtml(frDateTime(at))} ${escHtml(what)}, depuis l'adresse ${escHtml(ip)}. Les autres sessions ont été fermées.`,
          "Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement l'administrateur de Vigie."],
        footer: 'Message automatique de Vigie Patrimoine, envoyé à chaque changement de mot de passe.',
      }),
    };
  },
};
