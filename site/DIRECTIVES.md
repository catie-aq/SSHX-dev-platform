# Directives — la solution globale (Plati, SSHX, SSHX Platform)

Ce document décrit ce que font ensemble les trois projets, et fixe les règles de communication
(site public, livrable PDF pour les financeurs, future vidéo). Il fait référence pour toute personne
ou tout agent qui écrit sur la solution. Les détails techniques restent dans chaque dépôt.

## L'idée

**Du cloud privé et des agents IA privés, gérés par des administrateurs.** Les équipes reçoivent
des environnements de travail sécurisés, préconfigurés et joignables sur l'intranet via Tailscale,
sans éditeur à installer ni SSH à configurer. Les administrateurs décident qui accède à quoi ; le code, les
secrets et les échanges avec les agents restent sur le matériel et le réseau de l'organisation.

**En usage au CATIE** : 8 micro-VMs pour 5 utilisateurs (octobre 2026). Ce sont les seuls chiffres
réels autorisés à ce jour (accord de Jérémy Laviole, 16 octobre 2026).

## Les trois projets

| Projet | Dépôt | Rôle | Pour qui |
|---|---|---|---|
| **Plati** | `../Plati` (github.com/poqudrof/Plati) | Le micro-cloud : crée et gère les micro-VMs (Incus), les comptes, les clés SSH, les accès Git, les secrets | Administrateurs |
| **SSHX** (fork CATIE) | `../sshx` (github.com/catie-aq/sshx, branche `platform`) | Une machine dans le navigateur : terminal chiffré de bout en bout, partage par lien, canevas, suivi de Claude Code, VS Code intégré | Une machine et ses collaborateurs |
| **SSHX Platform** | ce dépôt | Le poste de travail : tous les terminaux de toutes ses machines, l'état des agents IA, connexion Microsoft Entra ID | Utilisateurs |

Trois verbes pour les retenir : **Plati crée** les machines, **SSHX ouvre** une machine,
**SSHX Platform réunit** toutes les machines et tous les agents d'une personne.

Les fondations, qui ne sont pas des projets du CATIE : **Tailscale** (réseau privé), **Microsoft
Entra ID** (identité), **Incus** (virtualisation), **Claude Code** (agent IA ; Codex CLI ou
OpenCode s'installent aussi par les modèles Plati).

### Comment elles s'emboîtent

- Un modèle Plati installe sur chaque micro-VM, par des *mixins* réutilisables : Claude Code,
  SSHX en service systemd, Tailscale (la machine rejoint le réseau privé), et au besoin Docker et
  OpenVSCode Server.
- SSHX est le chemin d'accès à la machine : il relaie les terminaux chiffrés par `sshx-server`.
- SSHX Platform connaît les machines enrôlées (`sshx platform enroll <url> <jeton>`), liste leurs
  terminaux et l'état des agents (remonté par les hooks de Claude Code), et relaie les WebSockets
  vers `sshx-server`. Elle ne voit que des métadonnées.
- Tout vit dans un même réseau Tailscale : Plati, `sshx-server`, SSHX Platform, les micro-VMs et
  les appareils des utilisateurs. Rien n'est exposé sur Internet.
- Entra ID authentifie les comptes de Plati et de SSHX Platform.

## Rôles et parcours

Ce parcours est la colonne vertébrale du site, du livrable et de la vidéo (une étape = une
illustration = une scène).

| # | Qui | Brique | Étape |
|---|---|---|---|
| 1 | Administrateur | Plati | Rassemble les clés SSH publiques des utilisateurs et les enregistre dans Plati |
| 2 | Administrateur | Plati | Décrit chaque projet une fois, dans un modèle : image, dépôts, agent IA et skills, mixins, ressources |
| 3 | Administrateur | Plati | Crée les micro-VMs (une par personne et par projet), avec Claude Code, SSHX et Tailscale déjà installés |
| 4 | Administrateur | SSHX Platform | Enrôle chaque micro-VM dans SSHX Platform (une commande) |
| 5 | Utilisateur, puis administrateur | SSHX Platform | L'utilisateur se connecte avec son compte Microsoft et choisit sa phrase secrète ; l'administrateur lui partage ses machines |
| 6 | Utilisateur | SSHX Platform | Travaille avec l'agent depuis un navigateur, ordinateur ou téléphone, sans SSH ; suit l'état de tous ses agents |
| 7 | Utilisateur | Tailscale, SSHX | Montre l'avancée sur l'adresse privée de la machine ; partage un terminal en direct par un lien SSHX |

**Décision (16 octobre 2026) : c'est l'administrateur qui enrôle les machines, puis les partage.**
Conséquence à assumer dans les textes : la clé d'une machine naît dans le navigateur de
l'administrateur, qui peut donc ouvrir ses terminaux. Le chiffrement de bout en bout protège des
*serveurs* (SSHX Platform, `sshx-server`), pas de l'administrateur. Le partage chiffre la clé de la
machine pour la clé publique de l'utilisateur, ce qui suppose que celui-ci s'est connecté une
première fois (phrase secrète choisie).

Les développeurs gardent un accès SSH avec leurs clés ; les autres n'en ont pas besoin.

## Messages

1. **Vos données restent chez vous** : vos serveurs, votre réseau privé, vos comptes.
2. **L'administrateur prépare, l'équipe code** : des machines prêtes à l'emploi, identiques pour
   toute l'équipe, recréées sans perdre l'espace personnel.
3. **Un navigateur suffit** : ni SSH, ni éditeur, ni configuration ; aussi sur téléphone. Seul
   Tailscale doit être installé sur l'appareil (pour rejoindre le réseau privé) : ne jamais écrire
   « sans rien installer ».
4. **Suivre plusieurs agents à la fois** : qui travaille, qui pose une question, qui a fini.
5. **La sécurité en couches** : matériel, réseau, identité, isolation, droits, chiffrement.
6. **Déjà en usage** au CATIE.

Positionnement de SSHX Platform : une alternative à VS Code (Remote SSH) ou à Claude Desktop pour
coder avec des agents sur des machines distantes. Le dire sans dénigrer : décrire ce que SSHX
Platform demande (un navigateur, un compte) plutôt que ce qui manque aux autres.

## Vigilance

- **Pas de marque ombrelle.** On parle de « la solution » ou des « trois briques », jamais d'un nom
  inventé. Les noms s'écrivent Plati, SSHX, SSHX Platform (la commande reste `sshx`).
- **Que du vrai.** Chaque affirmation se vérifie dans le code ou la doc du dépôt concerné. Pas de
  témoignage inventé, pas de chiffre d'illustration présenté comme réel.
- **Nuances à garder** : le trafic de VS Code n'est pas chiffré de bout en bout (il l'est par
  Tailscale en transit) ; l'administrateur qui enrôle peut lire les terminaux ; les notifications
  n'arrivent que si un onglet de SSHX Platform est ouvert (pas encore de Web Push, donc pas de
  téléphone verrouillé) ; les états d'agents ne couvrent que Claude Code pour l'instant.
