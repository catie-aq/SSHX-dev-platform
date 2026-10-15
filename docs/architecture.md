# Architecture de la plateforme sshx

## Vue d'ensemble

```
 Machine (PC, serveur cloud, machine de projet)
 ┌──────────────────────────────────────────────────────────┐
 │ sshx (CLI, branche `platform` du dépôt sshx)             │
 │  ├─ shells PTY ── variables SSHX_SESSION,                │
 │  │                SSHX_TERMINAL_ID, SSHX_HOOK_SOCKET     │
 │  ├─ socket privé ◀── `sshx hook claude` ◀── hooks Claude │
 │  ├─ registre : dossier, git, processus, état agent       │
 │  ├─ gRPC ─────────────────────────────▶ sshx-server      │
 │  └─ HTTPS (jeton machine) ────────────▶ plateforme       │
 └──────────────────────────────────────────────────────────┘
                          │                      │
                    sshx-server             sshx-platform
                (relais, inchangé)     (Rust, axum, SQLite)
                          ▲                      │
                          │ WebSocket proxifié   │ SSE (événements)
                          └──────── Navigateur ◀─┘
                     (SvelteKit, libs sshx réutilisées)
```

Trois composants, deux dépôts :

| Composant | Dépôt | Rôle |
|---|---|---|
| `sshx` (CLI) | `sshx`, branche `platform` | Terminaux, hooks agents, suivi par terminal, inscription auprès de la plateforme |
| `sshx-server` | `sshx` | Relais chiffré des terminaux, canevas, IDE (inchangé, hormis le jeton IDE) |
| `sshx-platform` | ce dépôt | Comptes, machines, liste des terminaux, états, préférences, proxy WebSocket |

Le frontend importe directement depuis `../sshx/src/lib` (alias `$sshx`) le chiffrement
(`encrypt.ts`), le protocole (`protocol.ts`), la socket reconnectante (`srocket.ts`), le verrou, les
thèmes, l'écho prédictif (`typeahead.ts`), le placement (`arrange.ts`) et le jeton IDE
(`ideToken.ts`). Les deux projets évoluent donc ensemble ; un changement de protocole sshx se voit
immédiatement à la compilation de la plateforme.

## Modèle de sécurité

### Chiffrement de bout en bout

La plateforme ajoute une hiérarchie de clés au-dessus de sshx, sans affaiblir sa garantie :

```
phrase de chiffrement ──Argon2id (64 Mio, t=3)──▶ clé de coffre (navigateur seulement)
   ├─ scelle la clé privée ECDH P-256 de l'utilisateur
   └─ scelle la clé de chaque machine possédée
clé de machine (32 octets, tirée dans le navigateur, incluse dans le jeton donné à la machine)
   ├─ scelle la clé de session sshx (le fragment # d'un lien sshx)
   ├─ scelle les métadonnées de chaque terminal (dossier, git, processus, texte de l'agent)
   └─ scelle les noms personnalisés des terminaux
```

- Format scellé commun Rust/TypeScript : `v1.` + base64url(nonce ‖ AES-256-GCM), avec des données
  associées qui lient chaque valeur à son emplacement (`…/session-key/<session>`,
  `…/terminal-meta/<session>/<sid>`…). Le serveur ne peut ni lire, ni déplacer un chiffré d'une
  session à une autre. Un vecteur de test commun vérifie la compatibilité des deux implémentations.
- **Jeton machine** : `smt_<secret>.<clé machine>`. Seul `smt_<secret>` part vers la plateforme
  (stocké haché SHA-256). La clé, après le point, ne quitte jamais la machine et le navigateur du
  propriétaire, exactement comme le fragment d'un lien sshx.
- **Ce que voit le serveur** : noms techniques des sessions, numéros de terminaux, état de l'agent
  (`working`, `question`…), horodatages, nom d'hôte et nom des machines. Il ne voit ni le contenu
  des terminaux, ni les dossiers, ni les branches, ni les questions des agents, ni vos noms de
  terminaux.
- **Partage d'une machine** : la clé de la machine est scellée pour la clé publique du
  destinataire (ECDH éphémère + HKDF-SHA256 + AES-GCM). L'empreinte de la clé publique est affichée
  pour une vérification hors bande, car un serveur malveillant pourrait substituer une clé publique.
- **Appareils** : les clés déverrouillées sont gardées en IndexedDB sous forme de `CryptoKey` non
  extractibles (option « se souvenir sur cet appareil »).

### Authentification et autorisations

- Humains : cookie `HttpOnly`, `SameSite=Lax`, `Secure` derrière HTTPS, haché en base. Toute requête
  modifiante exige l'en-tête `x-sshx-platform` (protection CSRF).
- Mode `dev` : choix libre du nom, tout le monde est administrateur. Réservé au tailnet en attendant
  Entra ID ; la page de connexion l'affiche en clair.
- Mode `oidc` : code d'autorisation + PKCE + nonce, jeton d'identité vérifié par JWKS (émetteur,
  audience, expiration).
