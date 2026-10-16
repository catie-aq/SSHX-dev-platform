Livrable financeurs — Plan détaillé

Titre de travail : **Des agents IA privés, gérés par des administrateurs : Plati, SSHX et SSHX Platform**

Sous-titre : *Cloud privé, environnements préconfigurés et accès sécurisé pour les équipes*

Consignes de rédaction :

- Public : les financeurs, et toute personne qui évalue le projet sans lire le code. On décrit ce que
  la solution fait, pour qui, et pourquoi elle est construite ainsi. Aucun nom de fichier, de fonction
  ni de variable. Une seule commande citée (l'enrôlement d'une machine), parce qu'elle illustre
  « une machine se relie en une commande ».
- Source de vérité : `site/DIRECTIVES.md` (vision, parcours, vigilance) et le site
  (`site/index.html`), dont le livrable reprend le contenu en plus détaillé, plus les livrables
  existants du fork SSHX (`../sshx/doc/livrables/`, 00 à 08) auxquels on renvoie au lieu de les
  répéter.
- Données réelles autorisées (accord du 16 octobre 2026) : **8 micro-VMs pour 5 utilisateurs au
  CATIE**. Rien d'autre : ni nom de machine, ni adresse interne, ni nom de collègue. Les personnes et
  données des illustrations sont fictives (Alice, Bruno, Chloé, `votre-tailnet.ts.net`), ce que dit
  une note en tête de document.
- Vigilance (voir DIRECTIVES.md) : pas de marque ombrelle ; l'administrateur qui enrôle une machine
  détient sa clé ; VS Code n'est pas chiffré de bout en bout ; notifications seulement onglet
  ouvert ; états d'agents limités à Claude Code ; Tailscale à installer sur l'appareil.
- Style : celui des livrables CATIE (sections numérotées, sous-parties a/b/c, amorces en gras,
  tableaux courts).
- Illustrations, trois types :
  - **[FIGURE]** : illustration déjà produite (`site/illustrations/`, export PNG 3200×1800), reprise
    telle quelle ;
  - **[CAPTURE]** : capture d'écran d'un des logiciels, à refaire avec des données fictives ;
  - **[À CRÉER]** : illustration nouvelle, à ajouter au générateur des illustrations.

---

Objectifs et approche (1 page)

- Contexte : les agents IA de code (Claude Code, Codex CLI, OpenCode) changent la façon de
  développer, mais demandent une machine complète, des accès, et posent la question de la
  circulation du code et des secrets.
- Objectif du projet : du **cloud privé et des agents IA privés gérés par des administrateurs**, pour
  que les équipes disposent d'environnements sécurisés, préconfigurés, accessibles sur l'intranet
  via Tailscale.
- La réponse en une phrase : trois logiciels du CATIE, Plati (créer), SSHX (ouvrir), SSHX Platform
  (réunir).
- Place dans la suite : les livrables SSHX 00 à 08 détaillent le fork SSHX ; ce document présente la
  solution complète et le lien entre les trois briques.
- Annonce des quatre chapitres.
- Note : personnes et exemples des illustrations fictifs ; seuls chiffres réels, l'usage au CATIE.
- [FIGURE] `chaine` : la solution en un coup d'œil.

---

Chapitre 1 — Le besoin et la solution (2 pages)

1.1 Le constat

- **Une machine à préparer pour chacun** : dépôts, outils, clés ; à refaire à chaque arrivée.
- **Le code qui sort** : postes et agents hébergés chez un éditeur.
- **SSH, un outil d'initiés** : un frein pour les non-développeurs et sur mobile.
- **Plusieurs agents sans vue d'ensemble** : qui attend une réponse, qui a fini.

1.2 Les principes

- Les données restent sur le matériel et le réseau de l'organisation.
- L'administrateur prépare ; l'équipe travaille.
- Un navigateur suffit pour travailler (Tailscale sur l'appareil, pas d'éditeur ni de SSH).
- Le serveur ne lit pas le travail : chiffrement de bout en bout des terminaux.

1.3 Trois briques, une chaîne

- Tableau : brique / rôle / pour qui / ce qu'elle apporte (Plati, SSHX, SSHX Platform).
- Les fondations, qui ne sont pas des projets du CATIE : Tailscale, Microsoft Entra ID, Incus,
  Claude Code.
- Comment elles s'emboîtent : les modèles Plati installent SSHX, Tailscale et Claude Code ; SSHX
  relie chaque machine ; SSHX Platform réunit machines et agents.
- [FIGURE] `briques`.

1.4 Positionnement

- SSHX Platform comme alternative à VS Code (Remote SSH) ou Claude Desktop pour coder sur des
  machines distantes : ce qu'il faut / ce qu'il ne faut plus (tableau).
- Ce qui distingue l'ensemble des offres hébergées : machines chez soi, administrateurs maîtres des
  accès, fournisseur d'IA interchangeable par modèle. Sans nommer ni dénigrer de concurrent.

---

Chapitre 2 — Le parcours : de la clé SSH à la démo (4 pages)

2.1 Les rôles

- **Administrateur** : prépare, relie, partage, administre.
- **Utilisateur** (développeur ou non) : se connecte, travaille avec l'agent, montre son travail.
- **Collègues et responsables** : voient l'avancée sur le réseau privé.

2.2 Le côté administrateur (étapes 1 à 4)

- a. Rassembler les clés SSH, attribuer l'accès Git selon le niveau. [FIGURE] `etape-1-cles`.
- b. Décrire chaque projet une fois dans un modèle ; changer de fournisseur d'IA en modifiant le
  modèle. [FIGURE] `etape-2-modele`.
