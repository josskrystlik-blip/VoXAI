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

4. **100 % local, aucun serveur** :
   - Application web statique : fonctionne directement depuis **GitHub Pages** (ou n'importe quel hébergement statique).
   - Toutes les données (audios, transcriptions, synthèses, chat, réglages et clé d'API) sont stockées dans une **base locale du navigateur (IndexedDB)**. Rien n'est sauvegardé dans le cloud.
   - Seule l'analyse IA sort de votre machine, et uniquement vers le fournisseur que vous choisissez (Gemini, ou votre LLM local en mode 100 % hors-ligne).

---

## 🚀 Démarrage

### Option A — GitHub Pages (recommandé)

1. Dans le dépôt GitHub : **Settings → Pages**.
2. **Source** : *Deploy from a branch*, branche `main`, dossier `/ (root)`, puis **Save**.
3. Après une minute, l'application est en ligne sur `https://<votre-compte>.github.io/VoXAI/`.

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

## 📁 Structure du Projet

```text
VoXAI/
├── index.html   # Interface utilisateur du Dictaphone
├── app.js       # Web Audio API, waveform, lecteur audio et logique réactive
├── db.js        # « Backend » local : base IndexedDB + appels IA (Gemini / LLM local)
├── style.css    # Styles et animations
├── start.sh     # Serveur statique pour un usage local
├── Dockerfile   # Image Docker (nginx) + docker/nginx.conf
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
