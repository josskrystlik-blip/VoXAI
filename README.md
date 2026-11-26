# 🎙️ VoxAI - Dictaphone Intelligent & Assistant de Conversation

Dictaphone web boosté par l'Intelligence Artificielle (**Google Gemini** ou **LLM local**), qui fonctionne entièrement dans le navigateur : hébergeable sur **GitHub Pages**, avec toutes les données stockées **localement** (IndexedDB).

---

## ✨ Fonctionnalités Clés

1. **Expérience Dictaphone & Multi-enregistrements Ultra-Simple** :
   - **Enregistrement en 1 clic** avec visualiseur d'ondes sonores (*waveform*) en temps réel.
   - **Importation multi-fichiers pour une même analyse** : sélectionnez plusieurs fichiers audio simultanément (parties 1, 2, 3...) pour générer un rapport unifié et une transcription consolidée.
   - **Ajout à chaud d'enregistrements** : possibilité d'ajouter des fichiers audio supplémentaires à une session existante et de relancer l'IA.
   - **Lecteur multipiste synchronisé** : basculez d'une piste à l'autre en un clic, avec saut automatique lors du clic sur un horodatage.
   - Contrôles complets : Pause, Reprise, Annulation, Terminer.

2. **Intelligence Artificielle Multimodale** :
   - **Transcription mot pour mot** avec horodatages dynamiques et identification des orateurs (*Speaker Diarization*).
   - **Synchronisation Audio/Texte** : Cliquez sur n'importe quel horodatage (`▶ 01:23`) pour sauter directement à cet instant dans la piste audio.
   - **Synthèse Structurée Automatique** :
     - 📌 **Résumé Exécutif** en 3 à 5 phrases.
     - 🎯 **Décisions Clés** validées pendant la conversation.
     - ✅ **Plan d'Action** interactif (cases à cocher, assignés, échéances).
     - 🏷️ **Points Clés & Thématiques**.
   - **Assistant IA Conversationnel (Chat)** : Posez des questions ciblées sur l'enregistrement (*"Quelles sont les dates limites mentionnées ?"*, *"Rédige un compte-rendu pour le client"*).

3. **Architecture Hybride : Cloud vs On-Premise** :
   - **Mode Cloud (Grand Public)** : Connectez votre clé d'API **Google Gemini** (`gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-4-argon`).
   - **Mode On-Premise (Local / Privé)** : Connectez vos modèles locaux (**Ollama**, **vLLM**, **faster-whisper**) pour une conformité RGPD totale sans fuite de données vers l'extérieur.
   - Bouton **"Tester la connexion"** intégré pour valider l'accès en 1 seconde.

4. **Application installable, utilisable hors ligne (PWA)** :
   - Bouton **📲 Installer** (Chrome, Edge) ou « Sur l'écran d'accueil » (Safari) : VoxAI s'ouvre comme une application, **même sans réseau**.
   - **Le dictaphone fonctionne hors ligne** : l'audio est enregistré sur l'appareil. Si le serveur d'IA est injoignable (réseau coupé, VPN absent), l'enregistrement passe **« ⏳ En attente »** au lieu d'échouer.
   - Au retour du réseau, un bandeau propose **🧠 Analyser maintenant** pour tous les enregistrements en attente (ou « Relancer IA » sur l'un d'eux).