- **Micro-VM** est le mot de Plati (techniquement, des conteneurs système Incus, ou des VMs).
- **Pas de logos tiers** (Microsoft, Tailscale, Anthropic) : leurs noms seulement.
- **À vérifier avant publication** :
  - Entra ID sur SSHX Platform : `docs/architecture.md` le dit implémenté mais pas encore testé
    contre un vrai locataire. Le site le présente comme le mode de connexion.
  - Licence et dépôt public de SSHX Platform (Plati se dit open source ; le fork SSHX est public).
  - Domaine et hébergement du site.

## Identité visuelle

Fond clair (le site s'imprime et devient un PDF), police Inter auto-hébergée (pas de Google Fonts :
pas de requête vers un tiers). Une couleur par brique, reprise partout :

| Rôle | Couleur |
|---|---|
| Plati (reprise de sa landing) | `#2D7A5F`, fond `#E8F3EE` |
| SSHX (rose de sa page d'accueil) | `#BE185D`, fond `#FCE7F3` |
| SSHX Platform | `#4F46E5`, fond `#EEF2FF` |
| Agent au travail | indigo `#4F46E5` |
| Question, autorisation | ambre `#D97706` |
| Travail terminé | émeraude `#059669` |
| Réseau Tailscale | pointillés ardoise `#64748B` |
| Entra ID | `#0369A1` |

Les états d'agents gardent les couleurs de l'interface de SSHX Platform (indigo, ambre, émeraude),
et l'interface elle-même est montrée dans sa palette sombre (zinc).

## Le sous-projet `site/`

```
site/
  DIRECTIVES.md             ce document
  index.html, styles.css    le site (statique, sans build, en français)
  fonts/                    Inter (OFL), auto-hébergée
  illustrations/
    build.mjs               source des illustrations (génère les .svg)
    *.svg                   illustrations générées
    png/                    exports PNG 3200×1800 (PDF, vidéo, présentations)
  scripts/export.mjs        exports PNG, avec Inter intégrée
  livrable/                 livrable PDF pour les financeurs (skill livrable-catie)
```

```bash
node site/illustrations/build.mjs    # régénère les SVG
node site/scripts/export.mjs         # exporte les PNG (Playwright, déjà dans le dépôt)
npx serve site                       # ou ouvrir site/index.html directement
```

## Illustrations

- **Une source, trois usages** : les mêmes images servent au site, au PDF et à la vidéo.
- Les scènes du parcours sont en **16:9 (1600×900)** : chacune est une image clé de la vidéo.
- Chaque élément est un groupe nommé (`<g id="admin">`, `<g id="fleche-plati-vms">`…) : on pourra
  les animer un à un, dans l'ordre de lecture, sans redessiner.
- Les SVG sont générés par `illustrations/build.mjs` : on modifie le script, pas le SVG. Un SVG
  retouché à la main (Figma, Inkscape) doit sortir du script pour ne pas être écrasé.
- Textes courts dans les images (le texte long est dans la page) ; 18 unités minimum, 15 dans les
  maquettes d'interface.
- Personnes et données fictives (Alice, Bruno, Chloé ; `votre-tailnet.ts.net`).

## Vidéo (à venir)

Le storyboard suit le parcours : une scène par étape, la narration reprend le texte de l'étape sur
le site, les groupes nommés s'animent dans l'ordre des flèches. Vue d'ensemble en ouverture,
sécurité et usage au CATIE en clôture.

## Livrable PDF pour les financeurs

Produit avec la skill `livrable-catie` (plan validé, puis rédaction, puis export avec le template
LaTeX CATIE), dans `site/livrable/`. Il reprend le contenu du site, plus détaillé sur l'état
d'avancement et la suite, et les exports PNG des illustrations.

## Questions ouvertes

- Financeurs à nommer, logos à afficher dans le PDF.
- Version anglaise du site (la landing Plati en a une).
- Enrôlement automatique des micro-VMs par un mixin Plati : piste, pas encore décidée.
