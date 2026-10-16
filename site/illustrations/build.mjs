// Illustrations de la solution : site, livrable PDF, vidéo.
// Source unique : on modifie ce script, pas les SVG générés (voir site/DIRECTIVES.md).
//   node site/illustrations/build.mjs
//
// Chaque scène fait 1600×900 (16:9, une image clé de la vidéo). Chaque élément est un groupe
// nommé (<g id="…">), dans l'ordre où il s'animera.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const W = 1600;
const H = 900;

// Palette : « Identité visuelle » dans DIRECTIVES.md.
const C = {
  ink: '#18181B',
  muted: '#52525B',
  faint: '#A1A1AA',
  line: '#D4D4D8',
  surface: '#F4F4F5',
  plati: '#2D7A5F',
  platiBg: '#E8F3EE',
  sshx: '#BE185D',
  sshxBg: '#FCE7F3',
  platform: '#4F46E5',
  platformBg: '#EEF2FF',
  amber: '#D97706',
  amberDark: '#B45309',
  amberBg: '#FEF3C7',
  done: '#059669',
  doneBg: '#D1FAE5',
  net: '#64748B',
  netBg: '#F8FAFC',
  entra: '#0369A1',
  entraBg: '#E0F2FE',
  red: '#DC2626',
};

// Interface de SSHX Platform : palette zinc sombre, états comme dans l'application.
const Z = {
  950: '#09090B',
  900: '#18181B',
  800: '#27272A',
  700: '#3F3F46',
  600: '#52525B',
  500: '#71717A',
  400: '#A1A1AA',
  300: '#D4D4D8',
  200: '#E4E4E7',
  100: '#F4F4F5',
};
const ETAT = {
  working: { label: 'au travail', light: C.platform, dark: '#818CF8' },
  question: { label: 'question', light: C.amber, dark: '#FBBF24' },
  permission: { label: 'autorisation', light: C.amber, dark: '#FBBF24' },
  done: { label: 'terminé', light: C.done, dark: '#34D399' },
  none: { label: '', light: C.faint, dark: Z[600] },
};

const CHIP = {
  claude: ['Claude Code', C.amberDark, C.amberBg],
  sshx: ['SSHX', C.sshx, C.sshxBg],
  tailscale: ['Tailscale', C.net, '#F1F5F9'],
  docker: ['Docker', '#0E7490', '#CFFAFE'],
  vscode: ['VS Code', '#1D4ED8', '#DBEAFE'],
};

// ---------------------------------------------------------------------------------------------
// Primitives

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Largeur approximative d'un texte en Inter (pour dimensionner pastilles et cadres). */
function tw(str, size, weight = 400, mono = false) {
  if (mono) return str.length * size * 0.6;
  let em = 0;
  for (const ch of str) {
    if (" .,:;'’!|()[]ilIjtfr·".includes(ch)) em += 0.32;
    else if ('mwMW'.includes(ch)) em += 0.86;
    else if (/[A-ZÉÈÀÇ]/.test(ch)) em += 0.68;
    else if (/[0-9]/.test(ch)) em += 0.6;
    else em += 0.56;
  }
  return em * size * (weight >= 600 ? 1.05 : 1);
}

function T(x, y, s, o = {}) {
  const { size = 22, weight = 400, fill = C.ink, anchor = 'start', mono = false } = o;
  const a = anchor === 'start' ? '' : ` text-anchor="${anchor}"`;
  const m = mono ? ' class="mono" xml:space="preserve"' : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${m}>${esc(s)}</text>`;
}

/** Plusieurs lignes, `lh` d'interligne. */
function TL(x, y, lines, o = {}) {
  const lh = o.lh ?? Math.round((o.size ?? 22) * 1.35);
  return lines.map((l, i) => T(x, y + i * lh, l, o)).join('');
}

function R(x, y, w, h, o = {}) {
  const { r = 12, fill = 'none', stroke = 'none', sw = 2, dash } = o;
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${d}/>`;
}

/** Rectangle aux coins arrondis en haut seulement. */
function rt(x, y, w, h, r, fill) {
  return `<path d="M${x} ${y + h} V${y + r} a${r} ${r} 0 0 1 ${r} ${-r} H${x + w - r} a${r} ${r} 0 0 1 ${r} ${r} V${y + h} Z" fill="${fill}"/>`;
}

/** Rectangle aux coins arrondis en bas seulement. */
function rb(x, y, w, h, r, fill) {
  return `<path d="M${x} ${y} H${x + w} V${y + h - r} a${r} ${r} 0 0 1 ${-r} ${r} H${x + r} a${r} ${r} 0 0 1 ${-r} ${-r} Z" fill="${fill}"/>`;
}

const G = (id, body) => `<g id="${id}">${body}</g>\n`;

let markers = new Set();

function arrow(d, o = {}) {
  const { color = C.muted, sw = 3, dash, start = false, end = true } = o;
  markers.add(color);
  const id = `pointe-${color.slice(1)}`;
  const da = dash ? ` stroke-dasharray="${dash}"` : '';
  const ms = start ? ` marker-start="url(#${id})"` : '';
  const me = end ? ` marker-end="url(#${id})"` : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${da}${ms}${me}/>`;
}

function chips(x, y, items, maxW, o = {}) {
  const { size = 18, h = 36, gap = 10 } = o;
  let cx = x;
  let cy = y;
  let out = '';
  for (const [label, color, bg] of items) {
    const w = Math.round(tw(label, size, 600) + 24);
    if (cx > x && cx + w > x + maxW) {
      cx = x;
      cy += h + gap;
    }
    out += R(cx, cy, w, h, { r: h / 2, fill: bg, stroke: color, sw: 1.5 });
    out += T(cx + w / 2, cy + h / 2 + size * 0.35, label, { size, weight: 600, fill: color, anchor: 'middle' });
    cx += w + gap;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pictogrammes

function person(cx, cy, o = {}) {
  const { r = 40, color = C.ink, bg = C.surface, ring } = o;
  const ringAttr = ring ? ` stroke="${ring}" stroke-width="4"` : '';
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}"${ringAttr}/>` +
    `<circle cx="${cx}" cy="${cy - r * 0.22}" r="${r * 0.28}" fill="${color}"/>` +
    `<path d="M${cx - r * 0.52} ${cy + r * 0.62} a${r * 0.52} ${r * 0.46} 0 0 1 ${r * 1.04} 0 Z" fill="${color}"/>`
  );
}

function avatar(cx, cy, r, letter, color, bg) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}"/>` + T(cx, cy + r * 0.36, letter, { size: r, weight: 700, fill: color, anchor: 'middle' });
}

function keyIcon(x, y, o = {}) {
  const { s = 1, color = C.amber } = o;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="9"/><path d="M21 16 H48 M40 16 V25 M47 16 V23"/></g>`;
}

function lockIcon(x, y, o = {}) {
  const { s = 1, color = C.sshx, fill = '#FFFFFF' } = o;
  return `<g transform="translate(${x} ${y}) scale(${s})" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15 V10 a7 7 0 0 1 14 0 V15" fill="none"/><rect x="3" y="15" width="26" height="20" rx="4" fill="${fill}"/><circle cx="16" cy="25" r="2" fill="${color}" stroke="none"/></g>`;
}