5. **100 % local, aucun serveur** :
   - Application web statique : fonctionne directement depuis **GitHub Pages** (ou n'importe quel hébergement statique).
   - Toutes les données (audios, transcriptions, synthèses, chat, réglages et clé d'API) sont stockées dans une **base locale du navigateur (IndexedDB)**. Rien n'est sauvegardé dans le cloud.
   - Seule l'analyse IA sort de votre machine, et uniquement vers le fournisseur que vous choisissez (Gemini, ou votre LLM local en mode 100 % hors-ligne).

---

## 🚀 Démarrage

### Option A — GitHub Pages (recommandé)

1. Dans le dépôt GitHub : **Settings → Pages**.
2. **Source** : *GitHub Actions* (une seule fois).
3. Le workflow `.github/workflows/pages.yml` publie l'application à chaque mise à jour de `main` (ou à la demande depuis l'onglet **Actions**). Seuls les fichiers de l'interface sont publiés.
4. Après une minute, l'application est en ligne sur `https://<votre-compte>.github.io/VoXAI/`.

### Option B — En local

```bash
./start.sh
```

Puis ouvrez **[http://localhost:8080](http://localhost:8080)**.

### Option C — Docker

```bash
docker run -d -p 8080:80 --name voxai ghcr.io/josskrystlik-blip/voxai:latest
```

ou, depuis le dépôt : `docker compose up -d`. Ouvrez ensuite **[http://localhost:8080](http://localhost:8080)**.

L'image (nginx, ~75 Mo) ne sert que des fichiers statiques : elle ne stocke aucune donnée et ne journalise pas les requêtes.

> 🎙️ Le micro n'est accessible au navigateur qu'en HTTPS ou sur `localhost`. Pour exposer le conteneur sur le réseau, placez-le derrière un reverse proxy HTTPS (Caddy, Traefik, nginx…). L'import de fichiers audio fonctionne dans tous les cas.

### Option D — Release (livrable hors-ligne)

Chaque [release](https://github.com/josskrystlik-blip/VoXAI/releases) contient :

- `voxai-docker-X.Y.Z.zip` : image Docker hors-ligne et `docker-compose.yml` (`docker load -i …` puis `docker compose up -d`) ;
- `voxai-web-X.Y.Z.zip` : le site statique, à déposer sur n'importe quel hébergement web ;
- `SHA256SUMS.txt` : les empreintes de vérification.

Pour publier une nouvelle version, il suffit de pousser un tag :

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Le workflow `.github/workflows/release.yml` construit l'image (amd64 + arm64), la publie sur `ghcr.io` et crée la release avec ses fichiers.

Avant chaque release, mettez à jour la version affichée en bas de la barre latérale (`id="appVersion"` dans `index.html`) et ajoutez une entrée en tête de la fenêtre « Nouveautés » : la release refuse de partir si la version affichée ne correspond pas au tag.

> 💾 Les données sont propres à chaque navigateur et à chaque adresse : un enregistrement fait sur GitHub Pages n'apparaît pas sur `localhost`, et inversement. Vider les données du site dans le navigateur efface la base.

---

## 🔑 Configurer la clé d'API Gemini

1. Cliquez sur l'icône **⚙️ (Paramètres)** en haut à droite.
2. Sous l'onglet **Cloud (Gemini)**, collez votre clé d'API *(à générer sur [Google AI Studio](https://aistudio.google.com/apikey))*.
3. Cliquez sur **🔌 Tester la connexion**, puis **Enregistrer la configuration**.

La clé est conservée uniquement dans la base locale de votre navigateur et envoyée directement à Google lors des analyses.

---

## 🏢 Mode On-Premise (LLM local)

La page appelle votre serveur local directement depuis le navigateur. Il faut donc autoriser l'origine de la page (CORS).

1. Lancez **Ollama** en autorisant l'origine de l'application :
   ```bash
   OLLAMA_ORIGINS="https://<votre-compte>.github.io,http://localhost:8080" ollama serve
   ```
   puis `ollama pull llama3.2`.
2. *(Optionnel, transcription 100 % hors-ligne)* : lancez un serveur Whisper compatible OpenAI avec CORS activé :
   ```bash
   docker run -d -p 8000:8000 --gpus all fedirz/faster-whisper-server:latest-cuda
   ```
3. Dans **⚙️ → 🔒 On-Premise (Local)** :
   - **URL LLM** : `http://localhost:11434/v1`
   - **Modèle LLM** : `llama3.2` (ou bouton de détection automatique)
   - **URL Whisper** : `http://localhost:8000/v1`
4. Testez la connexion et enregistrez.

> ℹ️ Chrome, Edge et Firefox autorisent une page HTTPS à appeler `http://localhost`. Safari le bloque : utilisez l'option B (`./start.sh`) dans ce cas.

---

## 🏢 Serveur IA d'entreprise (ex. gpt-oss-120b derrière LibreChat)

Si votre entreprise expose un modèle via une API compatible OpenAI (vLLM, LiteLLM, Azure OpenAI… souvent le même serveur que celui utilisé par LibreChat) :

1. **⚙️ → 🔒 On-Premise** → préconfiguration **🏢 Entreprise (gpt-oss-120b)**.
2. **URL** : l'adresse de l'API, par ex. `https://ia.mon-entreprise.fr/v1`, et **Clé d'API** : votre clé personnelle.
3. **Détecter mes modèles** pour vérifier l'accès, puis choisir `gpt-oss-120b`.
4. Transcription : **🔒 100 % Hors-Ligne** avec l'URL et le modèle Whisper du serveur (ex. `whisper-large-v3`) pour que l'audio ne quitte pas l'entreprise ; le mode **Hybride** envoie l'audio à Gemini.

Côté serveur, l'origine de VoxAI (adresse GitHub Pages ou du conteneur Docker) doit être autorisée en CORS.

## 🏭 Déploiement en entreprise (sans Internet)

📖 **Guide complet : [docs/DEPLOIEMENT-DOCKER.md](docs/DEPLOIEMENT-DOCKER.md)** (prérequis, 100 % sur site, HTTPS et reverse proxy, CORS, vérification, mises à jour, dépannage).

L'interface ne charge **aucune ressource externe** : styles et polices sont servis par l'application (`vendor/`). Avec l'image Docker, l'administrateur peut fixer les réglages de tous les utilisateurs par des variables d'environnement ; ils n'ont alors rien à configurer.

**100 % sur site par défaut** : dès que le LLM de l'entreprise est choisi, la transcription passe par le serveur Whisper (le mode Hybride, qui envoie l'audio à Google, ne s'active que sur choix explicite) et la transcription en direct du navigateur est coupée. Le bilan **🛡️ Où partent vos données** (⚙️ Paramètres, assistant de démarrage) l'affiche pour chaque traitement.

| Variable | Rôle | Exemple |
| :--- | :--- | :--- |
| `VOXAI_DISABLE_CLOUD` | `true` : impose le mode 100 % interne (Gemini, mode Hybride, transcription en direct du navigateur et Gmail désactivés et masqués) et limite les connexions du navigateur aux serveurs déclarés ci-dessous | `true` |
| `VOXAI_PROVIDER` | Moteur par défaut : `local` ou `gemini` | `local` |
| `VOXAI_LLM_URL` / `VOXAI_LLM_MODEL` | Serveur LLM compatible OpenAI et modèle | `https://ia.entreprise.fr/v1` / `gpt-oss-120b` |
| `VOXAI_LLM_API_KEY` | Clé partagée (facultatif, voir ⚠️) | |
| `VOXAI_STT_MODE` | `local` (Whisper interne, par défaut) ou `cloud` (Hybride : audio vers Google) | `local` |
| `VOXAI_STT_URL` / `VOXAI_STT_MODEL` / `VOXAI_STT_API_KEY` | Serveur de transcription Whisper | `https://ia.entreprise.fr/v1` / `whisper-large-v3` |
| `VOXAI_LANGUAGE` | Langue des enregistrements | `fr` |
| `VOXAI_CONFLUENCE_URL` | URL Confluence pré-remplie (sinon `CONFLUENCE_URL` active le proxy) | |
| `VOXAI_CSP_CONNECT_SRC` | Serveurs joignables par le navigateur (remplace la restriction automatique du mode 100 % interne) | `'self' https://ia.entreprise.fr` |

```bash
docker run -d -p 8080:80 \
  -e VOXAI_DISABLE_CLOUD=true -e VOXAI_PROVIDER=local \
  -e VOXAI_LLM_URL=https://ia.entreprise.fr/v1 -e VOXAI_LLM_MODEL=gpt-oss-120b \
  -e VOXAI_STT_MODE=local -e VOXAI_STT_URL=https://ia.entreprise.fr/v1 -e VOXAI_STT_MODEL=whisper-large-v3 \
  -e CONFLUENCE_URL=https://confluence.entreprise.fr \
  ghcr.io/josskrystlik-blip/voxai:latest
```

- Ces valeurs sont les réglages **par défaut** : un utilisateur peut les modifier, et seul ce qu'il change est enregistré ; si l'administrateur fait évoluer une URL ou un modèle, tous les autres en profitent. `VOXAI_DISABLE_CLOUD` s'impose toujours.
- ⚠️ `VOXAI_LLM_API_KEY` est lisible par toute personne ayant accès à la page (`/voxai-defaults.json`) : réservez-la à un réseau interne, ou laissez chaque utilisateur saisir sa clé personnelle.

### Assistant de démarrage

Au premier lancement, un assistant guide la configuration en 5 étapes : moteur d'IA (serveurs de l'entreprise ou Gemini, avec **test du LLM et du serveur Whisper**), Confluence, première série de réunions, puis bilan de confidentialité. Les réglages et la politique de l'administrateur sont repris. Il se relance depuis ⚙️ Paramètres → **🧭 Assistant de démarrage**.

### Modifier l'interface

Les styles Tailwind et les polices sont générés dans `vendor/` (versionné). Après une modification de `index.html` ou des fichiers JS, régénérez-les :

```bash
npm ci && npm run build
```

Un contrôle automatique sur chaque pull request vérifie que `vendor/` est à jour et qu'aucune ressource externe n'est chargée.

## 📘 Publication dans Confluence

Chaque enregistrement analysé peut être publié en compte rendu dans Confluence (bouton **📘 Confluence**) :

1. **⚙️ Paramètres → Publication Confluence** : URL de Confluence et **jeton d'accès personnel (PAT)** (*Profil → Jetons d'accès personnels* sur Confluence Server / Data Center). Sur un Data Center sans jeton (avant 7.9), choisissez *Identifiant + mot de passe* ; pour Confluence Cloud, *E-mail + jeton d'API*. Data Center sur site (port, chemin `/confluence`, base MySQL, certificats internes) : voir [le guide de déploiement](docs/DEPLOIEMENT-DOCKER.md#63-confluence).
2. Dans la fenêtre de publication : choisissez l'**espace**, parcourez l'**arborescence** (ou recherchez une page par titre), puis
   - **Créer une page** sous l'emplacement sélectionné, ou
   - **Mettre à jour la page** sélectionnée (ajout à la fin ou remplacement du contenu).
3. Le compte rendu contient le résumé, les décisions, le plan d'action (cases à cocher Confluence), les points clés et, en option, la transcription dans un bloc dépliable. Les tags deviennent des étiquettes.
4. La **transcription intégrale est jointe à la page** (fichier `Transcription - <titre>.txt`, lien dans le compte rendu). VoxAI relit ensuite la liste des pièces jointes pour **vérifier** que le fichier est bien présent et complet ; lors d'une mise à jour, une nouvelle version de la pièce jointe est créée.

### CORS : utiliser le proxy du conteneur

Confluence refuse en général les appels venant d'une autre origine (GitHub Pages, etc.). Avec l'image Docker, définissez `CONFLUENCE_URL` : le conteneur relaie alors `/confluence/` vers votre instance (même origine, aucune configuration côté Confluence, en-têtes `Origin` et cookies retirés, rien n'est journalisé).

```bash
docker run -d -p 8080:80 -e CONFLUENCE_URL=https://confluence.mon-entreprise.fr ghcr.io/josskrystlik-blip/voxai:latest
```

Sans proxy (GitHub Pages), l'administrateur Confluence doit autoriser l'origine de VoxAI en CORS.

## 🗂️ Séries de réunions (réunions récurrentes)

Pour une réunion récurrente (« Point projet Alpha — hebdo ») enregistrée par une personne désignée :

1. **🗂️ Séries → Nouvelle série** : nom, type (point d'équipe hebdo, comité de pilotage), participants (noms et adresses e-mail) et page Confluence de la série, choisie dans l'arborescence.
2. Choisir la série sur l'écran d'enregistrement (ou à l'import) : le titre devient « <série> — <date> », les noms des participants aident l'IA à nommer les orateurs, et un nom corrigé une fois (« Marco » → « Bob ») est reconnu aux réunions suivantes.
3. Après la réunion, un clic sur **🚀 Publier et envoyer** : publication préremplie sous la page Confluence de la série (avec son étiquette), puis e-mail aux participants avec le lien de la page (Outlook, Outlook Web, Gmail ou messagerie par défaut, destinataires préremplis). Les boutons **📘 Confluence** et **✉️ Envoyer aux participants** restent disponibles séparément.

La liste des enregistrements se filtre par série ; un enregistrement se rattache ou se détache depuis sa page. Les séries sont incluses dans la sauvegarde `.voxai`. Supprimer une série conserve ses enregistrements.

### 📌 Suivi des actions d'une réunion à l'autre

- **À l'analyse** d'une réunion d'une série, l'IA reçoit les actions encore ouvertes des réunions précédentes et indique celles dont il a été question (**terminée** ou **en cours**, avec ce qui en a été dit et un lien vers le passage de la transcription). Le bloc **🔁 Suivi des actions précédentes** de la synthèse les affiche : rien n'est clôturé sans votre clic sur **Clôturer**. Ce suivi figure aussi dans la page Confluence, l'e-mail aux participants et l'export.
- **Échéances datées** : l'IA convertit « vendredi » ou « fin du mois » en date, à partir de la date de la réunion. Une action dont l'échéance est dépassée porte le badge **⏰ En retard**, dans la synthèse, la fenêtre de suivi et le brief.
- **📌 Suivi** (barre latérale) : toutes les **actions ouvertes** de la série, regroupées par réunion, à cocher directement, avec leur dernier point d'avancement.
- **Brief de la prochaine réunion** : rappel de la dernière réunion (résumé, décisions) et actions ouvertes par responsable, à **copier** ou à **envoyer aux participants**. Il est construit localement, sans IA.

## 💬 Assistant IA global et correction des synthèses

- Bouton **💬 Assistant** dans l'en-tête, disponible partout : l'assistant connaît **toutes vos réunions** (titres, dates, synthèses, actions) et la transcription complète de celle qui est ouverte. Questions transversales (« quelles actions sont encore à faire ? »), e-mails, comparaisons entre réunions.
- **Corriger une synthèse** depuis l'assistant global ou l'onglet « Assistant IA » d'un enregistrement : décrivez l'erreur, l'IA propose une synthèse corrigée et VoxAI affiche **la liste exacte des changements**. Rien n'est modifié sans **Appliquer** ; **Annuler** rétablit la version précédente (10 versions conservées). Les actions cochées et les liens vers la transcription sont préservés.

## 🎨 Apparence, recherche et sauvegarde

- **Thème clair / sombre** : bouton dans l'en-tête, qui alterne entre **Auto** (suit le réglage clair ou sombre du système), **Clair** et **Sombre**. Le choix est mémorisé dans le navigateur.
- **Recherche dans la transcription** : sans tenir compte des accents ni des majuscules, avec surlignage et nombre d'occurrences ; le nom d'un orateur fonctionne aussi.
- **Télécharger l'audio** : bouton ⬇️ dans le lecteur, pour récupérer l'enregistrement (ou la piste en cours pour une session à plusieurs fichiers).
- **Plan d'action** : les actions cochées sont enregistrées et reprises dans les copies et dans Confluence (tâches terminées).
- **💾 Sauvegarde** (⚙️ Paramètres) : les données vivent dans le navigateur. Un rappel s'affiche dans la barre latérale après 7 jours sans sauvegarde (« Plus tard » le repousse de 3 jours). **Exporter mes données** crée un fichier `.voxai` (audios, transcriptions, comptes rendus, discussions) ; **Restaurer une sauvegarde** le réimporte ici ou sur un autre poste (les enregistrements déjà présents sont ignorés).

## 🎙️ Transcription en direct & e-mail de compte rendu

- **Transcription en direct** (interrupteur sous le bouton d'enregistrement) : le texte s'affiche pendant que vous parlez, via la reconnaissance vocale du navigateur (Chrome / Edge). ⚠️ L'audio est alors aussi envoyé à Google ou Microsoft ; la fonction est désactivée par défaut. Ce brouillon est conservé avec l'enregistrement ; l'analyse IA reste la transcription de référence.
- **Assistant IA** : boutons de copie sous chaque réponse ; pour un e-mail, **Créer le mail** dans Outlook (brouillon `.eml` prêt à envoyer), Outlook Web, Gmail ou la messagerie par défaut.

## 🔒 Sécurité

Mesures en place, tests de sécurité automatisés (`npm run test:security`, `bash tests/security/docker.sh`) et risques résiduels : voir [SECURITE.md](SECURITE.md).

Tests de bout en bout (`tests/e2e/`, lancés par la CI à chaque modification) : `npm run test:e2e`, ou `node tests/e2e/run.js series` pour un seul fichier. Ils pilotent l'application dans Chromium comme un utilisateur, avec un micro simulé et des serveurs simulés (Gemini, LLM et Whisper de l'entreprise, Confluence), sans accès Internet :

| Fichier | Parcours couverts |
| :--- | :--- |
| `dictaphone` | Micro (pause, reprise, annulation, refus), import de plusieurs pistes, synthèse et transcription (orateurs, recherche, actions), copies et exports, téléchargement de l'audio, sauvegarde / restauration |
| `pistes` | Sessions à plusieurs pistes : chaque piste transcrite séparément (Gemini ou Whisper avec horodatages), synthèse sur la transcription complète, synthèse par parties d'une longue réunion avec le LLM de l'entreprise, piste vide signalée |
| `sur-site` | Assistant de démarrage, réglages de l'administrateur (« sans cloud »), paramètres (détection des modèles, test, enregistrement), mode Hybride, serveurs en panne |
| `series` | Séries (saisie, rattachement, filtre, modification, suppression), suivi des actions d'une réunion à l'autre, brief, échéances, e-mail aux participants |
| `assistant` | Assistant d'un enregistrement et assistant global, e-mails rédigés par l'IA, corrections de synthèse (appliquer, annuler, ignorer), transcription en direct |
| `hors-ligne` | Application installable, ouverture et dictaphone sans réseau, analyses en attente, mise à jour sans rechargement forcé |
| `confluence` | Création et mise à jour de pages, pièces jointes, erreurs, Confluence Cloud et Data Center sur site (port, chemin /confluence, base MySQL utf8, identifiant + mot de passe), relais du conteneur, navigation, « Publier et envoyer » |

## 📁 Structure du Projet

```text
VoXAI/
├── index.html   # Interface utilisateur du Dictaphone
├── app.js       # Web Audio API, waveform, lecteur audio et logique réactive
├── db.js        # « Backend » local : base IndexedDB + appels IA (Gemini / LLM local)
├── confluence.js # Publication des comptes rendus dans Confluence (PAT)
├── live.js      # Transcription en direct (reconnaissance vocale du navigateur)
├── series.js    # Séries de réunions (participants, Confluence, e-mail, suivi des actions, brief)
├── onboarding.js # Assistant de démarrage (IA, Confluence, première série, bilan de confidentialité)
├── style.css    # Styles et animations
├── vendor/      # Styles Tailwind et polices générés (npm run build) : aucun CDN
├── start.sh     # Serveur statique pour un usage local
├── Dockerfile   # Image Docker (nginx) + docker/ (config, proxy Confluence)
├── docker-compose.yml
├── .github/workflows/release.yml  # Release + image ghcr.io sur tag vX.Y.Z
└── .nojekyll    # Publication telle quelle sur GitHub Pages
```

## 🛠️ API interne (servie par `db.js` dans le navigateur)

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/config` | Récupère la configuration actuelle |
| `GET` | `/api/local-models?url=` | Détecte les modèles d'un serveur LLM local |
| `POST` | `/api/recordings/create` | Crée une session multi-fichiers |
| `POST` | `/api/recordings/<id>/files` | Ajoute un fichier audio à une session |
| `POST` | `/api/config` | Met à jour les clés API et paramètres |
| `POST` | `/api/test-connection` | Valide la connexion au LLM (Gemini ou On-Prem) |
| `GET` | `/api/recordings` | Liste tous les enregistrements |
| `POST` | `/api/recordings/upload` | Téléverse un nouvel enregistrement audio |
| `GET` | `/api/recordings/<id>` | Détails d'un enregistrement (transcription, synthèse) |
| `POST` | `/api/recordings/<id>/process` | Déclenche l'analyse et la transcription IA |
| `POST` | `/api/recordings/<id>/chat` | Pose une question sur l'enregistrement à l'IA |
| `DELETE` | `/api/recordings/<id>` | Supprime l'audio et ses métadonnées |
