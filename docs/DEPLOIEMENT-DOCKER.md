# VoxAI — Installation et déploiement Docker

Ce guide s'adresse à l'équipe qui installe VoxAI pour son entreprise. Il couvre le test rapide, le déploiement **100 % sur site** (aucune donnée vers un service cloud), le HTTPS, la vérification, les mises à jour et le dépannage.

---

## 1. Comment fonctionne VoxAI

```
 Navigateur de l'utilisateur                         Serveurs de l'entreprise
 ┌──────────────────────────────┐   audio         ┌──────────────────────────┐
 │ VoxAI (application web)      │ ──────────────▶ │ Whisper (transcription)  │
 │ • enregistrements, réglages, │   texte         ├──────────────────────────┤
 │   séries : base locale du    │ ──────────────▶ │ LLM, ex. gpt-oss-120b    │
 │   navigateur (IndexedDB)     │   compte rendu  ├──────────────────────────┤
 │                              │ ──────────────▶ │ Confluence (facultatif)  │
 └──────────────▲───────────────┘                 └──────────────────────────┘
                │ fichiers de l'application uniquement (HTML, JS, CSS)
 ┌──────────────┴───────────────┐
 │ Conteneur VoxAI (nginx)      │  ← aucune donnée stockée, aucun journal d'accès
 └──────────────────────────────┘
```

- **Le conteneur ne fait que servir l'application.** Il ne voit passer ni l'audio, ni les transcriptions, ni les comptes rendus (sauf si vous activez le relais Confluence, voir §6.3, qui transmet les requêtes sans les conserver).
- **Le navigateur appelle directement** le serveur Whisper, le LLM et Confluence. Ces serveurs doivent donc être joignables **depuis les postes des utilisateurs**, pas seulement depuis le conteneur.
- **Application installable et utilisable hors ligne (PWA)** : après une première visite, le navigateur garde l'application en cache. Le dictaphone enregistre sans réseau ; les analyses se lancent au retour du réseau (bandeau « Analyser maintenant »). À chaque nouvelle version de l'image, le cache est renouvelé automatiquement.
- **Les données restent dans le navigateur** de chaque utilisateur. Il n'y a rien à sauvegarder côté serveur ; chaque utilisateur exporte ses données en `.voxai` (un rappel s'affiche après 7 jours).

## 2. Prérequis