function serverIcon(x, y, o = {}) {
  const { s = 1, color = C.muted } = o;
  let b = '';
  for (let i = 0; i < 3; i++) {
    b += `<rect x="2" y="${2 + i * 14}" width="36" height="11" rx="3"/><circle cx="30" cy="${7.5 + i * 14}" r="1.6" fill="${color}"/>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="3">${b}</g>`;
}

function diskIcon(x, y, o = {}) {
  const { s = 1, color = C.plati } = o;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="3"><ellipse cx="18" cy="7" rx="16" ry="6"/><path d="M2 7 V29 a16 6 0 0 0 32 0 V7"/><path d="M2 18 a16 6 0 0 0 32 0"/></g>`;
}

function idIcon(x, y, color) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"><rect x="1" y="1" width="44" height="34" rx="6"/><circle cx="15" cy="14" r="5"/><path d="M7 28 q8 -9 16 0 M29 12 h10 M29 20 h8"/></g>`;
}

function check(x, y, color = C.done, s = 1) {
  return `<path d="M${x} ${y} l${6 * s} ${6 * s} l${12 * s} ${-13 * s}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function cross(x, y, color = C.red, s = 1) {
  const d = 12 * s;
  return `<path d="M${x} ${y} l${d} ${d} M${x + d} ${y} l${-d} ${d}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
}

function cloud(cx, cy, o = {}) {
  const { fill = C.surface, stroke = C.faint } = o;
  return `<path d="M${cx - 100} ${cy + 50} H${cx + 95} a45 45 0 0 0 5 -90 a60 60 0 0 0 -110 -25 a50 50 0 0 0 -85 30 a45 45 0 0 0 -5 85 Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`;
}

/** Fenêtre de navigateur : barre claire avec adresse, contenu `inner`. */
function browser(x, y, w, h, o = {}) {
  const { url = '', inner = '#FFFFFF', r = 18, bar = 52 } = o;
  let s = rt(x, y, w, bar, r, C.surface) + rb(x, y + bar, w, h - bar, r, inner);
  for (let i = 0; i < 3; i++) s += `<circle cx="${x + 28 + i * 22}" cy="${y + bar / 2}" r="7" fill="${C.line}"/>`;
  if (url) {
    const uw = Math.min(w - 130, tw(url, 17, 400, true) + 40);
    s += R(x + 104, y + 10, uw, bar - 20, { r: (bar - 20) / 2, fill: '#FFFFFF', stroke: C.line, sw: 1.5 });
    s += T(x + 124, y + bar / 2 + 6, url, { size: 17, fill: C.muted, mono: true });
  }
  return s + R(x, y, w, h, { r, stroke: C.line, sw: 2 });
}

/** Fenêtre de terminal sombre, titre en haut. */
function termWindow(x, y, w, h, title) {
  return (
    rt(x, y, w, 46, 16, Z[800]) +
    rb(x, y + 46, w, h - 46, 16, Z[900]) +
    [0, 1, 2].map((i) => `<circle cx="${x + 26 + i * 20}" cy="${y + 23}" r="6" fill="${Z[600]}"/>`).join('') +
    T(x + 100, y + 29, title, { size: 17, fill: Z[400], mono: true })
  );
}

/** Carton d'un produit : en-tête teinté, nom et rôle. */
function produit(x, y, w, h, { name, sub, color, bg, size = 34 }) {
  return (
    rt(x, y, w, 104, 20, bg) +
    R(x, y, w, h, { r: 20, stroke: color, sw: 3 }) +
    T(x + 24, y + 52, name, { size, weight: 800, fill: color }) +
    T(x + 24, y + 84, sub, { size: 20, fill: C.muted })
  );
}

function bullets(x, y, items, o = {}) {
  const { size = 20, lh = 38, color = C.ink, dot = C.faint } = o;
  return items
    .map((it, i) => `<circle cx="${x + 5}" cy="${y + i * lh - size * 0.33}" r="4.5" fill="${dot}"/>` + T(x + 20, y + i * lh, it, { size, fill: color }))
    .join('');
}

/** Ligne de terminal dans la liste sombre de SSHX Platform. */
function rowDark(x, y, w, name, state, o = {}) {
  const { selected = false, size = 19 } = o;
  const e = ETAT[state];
  let s = selected ? R(x, y - 30, w, 50, { r: 8, fill: Z[800] }) : '';
  s += `<circle cx="${x + 18}" cy="${y - 6}" r="7" fill="${e.dark}"/>`;
  s += T(x + 36, y, name, { size, weight: selected ? 600 : 400, fill: selected ? Z[100] : Z[200] });
  if (e.label) s += T(x + w - 12, y, e.label, { size: 17, weight: 600, fill: e.dark, anchor: 'end' });
  return s;
}

// ---------------------------------------------------------------------------------------------
// Écriture

function svg(file, { title, desc, body, w = W, h = H }) {
  const defs = [...markers]
    .map(
      (c) =>
        `<marker id="pointe-${c.slice(1)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${c}"/></marker>`,
    )
    .join('');
  markers = new Set();
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="titre desc">
<title id="titre">${esc(title)}</title>
<desc id="desc">${esc(desc)}</desc>
<style>text{font-family:Inter,'Inter Variable',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}.mono{font-family:'Fira Code','JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace}</style>
<defs>${defs}</defs>
<rect id="fond" width="${w}" height="${h}" fill="#FFFFFF"/>
${body}</svg>
`;
  writeFileSync(join(DIR, file), out);
  console.log(file);
}

// ---------------------------------------------------------------------------------------------
// Vue d'ensemble

function chaine() {
  const y0 = 470;
  let s = '';
  s += G(
    'reseau',
    R(24, 148, 1552, 728, { r: 28, fill: C.netBg, stroke: C.net, dash: '10 8' }) +
      T(1548, 192, 'Réseau privé Tailscale', { size: 22, weight: 700, fill: C.net, anchor: 'end' }) +
      T(1548, 220, "rien n'est exposé sur Internet", { size: 19, fill: C.muted, anchor: 'end' }),
  );
  s += G(
    'liens-entra',
    arrow('M600 68 H375 V292', { color: C.entra, sw: 2.5, dash: '7 7' }) +
      arrow('M1000 68 H1225 V292', { color: C.entra, sw: 2.5, dash: '7 7' }),
  );
  s += G(
    'entra',
    R(600, 24, 400, 88, { r: 16, fill: C.entraBg, stroke: C.entra }) +
      idIcon(624, 50, C.entra) +
      T(686, 62, 'Microsoft Entra ID', { size: 24, weight: 700, fill: C.entra }) +
      T(686, 92, 'connexion des comptes', { size: 19, fill: C.muted }),
  );
  s += G(
    'admin',
    person(115, y0 - 10, { r: 46, color: C.plati, bg: C.platiBg }) +
      T(115, y0 + 70, 'Administrateur', { size: 21, weight: 700, anchor: 'middle' }) +
      TL(115, y0 + 98, ['clés, modèles,', 'machines'], { size: 18, fill: C.muted, anchor: 'middle', lh: 24 }),
  );
  s += G('fleche-admin-plati', arrow(`M172 ${y0 - 10} H234`, { color: C.plati }));
  s += G(
    'plati',
    produit(240, 300, 270, 340, { name: 'Plati', sub: 'crée les machines', color: C.plati, bg: C.platiBg }) +
      bullets(264, 446, ['comptes, clés SSH', 'modèles de projets', 'micro-VMs', 'accès Git, secrets', 'arrêt automatique'], {
        size: 19,
        dot: C.plati,
      }),
  );
  s += G('fleche-plati-serveur', arrow(`M514 ${y0} H579`, { color: C.plati }));

  // Serveur et micro-VMs
  let srv =
    R(585, 180, 430, 600, { r: 20, fill: '#FFFFFF', stroke: C.line }) +
    serverIcon(609, 202, { color: C.muted }) +
    T(664, 222, "Serveur de l'entreprise", { size: 22, weight: 700 }) +
    T(664, 250, 'Incus, sur votre matériel', { size: 18, fill: C.muted });
  s += G('serveur', srv);
  const vms = [
    ['site-web', 'A', 'Alice'],
    ['app-interne', 'B', 'Bruno'],
    ['outil-ia', 'C', 'Chloé'],
  ];
  vms.forEach(([name, letter, owner], i) => {
    const x = 609;
    const y = 282 + i * 166;
    s += G(
      `vm-${name}`,
      R(x, y, 382, 148, { r: 14, fill: '#FFFFFF', stroke: C.plati, sw: 2 }) +
        T(x + 20, y + 40, name, { size: 22, weight: 700, mono: true }) +
        T(x + 382 - 56, y + 38, owner, { size: 18, fill: C.muted, anchor: 'end' }) +
        avatar(x + 382 - 32, y + 32, 16, letter, C.platform, C.platformBg) +
        chips(x + 20, y + 62, [CHIP.claude, CHIP.sshx, CHIP.tailscale], 350) +
        diskIcon(x + 22, y + 112, { s: 0.55, color: C.faint }) +
        T(x + 50, y + 130, 'espace personnel conservé', { size: 17, fill: C.muted }),
    );
  });

  // SSHX : les terminaux chiffrés, de chaque machine vers SSHX Platform
  s += G(
    'sshx',
    arrow(`M1019 ${y0} H1084`, { color: C.sshx, sw: 6, start: true }) +
      T(1052, y0 - 48, 'SSHX', { size: 20, weight: 800, fill: C.sshx, anchor: 'middle' }) +
      `<circle cx="1052" cy="${y0}" r="22" fill="#FFFFFF" stroke="${C.sshx}" stroke-width="3"/>` +
      lockIcon(1040, y0 - 18, { s: 0.75 }) +
      T(1052, y0 + 52, 'chiffré', { size: 17, fill: C.muted, anchor: 'middle' }),
  );

  s += G(
    'platform',
    produit(1090, 300, 270, 340, { name: 'SSHX Platform', sub: 'le poste de travail', color: C.platform, bg: C.platformBg, size: 29 }) +
      [
        ['site-web', 'working'],
        ['app-interne', 'question'],
        ['outil-ia', 'done'],
        ['api', 'permission'],
      ]
        .map(([n, st], i) => {
          const y = 448 + i * 46;
          const e = ETAT[st];
          return `<circle cx="1119" cy="${y - 6}" r="7" fill="${e.light}"/>` + T(1136, y, n, { size: 19 }) + T(1338, y, e.label, { size: 17, weight: 700, fill: e.light, anchor: 'end' });
        })
        .join(''),
  );
  s += G('fleche-platform-utilisateurs', arrow(`M1366 ${y0 - 10} H1402`, { color: C.platform, start: true }));
  s += G(
    'utilisateurs',
    person(1446, y0 - 10, { r: 36, color: C.platform, bg: C.platformBg }) +
      person(1500, y0 - 10, { r: 36, color: C.platform, bg: C.platformBg, ring: C.netBg }) +
      T(1472, y0 + 70, 'Utilisateurs', { size: 21, weight: 700, anchor: 'middle' }) +
      TL(1472, y0 + 98, ['navigateur', 'ou mobile'], { size: 18, fill: C.muted, anchor: 'middle', lh: 24 }),
  );
  return s;
}

// ---------------------------------------------------------------------------------------------
// Les trois briques

function briques() {
  let s = '';
  const cards = [
    {
      id: 'plati',
      x: 60,
      verb: 'Créer',
      name: 'Plati',
      sub: ['le micro-cloud : crée et gère', 'les machines de toute l’équipe'],
      who: 'Pour les administrateurs',
      color: C.plati,
      bg: C.platiBg,
    },
    {
      id: 'sshx',
      x: 570,
      verb: 'Ouvrir',
      name: 'SSHX',
      sub: ['une machine dans le navigateur,', 'chiffrée de bout en bout'],
      who: 'Pour une machine et ses invités',
      color: C.sshx,
      bg: C.sshxBg,
    },
    {
      id: 'platform',
      x: 1080,
      verb: 'Réunir',
      name: 'SSHX Platform',
      sub: ['toutes les machines et tous', 'les agents d’une personne'],
      who: 'Pour chaque utilisateur',
      color: C.platform,
      bg: C.platformBg,
    },
  ];
  for (const c of cards) {
    const { x } = c;
    let b =
      rt(x, 60, 460, 250, 22, c.bg) +
      R(x, 60, 460, 690, { r: 22, stroke: c.color, sw: 3 }) +
      T(x + 36, 140, c.verb, { size: 52, weight: 800, fill: c.color }) +
      T(x + 36, 196, c.name, { size: 30, weight: 700 }) +
      TL(x + 36, 236, c.sub, { size: 21, fill: C.muted, lh: 30 }) +
      T(x + 36, 712, c.who, { size: 21, weight: 700, fill: c.color });
    // Vignette
    const vx = x + 50;
    const vy = 350;
    if (c.id === 'plati') {
      b += R(vx, vy, 360, 300, { r: 16, fill: C.surface, stroke: C.line }) + serverIcon(vx + 20, vy + 18, { s: 0.8 });
      b += T(vx + 64, vy + 46, 'serveur Incus', { size: 18, fill: C.muted });
      for (let i = 0; i < 4; i++) {
        const bx = vx + 20 + (i % 2) * 168;
        const by = vy + 76 + Math.floor(i / 2) * 106;
        b += R(bx, by, 152, 92, { r: 12, fill: '#FFFFFF', stroke: C.plati, sw: 2 });
        b += R(bx + 14, by + 16, 70, 12, { r: 6, fill: C.ink });
        b += R(bx + 14, by + 42, 54, 20, { r: 10, fill: C.amberBg });
        b += R(bx + 74, by + 42, 40, 20, { r: 10, fill: C.sshxBg });
        b += R(bx + 14, by + 68, 60, 10, { r: 5, fill: C.line });
      }
    } else if (c.id === 'sshx') {
      b += browser(vx, vy, 360, 300, { inner: Z[900] });
      b += T(vx + 24, vy + 100, '$ claude', { size: 20, fill: Z[100], mono: true });
      b += T(vx + 24, vy + 138, '● Je lis le projet…', { size: 18, fill: Z[400], mono: true });
      b += T(vx + 24, vy + 172, '● 3 fichiers modifiés', { size: 18, fill: '#34D399', mono: true });
      b += R(vx + 24, vy + 196, 12, 22, { r: 2, fill: Z[300] });
      b += `<circle cx="${vx + 318}" cy="${vy + 254}" r="26" fill="#FFFFFF" stroke="${C.sshx}" stroke-width="3"/>` + lockIcon(vx + 304, vy + 236, { s: 0.85 });
    } else {
      b += R(vx, vy, 360, 300, { r: 16, fill: Z[900] });
      const rows = [
        ['site-web', 'working'],
        ['app-interne', 'question'],
        ['outil-ia', 'done'],
        ['site-web · 2', 'none'],
      ];
      rows.forEach(([n, st], i) => {
        b += rowDark(vx + 12, vy + 62 + i * 64, 336, n, st, { selected: i === 1 });
      });
    }
    s += G(c.id, b);
  }
  s += G('fleche-plati-sshx', arrow('M526 405 H564', { color: C.faint }));
  s += G('fleche-sshx-platform', arrow('M1036 405 H1074', { color: C.faint }));
  s += G(
    'fondations',
    R(60, 790, 1480, 76, { r: 18, fill: C.netBg, stroke: C.net, dash: '9 7' }) +
      T(800, 836, 'Fondations : Tailscale (réseau privé) · Microsoft Entra ID (identité) · Incus (machines) · Claude Code (agent)', {
        size: 20,
        fill: C.net,
        anchor: 'middle',
      }),
  );
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 1 — les clés SSH

function etape1() {
  let s = '';
  const users = [
    ['Alice', 'ssh-ed25519 AAAAC3…k2Q'],
    ['Bruno', 'ssh-ed25519 AAAAC3…9xF'],
    ['Chloé', 'ssh-rsa AAAAB3Nz…T0w'],
  ];
  users.forEach(([n, k], i) => {
    const cy = 230 + i * 220;
    s += G(
      `utilisateur-${i + 1}`,
      person(150, cy, { r: 52, color: C.platform, bg: C.platformBg }) +
        T(228, cy - 12, n, { size: 26, weight: 700 }) +
        keyIcon(228, cy + 6, { s: 0.75, color: C.amber }) +
        T(278, cy + 26, k, { size: 17, fill: C.muted, mono: true }),
    );
    s += G(`fleche-cle-${i + 1}`, arrow(`M536 ${cy} C 590 ${cy}, 590 450, 646 450`, { color: C.amber }));
  });

  let p = browser(660, 110, 860, 680, { url: 'plati.votre-tailnet.ts.net/admin/utilisateurs' });
  p += T(696, 214, 'Utilisateurs', { size: 30, weight: 800, fill: C.plati });
  p += person(1446, 204, { r: 22, color: C.plati, bg: C.platiBg });
  p += T(1414, 212, 'administrateur', { size: 18, fill: C.muted, anchor: 'end' });
  const cols = [696, 940, 1210];
  ['UTILISATEUR', 'CLÉS SSH', 'ACCÈS GIT'].forEach((h, i) => (p += T(cols[i], 280, h, { size: 17, weight: 700, fill: C.faint })));
  const rows = [
    ['A', 'Alice', '1 clé', 'confirmé'],
    ['B', 'Bruno', '1 clé', 'débutant'],
    ['C', 'Chloé', '2 clés', 'expert'],
  ];
  rows.forEach(([l, n, k, g], i) => {
    const y = 300 + i * 104;
    p += R(680, y, 820, 88, { r: 12, fill: i % 2 ? '#FFFFFF' : C.surface });
    p += avatar(722, y + 44, 22, l, C.platform, C.platformBg);
    p += T(758, y + 52, n, { size: 22, weight: 600 });
    p += keyIcon(940, y + 30, { s: 0.6, color: C.amber }) + T(984, y + 52, k, { size: 20 });
    p += chips(1210, y + 26, [[`niveau ${g}`, C.plati, C.platiBg]], 280);
  });
  p += check(696, 660, C.done) + T(730, 668, 'Installées dans toutes leurs machines,', { size: 21 });
  p += T(730, 700, 'même déjà démarrées.', { size: 21 });
  p += T(730, 744, 'La clé Git suit le niveau de chacun.', { size: 21, fill: C.muted });
  s += G('plati-utilisateurs', p);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 2 — le modèle de projet

function etape2() {
  let s = '';
  s += G('titre-briques', T(90, 140, 'Briques réutilisables', { size: 20, weight: 700, fill: C.muted }));
  const mixins = [
    [CHIP.claude, "l'agent IA et ses skills"],
    [CHIP.sshx, 'le terminal dans le navigateur'],
    [CHIP.tailscale, 'rejoint le réseau privé'],
    [CHIP.docker, 'conteneurs dans la machine'],
    [CHIP.vscode, 'éditeur dans le navigateur'],
  ];
  mixins.forEach(([[name, color, bg], sub], i) => {
    const y = 164 + i * 104;
    s += G(
      `brique-${name.toLowerCase().replace(/\s+/g, '-')}`,
      R(90, y, 340, 84, { r: 14, fill: '#FFFFFF', stroke: C.line }) +
        R(102, y + 14, 6, 56, { r: 3, fill: color }) +
        T(124, y + 36, name, { size: 23, weight: 700, fill: color }) +
        T(124, y + 66, sub, { size: 18, fill: C.muted }),
    );
    s += G(`fleche-brique-${i + 1}`, arrow(`M434 ${y + 42} C 500 ${y + 42}, 500 450, 566 450`, { color: C.faint, sw: 2.5 }));
  });

  let m = rt(580, 110, 500, 84, 20, C.platiBg) + R(580, 110, 500, 680, { r: 20, stroke: C.plati, sw: 3 });
  m += T(608, 160, 'Modèle', { size: 28, weight: 800, fill: C.plati });
  m += T(1052, 160, 'site-web', { size: 22, weight: 700, mono: true, anchor: 'end' });
  const rows = [
    ['IMAGE', 'Ubuntu 24.04'],
    ['DÉPÔTS', 'site-web, design-system'],
    ['AGENT IA', "Claude Code + skills de l'équipe"],
    ['INCLUS', null],
    ['RESSOURCES', '2 CPU · 4 Go · 20 Go'],
    ['ESPACE PERSONNEL', '/home/ubuntu, conservé'],
  ];
  rows.forEach(([k, v], i) => {
    const y = 238 + i * 90;
    m += T(608, y, k, { size: 16, weight: 700, fill: C.faint });
    if (v) m += T(608, y + 34, v, { size: 22 });
    else m += chips(608, y + 10, [CHIP.sshx, CHIP.tailscale, CHIP.docker, CHIP.vscode], 450, { size: 17, h: 32, gap: 8 });
  });
  s += G('modele', m);

  s += G('fleche-modele-machines', arrow('M1086 450 H1176', { color: C.plati }));
  let v = '';
  for (let i = 2; i >= 0; i--) {
    const x = 1190 + i * 26;
    const y = 300 + i * 26;
    v += R(x, y, 280, 160, { r: 14, fill: '#FFFFFF', stroke: C.plati, sw: 2 });
    if (i === 0) {
      v += T(x + 20, y + 42, 'site-web', { size: 20, weight: 700, mono: true });
      v += R(x + 20, y + 66, 110, 26, { r: 13, fill: C.amberBg }) + R(x + 140, y + 66, 60, 26, { r: 13, fill: C.sshxBg });
      v += R(x + 20, y + 104, 90, 26, { r: 13, fill: '#F1F5F9' }) + R(x + 120, y + 104, 70, 26, { r: 13, fill: '#CFFAFE' });
    }
  }
  v += TL(1370, 580, ['un modèle,', 'autant de machines', 'identiques'], { size: 21, fill: C.ink, anchor: 'middle', lh: 30 });
  v += TL(1370, 700, ["changer d'agent pour tous :", 'modifier le modèle'], { size: 19, fill: C.amberDark, anchor: 'middle', lh: 28, weight: 600 });
  s += G('machines', v);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 3 — les micro-VMs

function etape3() {
  let s = '';
  s += G(
    'serveur',
    R(110, 70, 1380, 680, { r: 24, fill: '#FFFFFF', stroke: C.line }) +
      serverIcon(140, 98) +
      T(196, 122, "Serveur de l'entreprise", { size: 26, weight: 700 }) +
      T(196 + tw("Serveur de l'entreprise", 26, 700) + 14, 122, '· Incus', { size: 24, fill: C.muted }) +
      chips(1300, 96, [['géré par Plati', C.plati, C.platiBg]], 200),
  );
  const vms = [
    ['site-web', 'A', 'Alice', true],
    ['site-web', 'B', 'Bruno', true],
    ['app-interne', 'C', 'Chloé', true],
    ['outil-ia', 'A', 'Alice', false],
  ];
  vms.forEach(([name, l, owner, on], i) => {
    const x = 150 + i * 330;
    const y = 170;
    let v = R(x, y, 300, 530, { r: 16, fill: on ? '#FFFFFF' : C.surface, stroke: on ? C.plati : C.line, sw: 2 });
    v += T(x + 22, y + 46, name, { size: 24, weight: 700, mono: true, fill: on ? C.ink : C.muted });
    v += `<circle cx="${x + 30}" cy="${y + 76}" r="6" fill="${on ? C.done : C.faint}"/>`;
    v += T(x + 44, y + 82, on ? 'en marche' : 'arrêtée automatiquement', { size: 17, fill: C.muted });
    v += avatar(x + 42, y + 134, 20, l, C.platform, C.platformBg) + T(x + 72, y + 142, owner, { size: 21, weight: 600 });
    v += `<line x1="${x + 22}" y1="${y + 180}" x2="${x + 278}" y2="${y + 180}" stroke="${C.line}" stroke-width="2"/>`;
    v += chips(x + 22, y + 200, [CHIP.claude, CHIP.sshx, CHIP.tailscale], 256);
    v += T(x + 22, y + 330, '2 CPU · 4 Go', { size: 18, fill: C.muted });
    v += R(x + 18, y + 380, 264, 128, { r: 12, fill: C.platiBg });
    v += diskIcon(x + 36, y + 406);
    v += TL(x + 88, y + 422, ['espace personnel', 'conservé à chaque', 'reconstruction'], { size: 17, fill: C.plati, lh: 24, weight: 600 });
    s += G(`vm-${i + 1}`, v);
    s += G(`lien-reseau-${i + 1}`, `<line x1="${x + 150}" y1="${y + 530}" x2="${x + 150}" y2="800" stroke="${C.net}" stroke-width="2.5" stroke-dasharray="6 6"/>`);
  });
  s += G(
    'reseau',
    R(110, 800, 1380, 72, { r: 18, fill: C.netBg, stroke: C.net, dash: '10 8' }) +
      T(800, 844, "Réseau privé Tailscale : chaque machine a son adresse, rien n'est exposé sur Internet", {
        size: 21,
        fill: C.net,
        anchor: 'middle',
        weight: 600,
      }),
  );
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 4 — l'enrôlement

function etape4() {
  let s = '';
  s += G(
    'admin',
    person(126, 150, { r: 46, color: C.plati, bg: C.platiBg }) +
      T(194, 144, 'Administrateur', { size: 23, weight: 700 }) +
      T(194, 174, 'dans la micro-VM site-web', { size: 19, fill: C.muted }),
  );
  let t = termWindow(70, 240, 700, 520, 'site-web — terminal');
  const L = ['$ sshx platform enroll \\', '    https://plateforme.votre-tailnet.ts.net \\', '    smt_7Hq…  && sshx'];
  L.forEach((l, i) => (t += T(100, 334 + i * 44, l, { size: 20, fill: Z[100], mono: true })));
  ['plateforme enregistrée', 'hooks Claude Code installés', 'session en ligne'].forEach((l, i) => {
    const y = 334 + (i + 4) * 44;
    t += check(102, y - 10, '#34D399', 0.8) + T(132, y, l, { size: 20, fill: '#34D399', mono: true });
  });
  t += R(100, 334 + 7 * 44 - 4, 12, 24, { r: 2, fill: Z[300] });
  s += G('terminal', t);

  s += G(
    'sshx',
    arrow('M776 500 H954', { color: C.sshx, sw: 6 }) +
      T(865, 452, 'SSHX', { size: 22, weight: 800, fill: C.sshx, anchor: 'middle' }) +
      `<circle cx="865" cy="500" r="24" fill="#FFFFFF" stroke="${C.sshx}" stroke-width="3"/>` +
      lockIcon(852, 481, { s: 0.8 }) +
      T(865, 556, 'chiffré de bout en bout', { size: 17, fill: C.muted, anchor: 'middle' }),
  );

  let p = browser(970, 150, 560, 620, { url: 'plateforme…/machines', inner: Z[950] });
  p += T(1000, 250, 'Machines', { size: 26, weight: 700, fill: Z[100] });
  const ms = [
    ['site-web', 'en ligne', true, true],
    ['app-interne', 'en ligne', true, false],
    ['outil-ia', 'hors ligne', false, false],
  ];
  ms.forEach(([n, st, on, isNew], i) => {
    const y = 286 + i * 112;
    p += R(990, y, 520, 96, { r: 12, fill: isNew ? Z[800] : Z[900], stroke: isNew ? '#818CF8' : Z[800], sw: 2 });
    p += T(1014, y + 40, n, { size: 22, weight: 600, fill: on ? Z[100] : Z[500] });
    p += `<circle cx="${1021}" cy="${y + 66}" r="6" fill="${on ? '#34D399' : Z[600]}"/>`;
    p += T(1036, y + 72, st, { size: 17, fill: on ? '#34D399' : Z[500] });
    if (isNew) {
      p += R(1162, y + 18, 104, 32, { r: 16, fill: '#312E81' }) + T(1214, y + 40, 'nouvelle', { size: 17, weight: 600, fill: '#C7D2FE', anchor: 'middle' });
      p += R(1374, y + 28, 116, 42, { r: 10, stroke: '#818CF8', sw: 2 }) + T(1432, y + 56, 'Partager', { size: 18, weight: 600, fill: '#C7D2FE', anchor: 'middle' });
    }
  });
  p += TL(1000, 650, ['Les états de Claude Code', 'remontent pour chaque terminal.'], { size: 19, fill: Z[400], lh: 28 });
  s += G('platform', p);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 5 — connexion et partage

function etape5() {
  let s = '';
  let b = browser(60, 90, 680, 740, { url: 'plateforme.votre-tailnet.ts.net', inner: Z[950] });
  b += R(140, 200, 520, 560, { r: 18, fill: Z[900], stroke: Z[700] });
  b += T(400, 262, 'SSHX Platform', { size: 30, weight: 800, fill: Z[100], anchor: 'middle' });
  b += T(184, 318, '1', { size: 18, weight: 800, fill: '#818CF8' }) + T(208, 318, 'Compte', { size: 18, weight: 600, fill: Z[400] });
  b += R(180, 334, 440, 60, { r: 10, fill: Z[100] });
  b += person(222, 364, { r: 18, color: C.ink, bg: Z[300] });
  b += T(414, 371, 'Se connecter avec Microsoft', { size: 20, weight: 600, fill: C.ink, anchor: 'middle' });
  b += check(184, 418, '#34D399', 0.9) + T(210, 426, 'Chloé, compte vérifié', { size: 18, fill: '#34D399' });
  b += T(184, 492, '2', { size: 18, weight: 800, fill: '#818CF8' }) + T(208, 492, 'Phrase secrète', { size: 18, weight: 600, fill: Z[400] });
  b += R(180, 508, 440, 58, { r: 10, fill: Z[950], stroke: Z[600] });
  b += T(204, 546, '● ● ● ● ● ● ● ● ● ● ● ●', { size: 18, fill: Z[200] });
  b += lockIcon(182, 584, { s: 0.6, color: Z[400], fill: Z[900] }) + T(210, 602, 'ne quitte jamais ce navigateur', { size: 17, fill: Z[400] });
  b += R(180, 640, 440, 60, { r: 10, fill: C.platform }) + T(400, 678, 'Déverrouiller', { size: 20, weight: 700, fill: '#FFFFFF', anchor: 'middle' });
  s += G('connexion', b);

  s += G(
    'admin',
    person(880, 210, { r: 44, color: C.plati, bg: C.platiBg }) + T(880, 290, 'Administrateur', { size: 20, weight: 700, anchor: 'middle' }),
  );
  s += G('fleche-partage-1', arrow('M936 210 H1078', { color: C.amber }) + T(1007, 192, 'partage', { size: 18, fill: C.muted, anchor: 'middle' }));
  s += G(
    'cle-chiffree',
    `<circle cx="1150" cy="210" r="56" fill="${C.amberBg}" stroke="${C.amber}" stroke-width="2.5"/>` +
      keyIcon(1116, 186, { s: 0.85, color: C.amberDark }) +
      `<circle cx="1176" cy="232" r="20" fill="#FFFFFF" stroke="${C.amber}" stroke-width="2"/>` +
      lockIcon(1165, 217, { s: 0.65, color: C.amberDark }) +
      TL(1150, 296, ['clé de la machine,', 'chiffrée pour Chloé'], { size: 18, fill: C.muted, anchor: 'middle', lh: 24 }),
  );
  s += G('fleche-partage-2', arrow('M1222 210 H1362', { color: C.amber }));
  s += G(
    'chloe',
    person(1420, 210, { r: 44, color: C.platform, bg: C.platformBg }) +
      T(1420, 290, 'Chloé', { size: 20, weight: 700, anchor: 'middle' }) +
      T(1420, 316, 'utilisatrice', { size: 18, fill: C.muted, anchor: 'middle' }),
  );
  s += G('fleche-chloe-machines', arrow('M1420 334 V384', { color: C.platform, sw: 2.5, dash: '6 6' }));
  let m = R(820, 400, 720, 360, { r: 18, fill: Z[950] });
  m += T(850, 452, 'Mes machines', { size: 24, weight: 700, fill: Z[100] });
  [
    ['app-interne', "partagée par l'administrateur"],
    ['site-web', "partagée par l'administrateur"],
  ].forEach(([n, sub], i) => {
    const y = 480 + i * 104;
    m += R(840, y, 680, 88, { r: 12, fill: Z[900], stroke: Z[800] });
    m += `<circle cx="868" cy="${y + 44}" r="7" fill="#34D399"/>`;
    m += T(892, y + 40, n, { size: 22, weight: 600, fill: Z[100] });
    m += T(892, y + 68, sub, { size: 17, fill: Z[400] });
    m += T(1500, y + 52, 'en ligne', { size: 17, weight: 600, fill: '#34D399', anchor: 'end' });
  });
  m += check(850, 716, '#34D399') + T(884, 726, 'Sans SSH ni éditeur à installer', { size: 20, weight: 600, fill: '#34D399' });
  s += G('machines', m);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 6 — travailler avec l'agent

function etape6() {
  let s = '';
  let a = browser(50, 60, 1190, 780, { url: 'plateforme.votre-tailnet.ts.net', inner: Z[950] });
  // Liste des terminaux
  a += `<rect x="51" y="112" width="370" height="727" fill="${Z[900]}"/>` + rb(51, 760, 370, 79, 17, Z[900]);
  a += `<line x1="421" y1="112" x2="421" y2="839" stroke="${Z[800]}" stroke-width="2"/>`;
  a += R(70, 130, 332, 44, { r: 8, fill: Z[950], stroke: Z[700], sw: 1.5 }) + T(88, 159, 'Filtrer…', { size: 17, fill: Z[500] });
  const groups = [
    ['SITE-WEB', [['page d’accueil', 'question', true], ['serveur de dev', 'none']]],
    ['APP-INTERNE', [['tests API', 'working'], ['migration', 'done']]],
    ['OUTIL-IA', [['résumé PDF', 'permission']]],
  ];
  let y = 220;
  for (const [g, rows] of groups) {
    a += T(78, y, g, { size: 16, weight: 700, fill: Z[500] });
    y += 44;
    for (const [n, st, sel] of rows) {
      a += rowDark(64, y, 344, n, st, { selected: !!sel });
      y += 54;
    }
    y += 14;
  }
  a += T(78, 806, '⌃⌥J  suivant à traiter', { size: 17, fill: Z[400] });
  // Terminal
  a += `<rect x="422" y="112" width="817" height="62" fill="${Z[900]}"/>`;
  a += T(446, 151, 'page d’accueil', { size: 21, weight: 700, fill: Z[100] }) + T(612, 151, 'site-web · main', { size: 17, fill: Z[400] });
  a += R(1018, 124, 202, 40, { r: 8, stroke: Z[600], sw: 1.5 }) + T(1119, 150, 'Ouvrir dans VS Code', { size: 17, fill: Z[300], anchor: 'middle' });
  a += R(442, 192, 776, 92, { r: 12, fill: '#2A1D06', stroke: '#B45309', sw: 1.5 });
  a += `<circle cx="468" cy="222" r="7" fill="#FBBF24"/>` + T(486, 228, 'Claude pose une question', { size: 18, weight: 700, fill: '#FBBF24' });
  a += T(468, 264, "Garder l'ancienne bannière sur la nouvelle page d'accueil ?", { size: 19, fill: '#FDE68A' });
  const term = [
    ['> Refais la page d’accueil avec le nouveau design', Z[100]],
    ['● Je lis le design system et la page actuelle.', Z[400]],
    ['● 3 fichiers modifiés : index, Hero, styles', Z[400]],
    ['● Garder l’ancienne bannière ?', '#FBBF24'],
    ['  1. Oui, en haut de page', Z[200]],
    ['  2. Non, la remplacer', Z[200]],
    ['  3. La déplacer en bas', Z[200]],
  ];
  term.forEach(([l, c], i) => (a += T(446, 340 + i * 40, l, { size: 19, fill: c, mono: true })));
  a += R(446, 340 + 7 * 40 - 18, 11, 24, { r: 2, fill: Z[300] });
  s += G('application', a);

  // Téléphone : même liste
  let p = R(1272, 150, 280, 600, { r: 42, fill: Z[800] }) + R(1284, 162, 256, 576, { r: 32, fill: Z[950] });
  p += R(1374, 176, 76, 10, { r: 5, fill: Z[800] });
  p += T(1304, 238, 'Terminaux', { size: 20, weight: 700, fill: Z[100] });
  [
    ['page d’accueil', 'question'],
    ['tests API', 'working'],
    ['migration', 'done'],
    ['résumé PDF', 'permission'],
  ].forEach(([n, st], i) => {
    const yy = 290 + i * 58;
    p += R(1296, yy - 32, 232, 48, { r: 10, fill: Z[900] });
    p += `<circle cx="${1316}" cy="${yy - 8}" r="7" fill="${ETAT[st].dark}"/>`;
    p += T(1334, yy - 1, n, { size: 18, fill: Z[200] });
  });
  ['Ctrl', 'Esc', 'Tab', '↑', '↓'].forEach((k, i) => {
    const x = 1298 + i * 47;
    p += R(x, 672, 42, 40, { r: 8, fill: Z[800] }) + T(x + 21, 698, k, { size: 15, fill: Z[300], anchor: 'middle' });
  });
  p += T(1412, 790, 'la même liste', { size: 18, fill: C.muted, anchor: 'middle' });
  p += T(1412, 814, 'sur le téléphone', { size: 18, fill: C.muted, anchor: 'middle' });
  s += G('telephone', p);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Étape 7 — montrer l'avancée

function etape7() {
  let s = '';
  s += G(
    'reseau',
    R(40, 70, 1130, 790, { r: 28, fill: C.netBg, stroke: C.net, dash: '10 8' }) + T(72, 116, 'Réseau privé Tailscale', { size: 22, weight: 700, fill: C.net }),
  );
  let v = R(80, 200, 400, 460, { r: 18, fill: '#FFFFFF', stroke: C.plati, sw: 2 });
  v += T(104, 246, 'site-web', { size: 24, weight: 700, mono: true });
  v += avatar(436, 238, 18, 'C', C.platform, C.platformBg);
  v += termWindow(100, 276, 360, 200, 'terminal');
  v += T(122, 370, '$ npm run dev', { size: 19, fill: Z[100], mono: true });
  v += T(122, 410, '▸ prêt sur :4321', { size: 19, fill: '#34D399', mono: true });
  v += chips(104, 502, [CHIP.sshx, CHIP.tailscale], 360);
  v += R(100, 574, 360, 50, { r: 25, fill: C.netBg, stroke: C.net, sw: 1.5 }) + T(280, 606, 'site-web.votre-tailnet.ts.net', { size: 16, fill: C.net, anchor: 'middle', mono: true });
  s += G('vm', v);

  s += G('fleche-vm-demo', arrow('M484 330 C 560 330, 560 300, 626 300', { color: C.net }));
  let d = browser(640, 140, 490, 330, { url: 'site-web.votre…' });
  d += R(670, 216, 430, 120, { r: 10, fill: C.platiBg });
  d += R(694, 246, 240, 18, { r: 9, fill: C.plati }) + R(694, 280, 330, 12, { r: 6, fill: '#A7CDBE' }) + R(694, 302, 280, 12, { r: 6, fill: '#A7CDBE' });
  d += R(670, 352, 136, 90, { r: 10, fill: C.surface }) + R(817, 352, 136, 90, { r: 10, fill: C.surface }) + R(964, 352, 136, 90, { r: 10, fill: C.surface });
  d += person(1060, 520, { r: 26, color: C.ink, bg: C.surface }) + person(1100, 520, { r: 26, color: C.ink, bg: C.surface, ring: C.netBg });
  d += T(885, 528, 'Les collègues voient', { size: 20, weight: 700, anchor: 'middle' }) + T(885, 554, "l'avancée", { size: 20, weight: 700, anchor: 'middle' });
  s += G('demo', d);

  s += G('fleche-vm-sshx', arrow('M484 560 C 560 560, 560 680, 626 680', { color: C.sshx }) + T(560, 720, 'lien SSHX', { size: 18, weight: 700, fill: C.sshx, anchor: 'middle' }));
  let c = R(640, 610, 490, 200, { r: 16, fill: C.sshxBg, stroke: C.sshx, sw: 2 });
  c += R(664, 634, 270, 152, { r: 10, fill: Z[900] });
  c += T(680, 672, '$ git status', { size: 17, fill: Z[200], mono: true }) + T(680, 702, '3 fichiers modifiés', { size: 17, fill: Z[400], mono: true });
  const cursor = (x, y, color, name) =>
    `<path d="M${x} ${y} l0 26 l7 -7 l6 13 l5 -2 l-6 -13 l10 0 Z" fill="${color}" stroke="#FFFFFF" stroke-width="1.5"/>` +
    R(x + 16, y + 26, tw(name, 15, 600) + 16, 24, { r: 6, fill: color }) +
    T(x + 24, y + 43, name, { size: 15, weight: 600, fill: '#FFFFFF' });
  c += cursor(700, 718, C.sshx, 'Chloé') + cursor(830, 734, C.platform, 'Bruno');
  c += TL(960, 696, ['à deux,', 'en direct'], { size: 20, weight: 700, fill: C.sshx, lh: 28 });
  s += G('sshx', c);

  s += G(
    'internet',
    cloud(1380, 400) +
      T(1380, 420, 'Internet', { size: 24, weight: 700, fill: C.muted, anchor: 'middle' }) +
      arrow('M1270 470 H1196', { color: C.faint, dash: '6 6', end: false }) +
      `<circle cx="1230" cy="470" r="20" fill="#FFFFFF" stroke="${C.red}" stroke-width="2.5"/>` +
      cross(1224, 464, C.red, 1) +
      TL(1380, 540, ['rien n’est publié', 'sur Internet'], { size: 20, fill: C.muted, anchor: 'middle', lh: 28 }),
  );
  return s;
}

// ---------------------------------------------------------------------------------------------
// La sécurité en couches

function securite() {
  let s = '';
  const layers = [
    ['materiel', 60, 70, 840, 780, '#FAFAFA', C.faint, 'Votre matériel · Incus', '#3F3F46'],
    ['reseau', 100, 140, 760, 680, C.netBg, C.net, 'Réseau privé · Tailscale', C.net],
    ['identite', 140, 210, 680, 580, C.entraBg, C.entra, 'Identité · Microsoft Entra ID', C.entra],
    ['isolation', 180, 280, 600, 480, C.platiBg, C.plati, 'Une micro-VM par personne et par projet', C.plati],
    ['droits', 220, 350, 520, 380, '#FFFFFF', C.platform, 'Droits : accès Git, secrets chiffrés', C.platform],
  ];
  for (const [id, x, y, w, h, fill, stroke, label, color] of layers) {
    s += G(id, R(x, y, w, h, { r: 30, fill, stroke, sw: 2, dash: id === 'reseau' ? '10 8' : undefined }) + T(x + 30, y + 44, label, { size: 21, weight: 700, fill: color }));
  }
  s += G(
    'chiffrement',
    R(260, 420, 440, 270, { r: 22, fill: C.sshxBg, stroke: C.sshx, sw: 2.5 }) +
      lockIcon(450, 444, { s: 1.7, color: C.sshx }) +
      TL(480, 552, ['Terminaux chiffrés', 'de bout en bout'], { size: 26, weight: 800, fill: C.sshx, anchor: 'middle', lh: 34 }) +
      TL(480, 630, ['code, sorties,', 'questions des agents'], { size: 18, fill: C.muted, anchor: 'middle', lh: 24 }),
  );

  let v = R(960, 70, 580, 380, { r: 20, fill: '#FFFFFF', stroke: C.line });
  v += T(990, 118, 'Ce que voient les serveurs', { size: 24, weight: 800 });
  v += T(990, 164, 'VISIBLE', { size: 16, weight: 700, fill: C.faint });
  v += `<circle cx="998" cy="196" r="5" fill="${C.faint}"/>` + T(1014, 202, 'état des agents, horodatages', { size: 20 });
  v += `<circle cx="998" cy="232" r="5" fill="${C.faint}"/>` + T(1014, 238, 'noms des machines et des sessions', { size: 20 });
  v += T(990, 290, 'JAMAIS EN CLAIR', { size: 16, weight: 700, fill: C.sshx });
  ['contenu des terminaux', 'dossiers, branches, noms de terminaux', 'questions et réponses des agents'].forEach((t, i) => {
    v += cross(992, 310 + i * 40, C.sshx, 0.9) + T(1018, 324 + i * 40, t, { size: 20 });
  });
  s += G('visible', v);

  let a = R(960, 480, 580, 370, { r: 20, fill: '#FFFFFF', stroke: C.line });
  a += T(990, 528, "Ce que décide l'administrateur", { size: 24, weight: 800 });
  [
    'qui reçoit quelle machine',
    'les clés SSH installées',
    "l'accès Git selon le niveau",
    'les secrets injectés',
    'CPU, mémoire, arrêt automatique',
    "l'agent IA et son fournisseur",
  ].forEach((t, i) => {
    a += check(990, 562 + i * 44, C.plati, 0.85) + T(1018, 574 + i * 44, t, { size: 20 });
  });
  s += G('administrateur', a);
  return s;
}

// ---------------------------------------------------------------------------------------------

svg('chaine.svg', {
  title: 'La solution en un coup d’œil',
  desc: "L'administrateur prépare dans Plati les micro-VMs du serveur de l'entreprise ; SSHX relie chaque machine, chiffrée, à SSHX Platform, où les utilisateurs retrouvent leurs terminaux et leurs agents. Tout est dans le réseau privé Tailscale ; Microsoft Entra ID connecte les comptes.",
  body: chaine(),
});
svg('briques.svg', {
  title: 'Trois briques',
  desc: 'Plati crée les machines, SSHX ouvre une machine dans le navigateur, SSHX Platform réunit toutes les machines et tous les agents d’une personne. Fondations : Tailscale, Entra ID, Incus, Claude Code.',
  body: briques(),
});
svg('etape-1-cles.svg', {
  title: 'Étape 1 : rassembler les clés',
  desc: "L'administrateur enregistre dans Plati les clés SSH publiques de chaque utilisateur et leur niveau d'accès Git.",
  body: etape1(),
});
svg('etape-2-modele.svg', {
  title: 'Étape 2 : décrire le projet',
  desc: 'Un modèle Plati réunit image, dépôts, agent IA et briques réutilisables (SSHX, Tailscale, Docker, VS Code) ; il produit autant de machines identiques que nécessaire.',
  body: etape2(),
});
svg('etape-3-micro-vms.svg', {
  title: 'Étape 3 : créer les micro-VMs',
  desc: "Plati crée une micro-VM par personne et par projet sur le serveur de l'entreprise ; chacune garde son espace personnel et rejoint le réseau privé.",
  body: etape3(),
});
svg('etape-4-enrolement.svg', {
  title: 'Étape 4 : relier à SSHX Platform',
  desc: "L'administrateur lance une commande dans la micro-VM ; la machine apparaît dans SSHX Platform, reliée par SSHX et chiffrée de bout en bout.",
  body: etape4(),
});
svg('etape-5-connexion.svg', {
  title: 'Étape 5 : se connecter, recevoir ses machines',
  desc: "L'utilisatrice se connecte avec son compte Microsoft et choisit une phrase secrète ; l'administrateur lui partage ses machines, dont la clé est chiffrée pour elle.",
  body: etape5(),
});
svg('etape-6-agents.svg', {
  title: 'Étape 6 : travailler avec l’agent',
  desc: 'SSHX Platform liste tous les terminaux avec l’état de leur agent ; Claude pose une question dans le terminal ouvert ; la même liste est disponible sur téléphone.',
  body: etape6(),
});
svg('etape-7-demo.svg', {
  title: 'Étape 7 : montrer l’avancée',
  desc: "L'application en cours s'ouvre à l'adresse privée de la machine pour les collègues ; un lien SSHX permet de travailler à deux ; rien n'est publié sur Internet.",
  body: etape7(),
});
svg('securite.svg', {
  title: 'La sécurité en couches',
  desc: "Matériel, réseau privé, identité, isolation, droits et chiffrement de bout en bout des terminaux ; ce que voient les serveurs et ce que décide l'administrateur.",
  body: securite(),
});
