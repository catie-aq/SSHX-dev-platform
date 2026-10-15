# sshx platform

Plateforme web multi-utilisateurs pour **travailler dans des terminaux persistants** sur un parc de
machines (personnelles, de projet, ou le PC local), avec un suivi clair des **agents IA** :
travail en cours, question posée, autorisation demandée, travail terminé.

Elle s'appuie sur [sshx (fork CATIE)](../sshx) sans le remplacer :

- les machines font tourner `sshx`, qui relaie les terminaux par `sshx-server` comme aujourd'hui ;
- les terminaux restent **chiffrés de bout en bout** : ni la plateforme ni sshx-server ne voient leur contenu ;
- chaque session reste ouvrable dans le canevas sshx classique, et partageable par un simple lien sshx.

## Ce que fait la plateforme

- **Liste de terminaux à gauche**, groupée par projet (dépôt git ou nom de dossier, identique d'une
  machine à l'autre) ou par machine. Tri par glisser-déposer, épinglage, renommage (double-clic),
  filtre, sessions hors ligne affichées en grisé.
- **Terminal plein panneau**, jusqu'à trois côte à côte (Alt+clic). Écho prédictif et thèmes de sshx.
  Navigation Alt+↑/↓ et Alt+1…9.
- **États des agents** par terminal, remontés par les hooks Claude Code : badges, bandeau avec la
  question ou la réponse finale, compteur « à traiter » dans le titre de l'onglet. Un badge vert
  signale un travail terminé que vous n'avez pas encore regardé.
- **Cloche par terminal** : notification du navigateur quand cet agent termine, pose une question ou
  demande une autorisation.
- **Mobile** : liste puis terminal plein écran, barre de touches (Ctrl, Esc, Tab, flèches, ^C…).
- **Machines** : jetons d'enrôlement par machine, rotation, révocation, partage chiffré avec
  d'autres utilisateurs (machines de projet).
- **VS Code** à la demande sur les machines lancées avec `sshx --ide`, protégé par un jeton dérivé
  de la clé de session.
- **Administration** : utilisateurs, machines et sessions (métadonnées uniquement).
- **Connexion** : Microsoft Entra ID (OIDC) ; en attendant, un mode dev sans mot de passe.

## Démarrage rapide (développement)

Prérequis : Rust stable, Node 20, et le dépôt `sshx` cloné à côté (`../sshx`, branche `platform`).

```shell
npm install
mprocs            # sshx-server, plateforme, frontend Vite
```

Ou à la main :

```shell
(cd ../sshx && cargo run --bin sshx-server -- --listen 127.0.0.1 --secret dev --override-origin http://127.0.0.1:8051)
cargo run -- --sshx-server http://127.0.0.1:8051       # API sur 127.0.0.1:8060
npm run dev                                            # interface sur http://localhost:5180
```

Puis, dans l'interface : choisir un nom, créer la phrase de chiffrement, aller dans **Machines**,
créer un jeton, et sur la machine :

```shell
sshx platform enroll http://localhost:5180 smt_….<clé>
sshx claude-hooks install
sshx --server http://127.0.0.1:8051
```

## Production (réseau Tailscale)

```shell
npm run build
cargo build --release
PLATFORM_LISTEN=0.0.0.0:8060 \
PLATFORM_PUBLIC_URL=https://plateforme.<tailnet>.ts.net \
PLATFORM_SSHX_SERVER=http://127.0.0.1:8051 \
PLATFORM_DATABASE=sqlite:///var/lib/sshx-platform/platform.db \
PLATFORM_STATIC_DIR=/opt/sshx-platform/build \
./target/release/sshx-platform
```

Servez-la en HTTPS (certificat Tailscale, comme sshx, voir `../sshx/Tailscale.md`) : le chiffrement
du navigateur (Web Crypto) l'exige hors de `localhost`.

**Machines cloud où sshx tourne déjà en service** : sous l'utilisateur du service, lancer une fois
`sshx platform enroll <url> <jeton>` puis `sshx claude-hooks install`, et redémarrer le service.
Avec `--slug <nom>`, la session garde le même nom d'un redémarrage à l'autre, et vos noms et
réglages de terminaux restent rattachés.

### Activer Microsoft Entra ID

1. Entra ID → Inscriptions d'applications → Nouvelle inscription, comptes de **ce seul locataire**.
2. URI de redirection (Web) : `https://<plateforme>/api/auth/oidc/callback`.
3. Certificats et secrets → nouveau secret client.
4. Lancer la plateforme avec :

```shell
PLATFORM_AUTH=oidc
PLATFORM_PUBLIC_URL=https://<plateforme>
PLATFORM_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
PLATFORM_OIDC_CLIENT_ID=<application-id>
PLATFORM_OIDC_CLIENT_SECRET=<secret>
PLATFORM_ADMINS=prenom.nom@catie.fr,autre@catie.fr
```

Les utilisateurs sont créés à la première connexion (identifiant : `preferred_username`).

## Documentation

- [docs/architecture.md](docs/architecture.md) : architecture, modèle de sécurité, protocole
  machine ↔ plateforme, limites connues et suite.
- [CLAUDE.md](CLAUDE.md) : guide du code pour les agents.

## Tests

```shell
cargo test        # API de bout en bout (connexion, coffre, jetons, rapports, partage, CSRF)
npm test          # cryptographie, dont un vecteur partagé avec le client Rust
npm run check     # typage Svelte/TypeScript
```
