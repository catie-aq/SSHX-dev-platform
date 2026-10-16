# SSHX Platform

**SSHX Platform** est une plateforme web multi-utilisateurs pour **travailler dans des terminaux
persistants** sur un parc de machines (personnelles, de projet, ou le PC local), avec un suivi clair
des **agents IA** : travail en cours, question posée, autorisation demandée, travail terminé.

Elle s'appuie sur [sshx (fork CATIE)](../sshx) sans le remplacer :

- les machines font tourner `sshx`, qui relaie les terminaux par `sshx-server` comme aujourd'hui ;
- les terminaux restent **chiffrés de bout en bout** : ni la plateforme ni sshx-server ne voient leur contenu ;
- chaque session reste ouvrable dans le canevas sshx classique, et partageable par un simple lien sshx.

## Ce que fait la plateforme

- **Liste de terminaux à gauche**, groupée par projet (dépôt git ou nom de dossier, identique d'une
  machine à l'autre) ou par machine. Tri par glisser-déposer, épinglage, renommage (double-clic),
  fermeture par la croix de la ligne (avec confirmation), filtre, sessions hors ligne affichées en
  grisé.
- **Un terminal plein écran à la fois**, avec l'écho prédictif et les thèmes de sshx.
- **Raccourcis clavier**, actifs même quand le terminal a le clavier et jamais envoyés au shell.
  Le modificateur est ⌃⌥ sur Mac (⌥ seul sert à taper « } », « ~ », « [ »… en BÉPO et en AZERTY) et
  Alt sous Linux et Windows (où AltGr tape ces caractères) :

  | Touches (Mac / Linux) | Action |
  |---|---|
  | ⌃⌥K / Alt+K (et ⌘K sur Mac) | Aller à un terminal : quelques lettres du nom, du projet, de la machine ou de la branche, puis Entrée |
  | ⌃⌥J / Alt+J | Terminal suivant à traiter (question, autorisation, travail terminé non lu) |
  | ⌃⌥L / Alt+L | Revenir au terminal précédent (bascule entre les deux derniers) |
  | ⌃⌥↑ ⌃⌥↓ / Alt+↑ Alt+↓ | Terminal au-dessus / en dessous dans la liste |
  | ⌃⌥1…9 / Alt+1…9 | n-ième terminal de la liste |
  | ⌃⌥N / Alt+N | Nouveau terminal sur la même machine, dans le même dossier |
  | ⌃⌥R / Alt+R | Renommer le terminal |
  | ⌃⌥X / Alt+X | Fermer le terminal (Entrée confirme, Échap annule) |
  | ? | Aide des raccourcis (hors terminal) |

  Les lettres suivent la disposition du clavier (BÉPO, AZERTY, QWERTZ…) : K est la touche marquée K.
  Chaque raccourci se redéfinit depuis l'aide (?, puis « Modifier ») ; le réglage est propre à
  l'appareil.
- **États des agents** par terminal, remontés par les hooks Claude Code : badges, bandeau avec la
  question ou la réponse finale, compteur « à traiter » dans le titre de l'onglet. Un badge vert
  signale un travail terminé que vous n'avez pas encore regardé.
- **Cloche par terminal** : notification du navigateur quand cet agent termine, pose une question ou
  demande une autorisation.
- **Mobile** : liste puis terminal plein écran, barre de touches (Ctrl, Esc, Tab, flèches, ^C…).
- **Personnel** : noms, épinglage, ordre et cloches sont propres à chaque utilisateur, y compris sur
  une machine partagée. Taille du texte du terminal et largeur de la liste réglables.
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
mprocs            # sshx-server (8051), plateforme (8060), interface Vite (5180)
```

Ouvrez http://localhost:5180 et suivez les trois étapes affichées :

1. **Connexion** : un identifiant (mode dev, sans mot de passe).
2. **Phrase secrète** : elle chiffre vos terminaux et ne quitte jamais le navigateur.
3. **Première machine** : donnez-lui un nom, puis collez la commande affichée dans un terminal de
   la machine. Elle ressemble à :

   ```shell
   sshx platform enroll http://localhost:5180 smt_….<clé> && sshx
   ```

   La page détecte la machine et ouvre son premier terminal toute seule.

`enroll` enregistre la plateforme et le serveur sshx qu'elle annonce, et installe les hooks Claude
Code ; ensuite, un simple `sshx` suffit. Pour vérifier une machine à tout moment :

```shell
sshx platform status    # plateforme, jeton, serveur sshx, sessions, hooks Claude, ce terminal
```

La commande `sshx` doit être la version CATIE avec la plateforme (branche `platform` du dépôt
sshx). En développement : `../sshx/target/debug/sshx`, ou `cargo install --path ../sshx/crates/sshx`.

Sans mprocs, à la main :

```shell
(cd ../sshx && cargo run --bin sshx-server -- --listen 127.0.0.1 --secret dev --override-origin http://127.0.0.1:8051)
cargo run -- --sshx-server http://127.0.0.1:8051       # API sur 127.0.0.1:8060
npm run dev                                            # interface sur http://localhost:5180
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
`sshx platform enroll <url> <jeton>` (la commande sans `&& sshx`), puis redémarrer le service.
Si les machines joignent le serveur sshx par une autre adresse que la plateforme, indiquez-la avec
`PLATFORM_SSHX_PUBLIC_URL` : elle leur est annoncée à l'enrôlement.
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
npm run verify    # tout : tests Rust (sshx et plateforme), chiffrement, typage, full-stack
npm run e2e       # seulement le scénario full-stack
```

Le scénario full-stack (`tests/e2e/`) démarre un vrai sshx-server, la plateforme avec une base
jetable et de vrais clients sshx, avec un `HOME` temporaire (vos `~/.sshx` et `~/.claude` ne sont
pas touchés), puis pilote Chromium sans interface : connexion, phrase secrète, commande
d'enrôlement copiée depuis la page et exécutée, saisie dans le terminal, `sshx platform status`,
états Claude rejoués par les vrais hooks (`sshx hook claude`), non-lu et notification,
renommage chiffré (vérifié dans la base), raccourcis clavier (QWERTY et BÉPO), fermeture (menu du
terminal et croix de la liste), nouvel appareil mobile, partage, contrôles d'accès, arrêt et relance
de la machine. Les captures d'écran de chaque étape sont dans
`test-results/screens/`.

Première fois : `npx playwright install --only-shell chromium`. Variables utiles : `E2E_SKIP_BUILD=1`
(ne pas recompiler), `E2E_KEEP=1` (garder les journaux et la base), `SSHX_REPO` (dépôt sshx).