- Accès à une session : il faut une ligne `machine_keys` (propriétaire ou membre). Le proxy
  WebSocket le vérifie, puis sshx-server exige en plus la preuve de possession de la clé
  (`encrypted_zeros`, comparaison à temps constant).
- Socket de hooks : répertoire `0700` et socket `0600` propres à l'utilisateur ; les messages d'une
  autre session sont ignorés.

### Correctif apporté à sshx : l'IDE embarqué

OpenVSCode était lancé avec `--without-connection-token`, et sshx-server relaie `/ide/s/<session>/`
sans contrôle : connaître le nom de la session suffisait pour ouvrir VS Code, donc un terminal, sur
la machine. Les slugs lisibles (`--slug plati`) rendaient ce nom devinable. Désormais, l'IDE exige un
jeton dérivé de la clé de session (`ide::connection_token`, `ideToken.ts`), passé par fichier et non
en argument de processus. Le trafic de l'IDE traverse toujours sshx-server en clair : il n'est pas
chiffré de bout en bout comme les terminaux.

## États des agents

`sshx claude-hooks install` ajoute à `~/.claude/settings.json` des hooks synchrones qui exécutent
`sshx hook claude`. Hors d'un terminal sshx, la commande ne fait rien ; elle n'écrit jamais sur la
sortie et sort toujours avec le code 0, pour ne jamais perturber Claude.

| Événement Claude Code | État |
|---|---|
| `SessionStart` | `idle` (agent présent) |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact` | `working` |
| `PreToolUse` sur `AskUserQuestion` ou `ExitPlanMode` | `question` (texte de la question) |
| `PermissionRequest`, `Notification` `permission_prompt` | `permission` |
| `Stop` | `done` (avec `last_assistant_message`) |
| `StopFailure` | `done` avec l'erreur |
| `SessionEnd` | plus d'agent |

Compléments côté sshx :

- les événements sont horodatés par `sshx hook` ; un événement plus ancien que le dernier appliqué
  est ignoré ;
- Claude ne déclenche aucun hook sur Échap ou Ctrl-C : après 15 s sans événement en état
  `working`, sshx lit la fin du transcript pour y détecter `[Request interrupted by user` ;
- si le shell revient au premier plan du terminal (groupe de processus de premier plan égal au
  PID du shell) sans événement depuis 10 s, l'agent est considéré comme terminé.

Pour Gemini CLI, Codex ou OpenCode, le même chemin servira : `sshx hook <agent>` et une table de
correspondance par agent dans `crates/sshx/src/agent.rs`.

## Protocole machine ↔ plateforme

Authentification : `Authorization: Bearer smt_…`.

| Requête | Rôle |
|---|---|
| `GET /api/agent/v1/whoami` | Vérifier le jeton (`sshx platform enroll`, `status`) |
| `POST /api/agent/v1/sessions` | Annoncer une session : nom, URL sans clé, `keyEnc`, hôte, OS, version |
| `PUT /api/agent/v1/sessions/{name}/state` | Liste complète des terminaux `{sid, state, since, agent, metaEnc}`. Sert aussi de battement de cœur (15 s). `404` : la plateforme a oublié la session, la machine se réinscrit. |
| `POST /api/agent/v1/sessions/{name}/close` | Fermeture propre (Ctrl-C) |

Une session sans rapport depuis 45 s passe hors ligne ; ses terminaux restent listés en grisé
jusqu'à ce qu'on l'oublie.

## Données (SQLite)

`users`, `web_sessions`, `vaults`, `machines`, `machine_keys`, `sessions`, `terminals`,
`terminal_prefs` (voir `crates/sshx-platform/migrations/0001_init.sql`). Les colonnes `*_enc` ne
contiennent que du chiffré. Le passage à PostgreSQL pour une version multi-organisations ne
demande que de changer de pilote sqlx et d'adapter quelques requêtes `ON CONFLICT`.

## Limites connues et suite

- **Entra ID** : le flux OIDC est implémenté et compilé, mais pas encore testé contre un vrai
  locataire.
- **IDE à la demande** : la machine doit avoir été lancée avec `sshx --ide`. Le lancement depuis la
  plateforme demandera une commande plateforme → machine (la réponse au rapport d'état est prévue
  pour la porter).
- **Notifications** : uniquement quand un onglet de la plateforme est ouvert. Le Web Push
  (service worker) permettrait de notifier un téléphone verrouillé.
- **Persistance** : noms et réglages sont rattachés à `session/terminal`. Sans `--slug`, une
  session redémarrée porte un nouveau nom et repart sans eux.
- **Taille partagée** : comme dans sshx, un terminal a une seule taille ; un téléphone qui l'affiche
  la réduit pour tout le monde.
- **Partage d'une session à un collègue sans compte** : le lien sshx (bouton Partager) donne accès
  à toute la session de la machine, en écriture.
- **Multi-organisations, nom de domaine dédié** : prévoir un identifiant d'organisation sur
  `users` et `machines`, et PostgreSQL.