| Élément | Exigence |
| :--- | :--- |
| Hôte | Docker 24+ et Docker Compose v2. Le conteneur est léger (nginx statique, quelques dizaines de Mo de mémoire). |
| Nom et certificat | Un nom DNS (ex. `voxai.entreprise.fr`) et un certificat TLS. **Le HTTPS est obligatoire** : sans lui, les navigateurs refusent l'accès au micro et l'installation de l'application hors ligne (sauf sur `localhost`). |
| LLM | Serveur **compatible OpenAI** (`POST /v1/chat/completions`) : vLLM, LiteLLM, Ollama, LM Studio… Modèle recommandé : `gpt-oss-120b`. |
| Transcription | Serveur **Whisper compatible OpenAI** (`POST /v1/audio/transcriptions`) : speaches / faster-whisper-server, vLLM avec un modèle Whisper, LiteLLM devant un Whisper… |
| Confluence | Facultatif : Server / Data Center (jeton personnel PAT) ou Cloud (e-mail + jeton d'API). |
| Postes | Chrome, Edge ou Firefox récents. |

## 3. Obtenir l'image

**Avec accès au registre** (recommandé : fixez une version précise plutôt que `latest`) :

```bash
docker pull ghcr.io/josskrystlik-blip/voxai:1.11.0
```

**Sans accès Internet** : téléchargez `voxai-docker-<version>.zip` et `SHA256SUMS.txt` depuis la page [Releases](https://github.com/josskrystlik-blip/VoXAI/releases), transférez-les sur l'hôte, puis :

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```bash
unzip voxai-docker-1.11.0.zip && cd voxai-docker-1.11.0
```

```bash
docker load -i voxai-image-1.11.0-amd64.tar.gz
```

L'image hors ligne s'appelle alors `voxai:1.11.0` (amd64). L'image du registre existe en amd64 et arm64.

## 4. Test rapide (5 minutes)

```bash
docker run -d --name voxai -p 8080:80 ghcr.io/josskrystlik-blip/voxai:1.11.0
```

Ouvrez `http://localhost:8080` : l'**assistant de démarrage** guide la configuration de l'IA, de Confluence et d'une première série. Ce mode convient pour évaluer l'outil, pas pour la production (pas de HTTPS, réglages laissés à chaque utilisateur).

## 5. Déploiement 100 % sur site (recommandé)

Objectif : **aucune donnée ne quitte l'entreprise**, et les utilisateurs n'ont rien à configurer.

### 5.1 `docker-compose.yml`

```yaml
services:
  voxai:
    image: ghcr.io/josskrystlik-blip/voxai:1.11.0
    container_name: voxai
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:80"        # exposé au seul reverse proxy HTTPS (§6)
    environment:
      # Politique imposée : Gemini, mode Hybride, transcription du navigateur et Gmail désactivés
      VOXAI_DISABLE_CLOUD: "true"
      # Serveurs de l'entreprise, préremplis pour tous les utilisateurs
      VOXAI_PROVIDER: "local"
      VOXAI_LLM_URL: "https://ia.entreprise.fr/v1"
      VOXAI_LLM_MODEL: "gpt-oss-120b"
      VOXAI_STT_MODE: "local"
      VOXAI_STT_URL: "https://whisper.entreprise.fr/v1"
      VOXAI_STT_MODEL: "whisper-large-v3"
      VOXAI_LANGUAGE: "fr"
      # Confluence relayé par le conteneur : aucune configuration CORS côté Confluence
      CONFLUENCE_URL: "https://confluence.entreprise.fr"
```

```bash
docker compose up -d
```

```bash
docker compose logs voxai
```

Au démarrage, les journaux confirment la configuration, par exemple :

```
VoxAI : mode 100 % interne, connexions limitées à : 'self' https://ia.entreprise.fr https://whisper.entreprise.fr
VoxAI : réglages par défaut générés (cloud désactivé : true)
VoxAI : proxy Confluence actif vers https://confluence.entreprise.fr
```

### 5.2 Ce que garantit `VOXAI_DISABLE_CLOUD=true`

| Niveau | Effet |
| :--- | :--- |
| Réglages | Moteur forcé sur le LLM interne, transcription forcée sur Whisper, clé Gemini effacée, **quel que soit ce que l'utilisateur a enregistré**. |
| Interface | Gemini, le mode Hybride, la transcription en direct du navigateur (qui enverrait l'audio à Google ou Microsoft) et l'option Gmail sont masqués. L'assistant de démarrage et les paramètres affichent « Mode 100 % interne imposé par votre administrateur ». |
| Navigateur | La politique de sécurité (CSP `connect-src`) n'autorise que l'application et les serveurs déclarés dans `VOXAI_LLM_URL`, `VOXAI_STT_URL` et `VOXAI_CONFLUENCE_URL`. **Même un réglage erroné ne peut pas joindre Google** : le navigateur bloque la requête. |

> Sans `VOXAI_LLM_URL`, la restriction réseau n'est pas appliquée (un avertissement apparaît dans les journaux) : définissez alors `VOXAI_CSP_CONNECT_SRC` vous-même.

Même sans politique imposée, VoxAI est **100 % sur site par défaut** dès que le LLM de l'entreprise est choisi : la transcription passe par Whisper, et la transcription en direct du navigateur est coupée. Le mode Hybride (audio vers Google) ne s'active que sur choix explicite, signalé ⚠️.

### 5.3 Variables d'environnement

| Variable | Rôle | Exemple |
| :--- | :--- | :--- |
| `VOXAI_DISABLE_CLOUD` | `true` : impose le mode 100 % interne (voir §5.2) | `true` |
| `VOXAI_PROVIDER` | Moteur par défaut : `local` ou `gemini` | `local` |
| `VOXAI_LLM_URL` | URL du LLM compatible OpenAI (avec `/v1`) | `https://ia.entreprise.fr/v1` |
| `VOXAI_LLM_MODEL` | Modèle | `gpt-oss-120b` |
| `VOXAI_LLM_API_KEY` | Clé partagée du LLM (⚠️ voir ci-dessous) | |
| `VOXAI_STT_MODE` | `local` (Whisper, par défaut) ou `cloud` (Hybride) | `local` |
| `VOXAI_STT_URL` | URL du serveur Whisper (avec `/v1`) | `https://whisper.entreprise.fr/v1` |
| `VOXAI_STT_MODEL` | Modèle Whisper | `whisper-large-v3` |
| `VOXAI_STT_API_KEY` | Clé du serveur Whisper (sinon celle du LLM, uniquement si c'est le même serveur) | |
| `VOXAI_LANGUAGE` | Langue des réunions | `fr` |
| `VOXAI_CONFLUENCE_URL` | URL Confluence préremplie, appelée directement par le navigateur (CORS requis) | `https://confluence.entreprise.fr` |
| `CONFLUENCE_URL` | Active le **relais** `/confluence/` vers cette instance (pas de CORS, voir §6.3) | `https://confluence.entreprise.fr` |
| `VOXAI_CSP_CONNECT_SRC` | Serveurs joignables par le navigateur ; remplace le calcul automatique | `'self' https://ia.entreprise.fr` |

- Ces valeurs sont des **réglages par défaut** : un utilisateur peut les modifier (sauf la politique), et seul ce qu'il change est enregistré. Si vous faites évoluer une URL ou un modèle, tous les autres utilisateurs en profitent au prochain chargement.
- ⚠️ **Les clés `VOXAI_*_API_KEY` sont lisibles** par toute personne qui peut ouvrir la page (`/voxai-defaults.json`). Utilisez une clé dédiée, limitée au réseau interne, ou laissez chaque utilisateur saisir sa clé personnelle.
- Le conteneur **refuse de démarrer** si `CONFLUENCE_URL` ou `VOXAI_CSP_CONNECT_SRC` contient des caractères non autorisés (protection contre l'injection de configuration) : consultez alors `docker compose logs voxai`.

## 6. HTTPS, reverse proxy et CORS

### 6.1 Reverse proxy HTTPS (exemple nginx)

```nginx
server {
    listen 443 ssl;
    server_name voxai.entreprise.fr;
    ssl_certificate     /etc/ssl/voxai.crt;
    ssl_certificate_key /etc/ssl/voxai.key;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

Les en-têtes de sécurité du conteneur (CSP, anti-iframe, etc.) sont transmis tels quels. **VoxAI n'a pas d'authentification propre** : pour restreindre l'accès aux salariés, placez l'authentification de l'entreprise (SSO) sur ce reverse proxy.

### 6.2 CORS : le plus simple est la même origine

Le navigateur appelle le LLM et Whisper **depuis la page VoxAI** : ces serveurs doivent donc autoriser l'origine `https://voxai.entreprise.fr` en CORS. Le plus simple est de les servir **sous le même nom**, via le reverse proxy, ce qui supprime tout besoin de CORS :

```nginx
    # Dans le même bloc server que ci-dessus
    location /ia/ {
        proxy_pass https://llm-interne.entreprise.fr/;
        proxy_read_timeout 600s;        # une synthèse longue peut prendre plusieurs minutes
    }
    location /stt/ {
        proxy_pass https://whisper-interne.entreprise.fr/;
        client_max_body_size 300m;      # fichiers audio d'une réunion complète
        proxy_read_timeout 600s;
    }
```

Puis : `VOXAI_LLM_URL=https://voxai.entreprise.fr/ia/v1` et `VOXAI_STT_URL=https://voxai.entreprise.fr/stt/v1`.

Si les serveurs restent sur un autre nom, autorisez l'origine de VoxAI dans leur configuration CORS. Exemples : Ollama `OLLAMA_ORIGINS=https://voxai.entreprise.fr` ; vLLM, option `--allowed-origins`. Pour les autres, reportez-vous à la documentation du serveur.

### 6.3 Confluence

- **Relais (recommandé)** : `CONFLUENCE_URL=https://confluence.entreprise.fr`. Le conteneur relaie `/confluence/` vers votre instance : même origine, aucune configuration côté Confluence. Les cookies et les en-têtes `Origin` et `Referer` du navigateur sont retirés, et rien n'est journalisé. Le conteneur doit alors pouvoir joindre Confluence.
- **Accès direct** : `VOXAI_CONFLUENCE_URL=…`. Le navigateur appelle Confluence directement, ce qui demande d'autoriser l'origine de VoxAI en CORS côté Confluence.

Chaque utilisateur saisit son **jeton personnel** (PAT) dans l'assistant de démarrage ou dans ⚙️ Paramètres : les publications se font sous son identité.

#### Confluence Data Center (sur site)

| Point | Ce qu'il faut savoir |
| :--- | :--- |
| Adresse | Indiquez l'adresse complète, **avec le port et le chemin de contexte** s'il y en a : `CONFLUENCE_URL=https://intranet.entreprise.fr:8090/confluence`. Le relais conserve le chemin et transmet le port dans l'en-tête `Host`. |
| Authentification | **Jeton d'accès personnel** (Data Center 7.9 et plus : *Profil → Jetons d'accès personnels*). Sans jeton (versions plus anciennes), choisissez *Identifiant + mot de passe* : l'identifiant Confluence, pas l'e-mail. Si l'authentification par mot de passe est désactivée sur votre instance (SSO), seul le jeton fonctionne. |
| Certificat interne | Avec le relais, le conteneur joint Confluence sans vérifier le certificat (autorités internes acceptées). En accès direct, le certificat doit être reconnu par les postes. |
| Base MySQL en `utf8` | Ces bases refusent les emojis (caractères sur 4 octets) : VoxAI n'en envoie aucun (titre, contenu, étiquettes), les icônes utilisent les émoticônes de Confluence. |
| Pièces jointes | Les versions qui ne gèrent pas l'envoi par `PUT` sont prises en charge (repli automatique par `POST`, nouvelle version d'un fichier existant). Le relais accepte des fichiers jusqu'à 20 Mo. |
| Contrôle XSRF | VoxAI envoie `X-Atlassian-Token: no-check` ; le relais retire `Origin`, `Referer` et les cookies. |

## 7. Vérifier le déploiement

```bash
curl -s https://voxai.entreprise.fr/healthz
```

Réponse attendue : `ok`.

```bash
curl -sI https://voxai.entreprise.fr/ | grep -i content-security-policy
```

En mode 100 % interne, `connect-src` ne doit lister que `'self'` et vos serveurs, sans `https:` ni `http:` génériques.

```bash
curl -s https://voxai.entreprise.fr/voxai-defaults.json
```

Doit contenir vos URL et `"disable_cloud":true`.

Puis, dans un navigateur :

1. Ouvrez VoxAI : l'assistant de démarrage indique « Mode 100 % interne imposé par votre administrateur », avec les serveurs préremplis.
2. Cliquez sur **🔌 Tester** : le message attendu est « LLM … joignable ; Whisper … joignable. Tout reste sur vos serveurs. »
3. La dernière étape, comme ⚙️ Paramètres, affiche le bilan **🛡️ Où partent vos données**, qui doit conclure par « ✅ 100 % sur site : rien ne quitte l'entreprise ».
4. Enregistrez quelques secondes, puis vérifiez dans les outils de développement (onglet Réseau) qu'aucune requête ne part vers `googleapis.com`.

## 8. Mises à jour et retour arrière

```bash
docker compose pull && docker compose up -d
```

- Changez la version dans `image:` pour mettre à jour, ou pour revenir à une version précédente. Les notes de version sont visibles dans l'application (lien **Nouveautés**, en bas de la barre latérale) et sur la page Releases.
- **Les données des utilisateurs ne sont pas dans le conteneur** : une mise à jour ou une recréation du conteneur ne les touche pas.
- ⚠️ **Ne changez pas l'adresse de VoxAI** (nom DNS, port, http/https) : les navigateurs rangent les données par adresse. Après un changement d'adresse, les utilisateurs ne retrouveraient pas leurs réunions ; ils devraient exporter un `.voxai` depuis l'ancienne adresse puis le restaurer sur la nouvelle.

## 9. Sécurité

- Aucune donnée ni aucun journal d'accès côté serveur (`access_log off`), version de nginx masquée, fichiers cachés jamais servis, pas de liste de répertoires.
- En-têtes : CSP stricte (`script-src 'self'`, sans `eval` ni script en ligne), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (micro et capture du son d'une visio autorisés pour la seule application ; caméra, position, paiement et USB refusés), `Cross-Origin-Opener-Policy`.
- Image reconstruite à chaque version avec les correctifs Alpine (`apk upgrade`) et analysée par Trivy en CI (bloquant sur les vulnérabilités critiques corrigeables). La suite `tests/security/docker.sh` vérifie ces protections, dont la restriction réseau du mode 100 % interne.
- Points à traiter de votre côté : HTTPS et authentification sur le reverse proxy (§6.1), clés partagées (§5.3), filtrage réseau des postes si vous souhaitez une seconde barrière en plus de la CSP.

## 10. Dépannage

| Symptôme | Cause probable | Solution |
| :--- | :--- | :--- |
| Le micro ne s'active pas | Page servie en HTTP | Passer en HTTPS (§6.1). |
| Visio enregistrée sans les participants à distance | Mode « Micro seul », ou son non partagé | Choisir « Micro + son de la visio » dans Chrome ou Edge, puis l'onglet de la réunion (ou l'écran entier) avec « Partager l'audio ». |
| « Impossible de joindre le modèle local… CORS » | Le LLM refuse l'origine de VoxAI | Servir le LLM sous le même nom (§6.2) ou autoriser l'origine en CORS. |
| Console : « Refused to connect … Content Security Policy » | Serveur absent de la liste autorisée | Ajouter son origine via `VOXAI_LLM_URL` / `VOXAI_STT_URL`, ou définir `VOXAI_CSP_CONNECT_SRC`. |
| Test : « le serveur Whisper ne répond pas » | URL sans `/v1`, mauvais modèle, CORS | Vérifier `VOXAI_STT_URL` (ex. `…/v1`) et `VOXAI_STT_MODEL`. |
| L'analyse échoue au bout de quelques minutes | Délai du reverse proxy trop court | `proxy_read_timeout 600s` (§6.2). |
| Confluence : 403 / erreur XSRF | Appels directs refusés par Confluence | Utiliser le relais `CONFLUENCE_URL` (§6.3). |
| Le conteneur s'arrête au démarrage | Variable refusée (`CONFLUENCE_URL`, `VOXAI_CSP_CONNECT_SRC`) | Lire `docker compose logs voxai` et corriger la valeur. |
| L'ancienne version reste affichée après une mise à jour | Application en cache (PWA) | Elle se met à jour en arrière-plan : un message invite à recharger la page. Sinon, fermer puis rouvrir l'onglet. |
| Un utilisateur ne retrouve plus ses réunions | Adresse de VoxAI changée, ou données du navigateur effacées | Restaurer sa dernière sauvegarde `.voxai` (⚙️ Paramètres). |