- c. Créer les micro-VMs : une par personne et par projet, espace personnel conservé, copie,
  transfert, arrêt automatique. [FIGURE] `etape-3-micro-vms`. [CAPTURE] tableau de bord Plati
  (liste des micro-VMs, données fictives).
- d. Relier chaque machine à SSHX Platform en une commande ; la clé naît chez l'administrateur.
  [FIGURE] `etape-4-enrolement`.

2.3 Le côté utilisateur (étapes 5 à 7)

- a. Se connecter (compte Microsoft, phrase secrète) et recevoir ses machines, chiffrées pour soi.
  [FIGURE] `etape-5-connexion`.
- b. Travailler avec l'agent : liste par projet, plein écran, clavier, états des agents,
  notifications, mobile. [FIGURE] `etape-6-agents`. [CAPTURE] SSHX Platform réelle avec une question
  de Claude, et la liste sur téléphone (scénario de test, données fictives).
- c. Montrer l'avancée sur l'adresse privée de la machine ; travailler à deux par un lien SSHX.
  [FIGURE] `etape-7-demo`. [CAPTURE] canevas SSHX avec le flux d'activité Claude (renvoi au livrable
  SSHX 03).

2.4 Ce que le parcours change

- Tableau avant / après, par rôle : temps de mise en route, ce qu'il faut installer, où est le code,
  comment on suit les agents. Formulations qualitatives, sans chiffre inventé.

---

Chapitre 3 — Sécurité et maîtrise (2 pages)

3.1 La sécurité en couches

- Matériel (Incus), réseau privé (Tailscale), identité (Entra ID), isolation (une micro-VM par
  personne et par projet), droits (Git par niveau, secrets chiffrés), chiffrement de bout en bout.
- [FIGURE] `securite`.

3.2 Ce que voient les serveurs

- Tableau : visible (noms des machines et sessions, état des agents, horodatages) / jamais en clair
  (contenu des terminaux, dossiers, branches, noms de terminaux, questions des agents).
- Le principe de la clé : phrase secrète, clé de coffre dans le navigateur, clé de machine, partage
  chiffré pour la clé publique du destinataire. Expliqué sans jargon cryptographique ; les noms
  d'algorithmes en une ligne pour les lecteurs techniques.

3.3 Ce que décide l'administrateur

- Qui reçoit quelle machine, clés SSH, accès Git, secrets, ressources et arrêt automatique, agent
  et fournisseur d'IA.

3.4 Limites assumées

- L'administrateur qui enrôle une machine peut lire ses terminaux (service géré).
- VS Code passe par le relais sans chiffrement de bout en bout (chiffré par Tailscale en transit).
- Les utilisateurs sont des personnes de confiance de l'organisation (isolation par conteneurs
  système, pas par VMs complètes, selon le modèle choisi).

---

Chapitre 4 — État d'avancement, usage et suite (2 pages)

4.1 Usage au CATIE

- 8 micro-VMs pour 5 utilisateurs, administrées avec Plati, accessibles par SSHX et SSHX Platform.
- Les trois logiciels sont développés en binôme avec Claude Code (renvoi au livrable SSHX 00).

4.2 État par brique

- Tableau : fonction / état (opérationnel, partiel, à valider) pour Plati, SSHX, SSHX Platform.
- À valider avant diffusion : la connexion Entra ID de SSHX Platform contre le locataire réel du
  CATIE (implémentée, pas encore testée en conditions réelles).
- Tests : scénario complet automatisé de SSHX Platform (vrais serveurs, vrais clients, vérification
  que la base ne contient rien en clair), tests de Plati et du fork SSHX.

4.3 Pistes de travail

- Notifications sur téléphone verrouillé (Web Push).
- États pour d'autres agents (Codex CLI, Gemini CLI, OpenCode).
- VS Code chiffré de bout en bout par un tunnel SSHX.
- Enrôlement des machines par Plati dès leur création.
- Plusieurs organisations sur une installation (base PostgreSQL, identifiant d'organisation).
- [À CRÉER] frise : disponible / en cours / pistes, aux couleurs des trois briques.

---

Conclusion (½ page)

- Synthèse par chapitre : le besoin, le parcours, la sécurité, l'état.
- **Perspectives** en puces, reprises de 4.3, avec ce que permettrait un financement (à compléter
  avec Jérémy Laviole).

---

Illustrations récapitulées

| Emplacement | Type | Source |
|---|---|---|
| Objectifs | [FIGURE] | `chaine` |
| 1.3 | [FIGURE] | `briques` |
| 2.2 a–d | [FIGURE] | `etape-1-cles` à `etape-4-enrolement` |
| 2.2 c | [CAPTURE] | tableau de bord Plati, données fictives |
| 2.3 a–c | [FIGURE] | `etape-5-connexion` à `etape-7-demo` |
| 2.3 b | [CAPTURE] | SSHX Platform et sa version mobile (scénario de test, chemins neutres) |
| 2.3 c | [CAPTURE] | canevas SSHX avec flux d'activité Claude |
| 3.1 | [FIGURE] | `securite` |
| 4.3 | [À CRÉER] | frise d'avancement |

Questions avant rédaction

- Numéro du livrable, financeur(s) à nommer en couverture, date de remise.
- Logos des financeurs en couverture ?
- Le livrable doit-il aussi exister en présentation (slides Marp) ?
- Export : pandoc et XeLaTeX ne sont pas installés sur ce poste (`brew install pandoc` et MacTeX
  ou BasicTeX).
