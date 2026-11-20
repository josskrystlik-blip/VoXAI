# Sécurité de VoxAI

## Modèle de menace

VoxAI est une application web **sans serveur applicatif** : toutes les données (audios, transcriptions, synthèses, discussions) et les secrets (clé Gemini, clé du LLM, jeton Confluence) sont stockés **dans le navigateur** (IndexedDB). L'image Docker ne fait que servir les fichiers et, en option, relayer Confluence.

La menace principale est donc l'**exécution de code dans la page (XSS)** : elle donnerait accès aux enregistrements et aux secrets. Les données externes qui entrent dans la page sont :

- les réponses de l'IA (analyse, discussions, propositions de correction), y compris un contenu influencé par l'audio lui-même ;
- les fichiers de sauvegarde `.voxai`, qui peuvent circuler entre collègues ;
- les réponses de Confluence (espaces, titres, liens) ;
- la configuration de l'image Docker (variables d'environnement).

## Mesures en place

| Mesure | Détail |
| :--- | :--- |
| Échappement systématique | Toute donnée insérée dans la page passe par `escapeHtml` (qui accepte aussi les valeurs non textuelles sans planter). |
| Validation à l'entrée | Réponses de l'IA, sauvegardes importées et corrections de synthèse sont ramenées aux types et formats attendus (horodatages, numéros de piste, identifiants, rôles de discussion, types MIME, références). |
| CSP | `script-src 'self'` : aucun script en ligne, aucun `eval`, aucun script externe. `object-src 'none'`, `base-uri 'none'`. Déclarée dans la page (GitHub Pages) et en en-tête (Docker). |
| Anti-iframe | `frame-ancestors 'none'` et `X-Frame-Options: DENY` (Docker). |
| Liens | Seuls les liens `http(s)` venant de Confluence sont proposés ; `rel="noopener"` sur les liens externes. |
| Confluence | Contenu de page échappé (pas d'injection XML / macro) ; le proxy retire cookies, `Origin` et `Referer`, ne renvoie pas les cookies de Confluence et ne relaie que l'instance configurée. |
| E-mails `.eml` | Objet encodé (pas d'injection d'en-tête). |
| Configuration Docker | `CONFLUENCE_URL` et `VOXAI_CSP_CONNECT_SRC` validées strictement : une valeur piégée empêche le démarrage au lieu d'injecter de la configuration nginx. |
| Serveur | Version nginx masquée, pas de liste de répertoires, fichiers cachés et sources (Dockerfile, tests, package.json) non servis, aucun journal d'accès. |
| Secrets | Clé Gemini envoyée en en-tête (jamais dans l'URL) ; données locales (`config.json`, `dictaphone.db`) exclues du dépôt. |
| Politique « sans cloud » | `VOXAI_DISABLE_CLOUD=true` ne peut pas être contournée par un réglage enregistré. |

## Tests de sécurité

```bash
npm ci
npm run test:security          # contrôles statiques + navigateur (Playwright requis)
bash tests/security/docker.sh  # image Docker (Docker requis)
```

Ils tournent automatiquement sur chaque pull request, sur `main` et chaque lundi (workflow « Sécurité ») :

- **statique** (`tests/security/static.sh`) : fonctions dangereuses, CSP, scripts et gestionnaires en ligne, ressources externes, `rel=noopener`, secrets dans les fichiers suivis, `npm audit` ;
- **navigateur** (`tests/security/browser.test.js`) : sauvegarde `.voxai` piégée, réponses de l'IA piégées (analyse, assistant, correction de synthèse), renommage d'orateur, Confluence (titres, lien `javascript:`, injection XML), en-têtes d'e-mail, application de la CSP, politique « sans cloud », clé hors des URL, aucune ressource externe ;
- **docker** (`tests/security/docker.sh`) : en-têtes HTTP, fichiers non exposés, traversée de répertoires, configurations injectées refusées, JSON des réglages robuste, comportement du proxy ;
- **image** : vulnérabilités connues des paquets de l'image (Trivy) ; une vulnérabilité critique corrigeable bloque.

Ces tests ont été validés contre la version précédant les correctifs : ils y détectaient l'injection de HTML par une réponse d'IA, le lien `javascript:` proposé après publication Confluence, le plantage de l'import d'une sauvegarde piégée et l'absence de CSP.

## Risques résiduels connus

- **Secrets dans le navigateur** : inhérent à une application sans serveur. Toute personne ayant accès à la session du poste (ou une extension malveillante) peut les lire. Préférer des clés personnelles, révocables, aux droits limités.
- **`VOXAI_LLM_API_KEY`** est lisible par quiconque accède à la page (`/voxai-defaults.json`) : à réserver à un réseau interne.
- **`connect-src`** reste ouvert (`https:` `http:`) car les serveurs IA et Confluence sont configurables ; en entreprise, le restreindre avec `VOXAI_CSP_CONNECT_SRC`.
- **Mode Hybride et transcription en direct** envoient l'audio à Google / Microsoft ; `VOXAI_DISABLE_CLOUD=true` les interdit.
- **Historique Git** : une ancienne clé Gemini figure dans les premiers commits du dépôt. Elle doit être **révoquée** dans Google AI Studio (la supprimer de l'historique nécessite une réécriture de `main`).

## Signaler une vulnérabilité

Merci de ne pas ouvrir de ticket public : contactez directement le mainteneur du dépôt.
