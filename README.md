# 🎙️ VoxAI - Dictaphone Intelligent & Assistant de Conversation

Service moderne de prise d'enregistrement vocal et de dictaphone, boosté par l'Intelligence Artificielle avec architecture hybride **Cloud (Google Gemini)** et **On-Premise (100% Souverain & Privé)**.

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

4. **Zéro Dépendance Externe Lourde** :
   - Fonctionne avec Python 3 standard (aucun `npm install` ni compilation requise).
   - Base de données locale intégrée **SQLite** (`dictaphone.db`).
   - Interface Web responsive adaptée pour ordinateur et mobile.

---

## 🚀 Démarrage Rapide

### 1. Lancer le service

Dans votre terminal, exécutez simplement :

```bash
./start.sh
# ou directement :
python3 app.py
```

L'application est immédiatement accessible dans votre navigateur à l'adresse :
👉 **[http://localhost:8080](http://localhost:8080)**

---

## 🔑 Tester avec votre clé d'API Gemini

1. Ouvrez l'application sur **[http://localhost:8080](http://localhost:8080)**.
2. Cliquez sur l'icône **⚙️ (Paramètres)** en haut à droite.
3. Sous l'onglet **Cloud (Gemini)** :
   - Collez votre clé d'API Gemini *(si vous n'en avez pas encore, vous pouvez en générer une gratuitement sur [Google AI Studio](https://aistudio.google.com/apikey))*.
   - Laissez le modèle sur `gemini-3.8-flash` (recommandé pour sa rapidité et sa précision audio).
4. Cliquez sur **🔌 Tester la connexion** : vous verrez immédiatement le message de confirmation en vert.
5. Cliquez sur **Enregistrer la configuration**.

Vous pouvez désormais enregistrer votre voix ou importer un fichier audio pour obtenir immédiatement la transcription et la synthèse !

---

## 🏢 Comment connecter un moteur On-Premise (plus tard)

Pour basculer en mode 100% souverain sans envoyer de données sur le cloud :

1. Installez et lancez **Ollama** sur votre machine :
   ```bash
   ollama run llama3.2
   ```
2. Lancez un serveur Whisper local (compatible API OpenAI) :
   ```bash
   # Exemple avec Docker et faster-whisper-server :
   docker run -d -p 8000:8000 --gpus all fedirz/faster-whisper-server:latest-cuda
   ```
3. Dans les réglages de VoxAI (**⚙️**), sélectionnez l'onglet **🔒 On-Premise (Local)** :
   - **URL LLM** : `http://localhost:11434/v1`
   - **Modèle LLM** : `llama3.2` (ou `mistral`, `qwen2.5`)
   - **URL Whisper** : `http://localhost:8000/v1`
4. Testez la connexion et enregistrez.

---

## 📁 Structure du Projet

```text
VoXAI/
├── app.py               # Serveur backend (API REST, SQLite, client Gemini & On-Prem)
├── start.sh             # Script de lancement en un clic
├── config.example.json  # Modèle de configuration (copié en config.json au 1er lancement)
├── config.json          # Configuration locale (clés d'API) — non versionnée
├── dictaphone.db        # Base SQLite locale (créée automatiquement) — non versionnée
├── static/
│   ├── index.html       # Interface utilisateur du Dictaphone
│   ├── app.js           # Web Audio API, waveform, lecteur audio et logique réactive
│   └── style.css        # Styles et animations
└── recordings/          # Fichiers audio (créé automatiquement) — non versionné
```

> 🔐 `config.json`, `dictaphone.db` et `recordings/` sont exclus du dépôt via `.gitignore` : ne commitez jamais vos clés d'API.

---

## 🛠️ API REST Disponible

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/config` | Récupère la configuration actuelle |
| `POST` | `/api/config` | Met à jour les clés API et paramètres |
| `POST` | `/api/test-connection` | Valide la connexion au LLM (Gemini ou On-Prem) |
| `GET` | `/api/recordings` | Liste tous les enregistrements |
| `POST` | `/api/recordings/upload` | Téléverse un nouvel enregistrement audio |
| `GET` | `/api/recordings/<id>` | Détails d'un enregistrement (transcription, synthèse) |
| `POST` | `/api/recordings/<id>/process` | Déclenche l'analyse et la transcription IA |
| `POST` | `/api/recordings/<id>/chat` | Pose une question sur l'enregistrement à l'IA |
| `DELETE` | `/api/recordings/<id>` | Supprime l'audio et ses métadonnées |
| `GET` | `/audio/<filename>` | Flux de lecture audio pour le lecteur intégré |
