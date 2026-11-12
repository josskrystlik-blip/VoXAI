#!/usr/bin/env python3
"""
VoxAI - Service de Dictaphone Intelligent (Cloud & On-Premise)
Serveur Python léger avec API REST, gestionnaire SQLite et adaptateurs IA.
"""

import os
import sys
import json
import uuid
import time
import ssl
import sqlite3
import mimetypes
import urllib.request
import urllib.parse
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RECORDINGS_DIR = os.path.join(BASE_DIR, "recordings")
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.path.join(BASE_DIR, "dictaphone.db")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

os.makedirs(RECORDINGS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

# Configuration par défaut
DEFAULT_CONFIG = {
    "provider": "gemini",  # "gemini" ou "local" (ou "on_prem")
    "gemini_api_key": os.environ.get("GEMINI_API_KEY", ""),
    "gemini_model": "gemini-3.5-flash-lite",
    "local_llm_type": "ollama",  # "ollama", "lm_studio", "vllm", "custom"
    "local_llm_url": "http://localhost:11434/v1",
    "local_llm_model": "llama3.2",
    "local_stt_mode": "cloud",  # "cloud" (Cloud STT + Local LLM) ou "local" (Whisper Local)
    "on_prem_llm_url": "http://localhost:11434/v1",
    "on_prem_llm_model": "llama3.2",
    "on_prem_stt_url": "http://localhost:8000/v1",
    "on_prem_stt_model": "whisper-1",
    "language_hint": "fr"
}

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                cfg = dict(DEFAULT_CONFIG)
                cfg.update(saved)
                return cfg
        except Exception as e:
            print(f"[Config] Erreur lecture config: {e}")
    return dict(DEFAULT_CONFIG)

def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        duration INTEGER DEFAULT 0,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        status TEXT DEFAULT 'recorded',
        transcription TEXT,
        summary TEXT,
        error_message TEXT
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS recording_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        duration INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE CASCADE
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE CASCADE
    );
    """)
    # Migration douce pour enregistrements existants sans entrée dans recording_files
    try:
        cur.execute("""
        INSERT INTO recording_files (recording_id, filename, original_name, mime_type, file_size, duration, sort_order, created_at)
        SELECT id, filename, title, mime_type, file_size, duration, 0, created_at
        FROM recordings
        WHERE filename IS NOT NULL AND filename != ''
        AND id NOT IN (SELECT DISTINCT recording_id FROM recording_files);
        """)
    except Exception as e:
        print(f"[DB] Migration recording_files info: {e}")

    conn.commit()
    conn.close()

def get_ssl_context():
    """Crée un contexte SSL utilisant les certificats de l'environnement si présents."""
    cert_file = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if cert_file and os.path.exists(cert_file):
        return ssl.create_default_context(cafile=cert_file)
    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()

# ==============================================================================
# Service IA : Google Gemini & On-Premise
# ==============================================================================

class AIService:
    @staticmethod
    def _clean_json_response(raw_text):
        """Nettoie et parse robustement la réponse JSON du modèle."""
        text = raw_text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        # Trouver les bornes du JSON si du texte parasite entoure la réponse
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            text = text[start:end+1]
            
        return json.loads(text)

    @staticmethod
    def _get_local_opener():
        """Opener sans proxy pour garantir l'accès aux services On-Prem locaux."""
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @staticmethod
    def detect_local_models(url="http://localhost:11434/v1", server_type="auto"):
        """
        Interroge le serveur local (Ollama, LM Studio, vLLM, llama.cpp, etc.)
        pour récupérer automatiquement la liste des modèles installés et disponibles.
        """
        clean_url = (url or "http://localhost:11434").strip().rstrip("/")
        base_root = clean_url[:-3] if clean_url.endswith("/v1") else clean_url
        v1_url = clean_url if clean_url.endswith("/v1") else f"{clean_url}/v1"

        opener = AIService._get_local_opener()
        models = []

        # 1. Tester endpoint natif Ollama (/api/tags)
        try:
            req = urllib.request.Request(f"{base_root}/api/tags", headers={"Accept": "application/json"})
            with opener.open(req, timeout=3) as response:
                data = json.loads(response.read().decode("utf-8"))
                for m in data.get("models", []):
                    name = m.get("name")
                    if name and name not in models:
                        models.append(name)
                if models:
                    return {"success": True, "models": sorted(models), "type": "ollama", "server_url": v1_url}
        except Exception:
            pass

        # 2. Tester standard OpenAI (/v1/models) pour LM Studio, vLLM, llama.cpp, Ollama
        for endpoint in [f"{v1_url}/models", f"{clean_url}/models"]:
            try:
                req = urllib.request.Request(endpoint, headers={"Accept": "application/json"})
                with opener.open(req, timeout=3) as response:
                    data = json.loads(response.read().decode("utf-8"))
                    for m in data.get("data", []):
                        mid = m.get("id")
                        if mid and mid not in models:
                            models.append(mid)
                    if models:
                        detected = "lm_studio" if "1234" in endpoint else ("ollama" if "11434" in endpoint else "vllm")
                        return {"success": True, "models": sorted(models), "type": detected, "server_url": v1_url}
            except Exception:
                pass

        return {
            "success": False,
            "error": f"Aucun serveur LLM détecté sur {url}. Vérifiez qu'Ollama (port 11434) ou LM Studio (port 1234) est bien actif.",
            "models": []
        }

    @staticmethod
    def test_connection(cfg):
        provider = cfg.get("provider", "gemini")
        if provider == "gemini":
            api_key = cfg.get("gemini_api_key", "").strip()
            if not api_key:
                return False, "La clé d'API Gemini n'est pas renseignée."
            model = cfg.get("gemini_model", "gemini-3.5-flash-lite")
            payload = {
                "contents": [{"parts": [{"text": "Réponds uniquement par: OK"}]}]
            }
            data = json.dumps(payload).encode("utf-8")
            ctx = get_ssl_context()

            # Modèles à tester (le modèle demandé en premier, puis les fallbacks rapides)
            models_to_test = [model]
            if model != "gemini-3.5-flash-lite":
                models_to_test.append("gemini-3.5-flash-lite")
            if "gemini-3.1-flash-lite" not in models_to_test:
                models_to_test.append("gemini-3.1-flash-lite")

            last_err_msg = ""
            for m in models_to_test:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
                req = urllib.request.Request(
                    url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                try:
                    with urllib.request.urlopen(req, context=ctx, timeout=12) as response:
                        res_body = json.loads(response.read().decode("utf-8"))
                        text = res_body["candidates"][0]["content"]["parts"][0]["text"]
                        note = ""
                        if m != model:
                            note = f" (Note: {model} étant temporairement saturé chez Google, bascule automatique sur {m})"
                        return True, f"Connexion Gemini réussie avec {m} ! Réponse: {text.strip()}{note}"
                except urllib.error.HTTPError as e:
                    err_msg = e.read().decode("utf-8")
                    try:
                        err_json = json.loads(err_msg)
                        last_err_msg = err_json.get("error", {}).get("message", err_msg)
                    except Exception:
                        last_err_msg = err_msg
                    if e.code in (503, 429, 404):
                        continue
                    return False, f"Erreur Gemini (HTTP {e.code}): {last_err_msg}"
                except Exception as e:
                    last_err_msg = str(e)
                    continue

            return False, f"Erreur Gemini: {last_err_msg}"

        elif provider in ("on_prem", "local"):
            llm_url = (cfg.get("local_llm_url") or cfg.get("on_prem_llm_url", "http://localhost:11434/v1")).strip().rstrip("/")
            model = cfg.get("local_llm_model") or cfg.get("on_prem_llm_model", "llama3.2")
            v1_url = llm_url if llm_url.endswith("/v1") else f"{llm_url}/v1"
            chat_url = f"{v1_url}/chat/completions"

            payload = {
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 10
            }
            opener = AIService._get_local_opener()
            t0 = time.time()
            try:
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    chat_url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with opener.open(req, timeout=12) as response:
                    latency_ms = int((time.time() - t0) * 1000)
                    return True, f"Connexion au LLM local réussie ({model}) en {latency_ms} ms !"
            except Exception as e:
                # Si l'URL de base était différente
                if llm_url != v1_url:
                    try:
                        req2 = urllib.request.Request(
                            f"{llm_url}/chat/completions",
                            data=data,
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with opener.open(req2, timeout=8) as response:
                            latency_ms = int((time.time() - t0) * 1000)
                            return True, f"Connexion au LLM local réussie ({model}) en {latency_ms} ms !"
                    except Exception:
                        pass
                return False, f"Impossible de joindre le modèle local '{model}' sur {llm_url} : {str(e)}. Vérifiez qu'Ollama ou LM Studio est bien démarré."

        return False, "Fournisseur d'IA inconnu."

    @staticmethod
    def process_recording(recording_id, audio_files, cfg):
        """
        Traite un ou plusieurs fichiers audio pour une même analyse.
        audio_files: list de dicts [{"path": str, "mime_type": str, "name": str, "duration": int}]
        """
        provider = cfg.get("provider", "gemini")
        if provider == "gemini":
            return AIService._process_with_gemini(audio_files, cfg)
        else:
            # Mode Local / On-Premise
            stt_mode = cfg.get("local_stt_mode", cfg.get("stt_mode", "cloud"))
            if stt_mode == "cloud":
                # Transcription rapide via Cloud STT Gemini, puis synthèse 100% privée sur le LLM Local
                transcription = AIService._transcribe_with_gemini(audio_files, cfg)
                return AIService._generate_summary_with_local_llm(transcription, audio_files, cfg)
            else:
                # Mode 100% Souverain / Hors-ligne (Whisper local)
                return AIService._process_with_onprem(audio_files, cfg)

    @staticmethod
    def _process_with_gemini(audio_files, cfg):
        import base64
        api_key = cfg.get("gemini_api_key", "").strip()
        if not api_key:
            raise ValueError("Clé API Gemini manquante. Veuillez la configurer dans les paramètres.")

        primary_model = cfg.get("gemini_model", "gemini-3.5-flash-lite")
        models_to_try = [primary_model]
        for fallback in ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"]:
            if fallback not in models_to_try:
                models_to_try.append(fallback)

        is_multi = len(audio_files) > 1

        if not is_multi:
            prompt = """Tu es l'analyste IA d'un dictaphone intelligent.
Analyse cet enregistrement audio de manière exhaustive.
Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide (sans backticks markdown, sans texte autour) respectant exactement cette structure:

{
  "title": "Titre concis et percutant de la conversation ou note",
  "language": "fr",
  "transcription": [
    {
      "file_index": 1,
      "speaker": "Orateur 1",
      "timestamp": "00:00",
      "text": "Texte fidèlement retranscrit..."
    }
  ],
  "summary": {
    "executive": "Résumé exécutif de la conversation en 3 à 5 phrases synthétiques.",
    "key_points": [
      "Point clé 1 abordé avec détails",
      "Point clé 2..."
    ],
    "decisions": [
      "Décision 1 validée pendant l'échange",
      "Décision 2..."
    ],
    "action_items": [
      {
        "task": "Action concrète à réaliser",
        "assignee": "Personne concernée ou Non assigné",
        "deadline": "Échéance ou À définir",
        "status": "todo"
      }
    ],
    "tags": ["Tag1", "Tag2", "Tag3"]
  }
}

Règles impératives :
1. La transcription doit être fidèle mot pour mot avec horodatages réels et séparation des interlocuteurs si plusieurs voix parlent.
2. S'il n'y a qu'un seul orateur (ex: mémo vocal / dictée), utilise "Moi" ou "Orateur".
3. Les décisions et actions doivent être claires, concrètes et opérationnelles.
4. Réponds UNIQUEMENT avec le JSON pur.
"""
            parts = [{"text": prompt}]
            af = audio_files[0]
            with open(af["path"], "rb") as f:
                audio_bytes = f.read()
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
            parts.append({
                "inline_data": {
                    "mime_type": af["mime_type"],
                    "data": audio_b64
                }
            })
        else:
            files_desc = ", ".join([f"'{af['name']}'" for af in audio_files])
            prompt = f"""Tu es l'analyste IA d'un dictaphone intelligent.
Tu as reçu {len(audio_files)} enregistrements audio ({files_desc}) appartenant à une MÊME session / réunion / discussion.
Analyse l'ensemble de ces enregistrements pour fournir :
1. Une transcription complète, chronologique et ordonnée de tous les enregistrements. Pour chaque prise de parole, indique impérativement :
   - 'file_index' : le numéro du fichier (1 pour le premier, 2 pour le deuxième, etc.)
   - 'file_name' : le nom du fichier audio correspondant
   - 'speaker' : l'interlocuteur
   - 'timestamp' : l'horodatage au sein de cet enregistrement (ex: 01:23)
   - 'text' : les propos tenus
2. Une synthèse globale et unifiée (résumé exécutif, points clés, décisions et plan d'action) qui consolide et synthétise TOUS les enregistrements sans omission.

Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide (sans backticks markdown, sans texte autour) respectant exactement cette structure:

{{
  "title": "Titre global représentatif de l'ensemble de la session",
  "language": "fr",
  "transcription": [
    {{
      "file_index": 1,
      "file_name": "{audio_files[0]['name']}",
      "speaker": "Orateur 1",
      "timestamp": "00:00",
      "text": "Texte fidèlement retranscrit..."
    }}
  ],
  "summary": {{
    "executive": "Résumé exécutif consolidé de l'ensemble des enregistrements en 3 à 5 phrases synthétiques.",
    "key_points": [
      "Point clé 1 abordé dans les enregistrements",
      "Point clé 2..."
    ],
    "decisions": [
      "Décision 1 validée pendant les échanges",
      "Décision 2..."
    ],
    "action_items": [
      {{
        "task": "Action concrète à réaliser",
        "assignee": "Personne concernée ou Non assigné",
        "deadline": "Échéance ou À définir",
        "status": "todo"
      }}
    ],
    "tags": ["Tag1", "Tag2", "Tag3"]
  }}
}}

Règles impératives :
1. La transcription doit couvrir chaque fichier audio successivement et fidèlement.
2. Le résumé, les décisions et le plan d'action doivent couvrir l'ensemble des {len(audio_files)} enregistrements de façon consolidée.
3. Réponds UNIQUEMENT avec le JSON pur.
"""
            parts = [{"text": prompt}]
            for idx, af in enumerate(audio_files, 1):
                with open(af["path"], "rb") as f:
                    audio_bytes = f.read()
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                parts.append({"text": f"=== ENREGISTREMENT {idx}/{len(audio_files)} : '{af['name']}' ==="})
                parts.append({
                    "inline_data": {
                        "mime_type": af["mime_type"],
                        "data": audio_b64
                    }
                })

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": 0.2,
                "response_mime_type": "application/json"
            }
        }

        data = json.dumps(payload).encode("utf-8")
        ctx = get_ssl_context()
        last_err = None

        for m in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=180) as response:
                    res_json = json.loads(response.read().decode("utf-8"))
                    candidate = res_json["candidates"][0]["content"]["parts"][0]["text"]
                    return AIService._clean_json_response(candidate)
            except urllib.error.HTTPError as e:
                err_text = e.read().decode("utf-8")
                last_err = f"Modèle {m} (HTTP {e.code}): {err_text}"
                if e.code in (503, 429, 404):
                    continue
                raise ValueError(last_err)
            except Exception as e:
                last_err = str(e)
                continue

        raise ValueError(f"Impossible de traiter les fichiers audio avec Gemini: {last_err}")

    @staticmethod
    def _transcribe_with_gemini(audio_files, cfg):
        """Transcription audio haute fidélité avec Gemini Cloud STT."""
        import base64
        api_key = cfg.get("gemini_api_key", "").strip()
        if not api_key:
            raise ValueError("Pour utiliser la transcription rapide Cloud avec votre LLM local, la clé d'API Gemini doit être configurée dans les paramètres (ou choisissez le mode 'Whisper Local' 100% hors-ligne).")

        primary_model = cfg.get("gemini_model", "gemini-3.5-flash-lite")
        models_to_try = [primary_model]
        for fallback in ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]:
            if fallback not in models_to_try:
                models_to_try.append(fallback)

        is_multi = len(audio_files) > 1
        if not is_multi:
            prompt = """Tu es un transcripteur audio professionnel de haute précision.
Transcris fidèlement mot à mot cet enregistrement audio.
Indique les orateurs distincts et les horodatages réels.
Réponds EXCLUSIVEMENT avec un JSON pur respectant cette structure exacte :
{
  "transcription": [
    {
      "file_index": 1,
      "speaker": "Orateur 1",
      "timestamp": "00:00",
      "text": "Texte fidèlement retranscrit..."
    }
  ]
}
"""
            parts = [{"text": prompt}]
            af = audio_files[0]
            with open(af["path"], "rb") as f:
                audio_bytes = f.read()
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
            parts.append({
                "inline_data": {
                    "mime_type": af["mime_type"],
                    "data": audio_b64
                }
            })
        else:
            files_desc = ", ".join([f"'{af['name']}'" for af in audio_files])
            prompt = f"""Tu es un transcripteur audio professionnel de haute précision.
Transcris fidèlement mot à mot ces {len(audio_files)} enregistrements audio ({files_desc}) d'une même session.
Pour chaque segment de parole, indique file_index, file_name, speaker, timestamp, et text.
Réponds EXCLUSIVEMENT avec un JSON pur :
{{
  "transcription": [
    {{
      "file_index": 1,
      "file_name": "{audio_files[0]['name']}",
      "speaker": "Orateur 1",
      "timestamp": "00:00",
      "text": "Texte fidèlement retranscrit..."
    }}
  ]
}}
"""
            parts = [{"text": prompt}]
            for idx, af in enumerate(audio_files, 1):
                with open(af["path"], "rb") as f:
                    audio_bytes = f.read()
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                parts.append({"text": f"=== PISTE {idx}/{len(audio_files)} : '{af['name']}' ==="})
                parts.append({
                    "inline_data": {
                        "mime_type": af["mime_type"],
                        "data": audio_b64
                    }
                })

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }
        data = json.dumps(payload).encode("utf-8")
        ctx = get_ssl_context()
        last_err = None

        for m in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=120) as response:
                    res_json = json.loads(response.read().decode("utf-8"))
                    candidate = res_json["candidates"][0]["content"]["parts"][0]["text"]
                    cleaned = AIService._clean_json_response(candidate)
                    return cleaned.get("transcription", [])
            except Exception as e:
                last_err = str(e)
                continue

        raise ValueError(f"Erreur transcription audio avec Gemini: {last_err}")

    @staticmethod
    def _generate_summary_with_local_llm(transcription, audio_files, cfg):
        """Génère la synthèse, décisions et plan d'action avec le LLM local à partir de la transcription."""
        llm_url = (cfg.get("local_llm_url") or cfg.get("on_prem_llm_url", "http://localhost:11434/v1")).strip().rstrip("/")
        v1_url = llm_url if llm_url.endswith("/v1") else f"{llm_url}/v1"
        chat_url = f"{v1_url}/chat/completions"
        llm_model = cfg.get("local_llm_model") or cfg.get("on_prem_llm_model", "llama3.2")

        # Formater la transcription pour le LLM local
        transcript_lines = []
        for item in transcription:
            f_idx = item.get("file_index", 1)
            speaker = item.get("speaker", "Orateur")
            ts = item.get("timestamp", "00:00")
            txt = item.get("text", "")
            prefix = f"[Piste {f_idx} • {ts}]" if len(audio_files) > 1 else f"[{ts}]"
            transcript_lines.append(f"{prefix} {speaker}: {txt}")

        full_transcript_str = "\n".join(transcript_lines)
        files_desc = ", ".join([f"'{af['name']}'" for af in audio_files])

        prompt = f"""Tu es l'analyste IA d'un dictaphone intelligent.
Voici la transcription complète de {len(audio_files)} enregistrement(s) ({files_desc}) :

\"\"\"{full_transcript_str}\"\"\"

Analyse attentivement cette transcription et génère une synthèse consolidée et structurée.
Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide (sans aucun commentaire, sans bloc markdown superflu) respectant exactement cette structure :

{{
  "title": "Titre clair et représentatif de la session ou du sujet principal",
  "language": "fr",
  "summary": {{
    "executive": "Résumé exécutif de l'échange ou de la note en 3 à 5 phrases synthétiques.",
    "key_points": [
      "Point clé 1 important abordé avec détails",
      "Point clé 2..."
    ],
    "decisions": [
      "Décision validée pendant la discussion"
    ],
    "action_items": [
      {{
        "task": "Action concrète à accomplir",
        "assignee": "Personne concernée ou Non assigné",
        "deadline": "Échéance ou À définir",
        "status": "todo"
      }}
    ],
    "tags": ["Tag1", "Tag2", "Tag3"]
  }}
}}
"""
        payload = {
            "model": llm_model,
            "messages": [
                {"role": "system", "content": "Tu es un analyste IA de réunions et notes vocales. Tu réponds UNIQUEMENT par un objet JSON pur et valide, sans markdown."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2
        }

        opener = AIService._get_local_opener()
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            chat_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with opener.open(req, timeout=180) as response:
                res_json = json.loads(response.read().decode("utf-8"))
                content = res_json["choices"][0]["message"]["content"]
                parsed = AIService._clean_json_response(content)
                parsed["transcription"] = transcription
                if "title" not in parsed or not parsed["title"]:
                    parsed["title"] = audio_files[0]["name"].rsplit(".", 1)[0]
                return parsed
        except Exception as e:
            print(f"[Local LLM Warning] Réponse non standard du LLM local : {e}")
            fallback_title = audio_files[0]["name"].rsplit(".", 1)[0] if audio_files else "Session analysée"
            return {
                "title": fallback_title,
                "language": "fr",
                "transcription": transcription,
                "summary": {
                    "executive": f"Analyse réalisée par le modèle local ({llm_model}). Consultez la transcription détaillée.",
                    "key_points": ["Transcription complète disponible dans l'onglet Transcription."],
                    "decisions": [],
                    "action_items": [],
                    "tags": ["LocalLLM", llm_model]
                }
            }

    @staticmethod
    def _process_with_onprem(audio_files, cfg):
        """Pipeline 100% On-Premise : Whisper Local (STT) + Ollama/LM Studio Local (LLM)."""
        stt_url = cfg.get("on_prem_stt_url", "http://localhost:8000/v1").rstrip("/")

        parsed_transcriptions = []
        for idx, af in enumerate(audio_files, 1):
            t_text = AIService._transcribe_onprem(af["path"], af["mime_type"], stt_url)
            parsed_transcriptions.append({
                "file_index": idx,
                "file_name": af["name"],
                "speaker": f"Orateur (Piste {idx})",
                "timestamp": "00:00",
                "text": t_text
            })

        return AIService._generate_summary_with_local_llm(parsed_transcriptions, audio_files, cfg)

    @staticmethod
    def _transcribe_onprem(audio_path, mime_type, stt_url):
        # Multipart upload vers /audio/transcriptions
        boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
        filename = os.path.basename(audio_path)
        with open(audio_path, "rb") as f:
            file_bytes = f.read()

        parts = []
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n".encode("utf-8"))
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime_type}\r\n\r\n".encode("utf-8"))
        parts.append(file_bytes)
        parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
        body = b"".join(parts)

        req = urllib.request.Request(
            f"{stt_url}/audio/transcriptions",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST"
        )
        opener = AIService._get_local_opener()
        with opener.open(req, timeout=90) as response:
            res = json.loads(response.read().decode("utf-8"))
            return res.get("text", "")

    @staticmethod
    def chat_with_recording(recording_id, user_message, transcript_str, summary_str, history, cfg):
        provider = cfg.get("provider", "gemini")
        system_context = f"""Tu es l'assistant personnel de ce dictaphone.
L'utilisateur te pose des questions à propos de cet enregistrement vocal.

=== TRANSCRIPTION DE L'ENREGISTREMENT ===
{transcript_str}

=== SYNTHÈSE DE L'ENREGISTREMENT ===
{summary_str}

Réponds de manière précise, concise et serviable en te basant sur ce qui a été dit. Si l'information ne figure pas dans l'enregistrement, mentionne-le poliment."""

        if provider == "gemini":
            api_key = cfg.get("gemini_api_key", "").strip()
            primary_model = cfg.get("gemini_model", "gemini-3.5-flash-lite")
            models_to_try = [primary_model]
            for fallback in ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"]:
                if fallback not in models_to_try:
                    models_to_try.append(fallback)

            contents = [
                {"role": "user", "parts": [{"text": system_context}]},
                {"role": "model", "parts": [{"text": "Compris, je réponds à toutes vos questions concernant cet enregistrement."}]}
            ]
            for h in history:
                role = "user" if h["role"] == "user" else "model"
                contents.append({"role": role, "parts": [{"text": h["content"]}]})
            contents.append({"role": "user", "parts": [{"text": user_message}]})

            payload = {"contents": contents}
            data = json.dumps(payload).encode("utf-8")
            ctx = get_ssl_context()
            last_err = None

            for m in models_to_try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
                req = urllib.request.Request(
                    url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                try:
                    with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
                        res_json = json.loads(response.read().decode("utf-8"))
                        return res_json["candidates"][0]["content"]["parts"][0]["text"]
                except urllib.error.HTTPError as e:
                    last_err = e.read().decode("utf-8")
                    if e.code in (503, 429, 404):
                        continue
                    raise ValueError(f"Erreur Gemini (HTTP {e.code}): {last_err}")
                except Exception as e:
                    last_err = str(e)
                    continue

            raise ValueError(f"Erreur chat Gemini: {last_err}")
        else:
            llm_url = (cfg.get("local_llm_url") or cfg.get("on_prem_llm_url", "http://localhost:11434/v1")).strip().rstrip("/")
            v1_url = llm_url if llm_url.endswith("/v1") else f"{llm_url}/v1"
            chat_url = f"{v1_url}/chat/completions"
            model = cfg.get("local_llm_model") or cfg.get("on_prem_llm_model", "llama3.2")

            messages = [{"role": "system", "content": system_context}]
            for h in history:
                messages.append({"role": h["role"], "content": h["content"]})
            messages.append({"role": "user", "content": user_message})

            payload = {"model": model, "messages": messages, "temperature": 0.3}
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                chat_url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            opener = AIService._get_local_opener()
            with opener.open(req, timeout=45) as response:
                res_json = json.loads(response.read().decode("utf-8"))
                return res_json["choices"][0]["message"]["content"]


# ==============================================================================
# Handler HTTP REST API & Fichiers statiques
# ==============================================================================

class DictaphoneHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API Routes
        if path == "/api/config":
            cfg = load_config()
            # On masque une partie de la clé pour sécurité
            safe_cfg = dict(cfg)
            if safe_cfg.get("gemini_api_key"):
                k = safe_cfg["gemini_api_key"]
                safe_cfg["gemini_api_key_masked"] = k[:4] + "..." + k[-4:] if len(k) > 8 else "***"
            self._send_json(200, safe_cfg)
            return

        elif path.startswith("/api/local-models"):
            query_params = urllib.parse.parse_qs(parsed.query)
            target_url = query_params.get("url", ["http://localhost:11434/v1"])[0]
            server_type = query_params.get("type", ["auto"])[0]
            result = AIService.detect_local_models(target_url, server_type)
            self._send_json(200, result)
            return

        elif path == "/api/recordings":
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("""
            SELECT r.id, r.title, r.created_at, r.duration, r.filename, r.mime_type, r.file_size, r.status,
                   COUNT(rf.id) AS file_count
            FROM recordings r
            LEFT JOIN recording_files rf ON r.id = rf.recording_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            """)
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            self._send_json(200, rows)
            return

        elif path.startswith("/api/recordings/"):
            rec_id = path.split("/")[3]
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,))
            rec = cur.fetchone()
            if not rec:
                conn.close()
                self._send_json(404, {"error": "Enregistrement non trouvé"})
                return

            rec_dict = dict(rec)
            if rec_dict["transcription"]:
                try: rec_dict["transcription"] = json.loads(rec_dict["transcription"])
                except Exception: pass
            if rec_dict["summary"]:
                try: rec_dict["summary"] = json.loads(rec_dict["summary"])
                except Exception: pass

            cur.execute("SELECT id, filename, original_name, mime_type, file_size, duration, sort_order FROM recording_files WHERE recording_id = ? ORDER BY sort_order ASC, id ASC", (rec_id,))
            rec_dict["files"] = [dict(f) for f in cur.fetchall()]
            if not rec_dict["files"] and rec_dict.get("filename"):
                rec_dict["files"] = [{
                    "id": 0,
                    "filename": rec_dict["filename"],
                    "original_name": rec_dict["title"],
                    "mime_type": rec_dict["mime_type"],
                    "file_size": rec_dict["file_size"],
                    "duration": rec_dict["duration"],
                    "sort_order": 0
                }]

            # Récupère l'historique de chat
            cur.execute("SELECT role, content, created_at FROM chat_messages WHERE recording_id = ? ORDER BY id ASC", (rec_id,))
            rec_dict["chat_history"] = [dict(r) for r in cur.fetchall()]
            conn.close()
            self._send_json(200, rec_dict)
            return

        elif path.startswith("/audio/"):
            filename = os.path.basename(path)
            file_path = os.path.join(RECORDINGS_DIR, filename)
            if not os.path.exists(file_path):
                self.send_error(404, "Fichier audio non trouvé")
                return
            mime, _ = mimetypes.guess_type(file_path)
            if not mime:
                mime = "audio/webm"
            file_size = os.path.getsize(file_path)

            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())
            return

        # Fichiers statiques
        if path == "/" or path == "":
            path = "/index.html"
        static_file = os.path.join(STATIC_DIR, path.lstrip("/"))
        if os.path.exists(static_file) and not os.path.isdir(static_file):
            mime, _ = mimetypes.guess_type(static_file)
            if not mime:
                mime = "text/plain"
            if mime.startswith("text/") or mime == "application/javascript":
                mime += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(os.path.getsize(static_file)))
            self.end_headers()
            with open(static_file, "rb") as f:
                self.wfile.write(f.read())
            return

        self.send_error(404, "Page non trouvée")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_length = int(self.headers.get("Content-Length", 0))
        content_type = self.headers.get("Content-Type", "")

        if path == "/api/config":
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)
            cfg = load_config()
            for k in [
                "provider", "gemini_api_key", "gemini_model",
                "local_llm_type", "local_llm_url", "local_llm_model", "local_stt_mode",
                "on_prem_llm_url", "on_prem_llm_model", "on_prem_stt_url", "on_prem_stt_model",
                "language_hint"
            ]:
                if k in data:
                    cfg[k] = data[k]

            # Synchronisation pour rétrocompatibilité
            if "local_llm_url" in cfg and cfg["local_llm_url"]:
                cfg["on_prem_llm_url"] = cfg["local_llm_url"]
            if "local_llm_model" in cfg and cfg["local_llm_model"]:
                cfg["on_prem_llm_model"] = cfg["local_llm_model"]
            if "on_prem_llm_url" in cfg and ("local_llm_url" not in cfg or not cfg["local_llm_url"]):
                cfg["local_llm_url"] = cfg["on_prem_llm_url"]
            if "on_prem_llm_model" in cfg and ("local_llm_model" not in cfg or not cfg["local_llm_model"]):
                cfg["local_llm_model"] = cfg["on_prem_llm_model"]

            save_config(cfg)
            self._send_json(200, {"success": True, "message": "Configuration enregistrée avec succès !"})
            return

        elif path == "/api/test-connection":
            body = self.rfile.read(content_length).decode("utf-8")
            custom_cfg = json.loads(body) if body else load_config()
            success, message = AIService.test_connection(custom_cfg)
            self._send_json(200, {"success": success, "message": message})
            return

        elif path == "/api/recordings/create":
            body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
            data = json.loads(body)
            rec_id = f"rec_{int(time.time())}_{uuid.uuid4().hex[:6]}"
            title = data.get("title", "Session groupée").strip() or "Session groupée"
            now = datetime.now().isoformat()

            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("""
            INSERT INTO recordings (id, title, created_at, duration, filename, mime_type, file_size, status)
            VALUES (?, ?, ?, 0, '', 'audio/webm', 0, 'recorded')
            """, (rec_id, title, now))
            conn.commit()
            conn.close()

            self._send_json(201, {
                "id": rec_id,
                "title": title,
                "status": "recorded"
            })
            return

        elif path.endswith("/files") and "/api/recordings/" in path:
            rec_id = path.split("/")[3]
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("SELECT id, title, filename, duration, file_size FROM recordings WHERE id = ?", (rec_id,))
            rec = cur.fetchone()
            if not rec:
                conn.close()
                self._send_json(404, {"error": "Session introuvable"})
                return

            raw_mime = self.headers.get("Content-Type", "audio/webm")
            orig_name = urllib.parse.unquote(self.headers.get("X-Original-Filename", "Enregistrement"))
            duration = int(self.headers.get("X-Audio-Duration", 0))

            ext = ".webm"
            if "mp4" in raw_mime or "m4a" in raw_mime: ext = ".m4a"
            elif "wav" in raw_mime: ext = ".wav"
            elif "mp3" in raw_mime or "mpeg" in raw_mime: ext = ".mp3"
            elif "ogg" in raw_mime: ext = ".ogg"

            file_id = f"{rec_id}_{uuid.uuid4().hex[:6]}{ext}"
            file_path = os.path.join(RECORDINGS_DIR, file_id)

            with open(file_path, "wb") as f:
                f.write(self.rfile.read(content_length))

            file_size = os.path.getsize(file_path)
            now = datetime.now().isoformat()

            cur.execute("SELECT COUNT(*) FROM recording_files WHERE recording_id = ?", (rec_id,))
            count = cur.fetchone()[0]

            cur.execute("""
            INSERT INTO recording_files (recording_id, filename, original_name, mime_type, file_size, duration, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (rec_id, file_id, orig_name, raw_mime, file_size, duration, count, now))

            # Mise à jour globale de la session
            cur.execute("""
            UPDATE recordings
            SET filename = CASE WHEN filename = '' OR filename IS NULL THEN ? ELSE filename END,
                mime_type = CASE WHEN filename = '' OR filename IS NULL THEN ? ELSE mime_type END,
                file_size = file_size + ?,
                duration = duration + ?
            WHERE id = ?
            """, (file_id, raw_mime, file_size, duration, rec_id))
            conn.commit()
            conn.close()

            self._send_json(201, {
                "success": True,
                "file": {
                    "filename": file_id,
                    "original_name": orig_name,
                    "file_size": file_size,
                    "duration": duration
                }
            })
            return

        elif path == "/api/recordings/upload":
            # Upload d'un fichier audio unique (dictaphone mic ou import simple)
            rec_id = f"rec_{int(time.time())}_{uuid.uuid4().hex[:6]}"
            duration = int(self.headers.get("X-Audio-Duration", 0))
            title = urllib.parse.unquote(self.headers.get("X-Audio-Title", "Nouvel enregistrement"))
            raw_mime = self.headers.get("Content-Type", "audio/webm")

            # Détermine extension
            ext = ".webm"
            if "mp4" in raw_mime or "m4a" in raw_mime: ext = ".m4a"
            elif "wav" in raw_mime: ext = ".wav"
            elif "mp3" in raw_mime or "mpeg" in raw_mime: ext = ".mp3"
            elif "ogg" in raw_mime: ext = ".ogg"

            filename = f"{rec_id}{ext}"
            file_path = os.path.join(RECORDINGS_DIR, filename)

            with open(file_path, "wb") as f:
                f.write(self.rfile.read(content_length))

            file_size = os.path.getsize(file_path)
            now = datetime.now().isoformat()

            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("""
            INSERT INTO recordings (id, title, created_at, duration, filename, mime_type, file_size, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'recorded')
            """, (rec_id, title, now, duration, filename, raw_mime, file_size))

            cur.execute("""
            INSERT INTO recording_files (recording_id, filename, original_name, mime_type, file_size, duration, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
            """, (rec_id, filename, title, raw_mime, file_size, duration, now))

            conn.commit()
            conn.close()

            self._send_json(201, {
                "id": rec_id,
                "title": title,
                "filename": filename,
                "duration": duration,
                "status": "recorded"
            })
            return

        elif path.endswith("/process") and "/api/recordings/" in path:
            rec_id = path.split("/")[3]
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,))
            rec = cur.fetchone()
            if not rec:
                conn.close()
                self._send_json(404, {"error": "Enregistrement non trouvé"})
                return

            # Récupère tous les fichiers associés à cette session
            cur.execute("SELECT filename, original_name, mime_type, duration FROM recording_files WHERE recording_id = ? ORDER BY sort_order ASC, id ASC", (rec_id,))
            rows = cur.fetchall()

            audio_files_list = []
            if rows:
                for r in rows:
                    audio_files_list.append({
                        "path": os.path.join(RECORDINGS_DIR, r["filename"]),
                        "mime_type": r["mime_type"],
                        "name": r["original_name"],
                        "duration": r["duration"]
                    })
            elif rec["filename"]:
                audio_files_list.append({
                    "path": os.path.join(RECORDINGS_DIR, rec["filename"]),
                    "mime_type": rec["mime_type"],
                    "name": rec["title"],
                    "duration": rec["duration"]
                })

            if not audio_files_list:
                conn.close()
                self._send_json(400, {"error": "Aucun fichier audio trouvé pour cette session."})
                return

            cfg = load_config()

            try:
                # Met à jour statut en cours
                cur.execute("UPDATE recordings SET status = 'processing', error_message = NULL WHERE id = ?", (rec_id,))
                conn.commit()

                # Appel IA avec tous les fichiers
                ai_result = AIService.process_recording(rec_id, audio_files_list, cfg)

                title = ai_result.get("title", rec["title"])
                transcription_json = json.dumps(ai_result.get("transcription", []), ensure_ascii=False)
                summary_json = json.dumps(ai_result.get("summary", {}), ensure_ascii=False)

                cur.execute("""
                UPDATE recordings
                SET title = ?, transcription = ?, summary = ?, status = 'completed'
                WHERE id = ?
                """, (title, transcription_json, summary_json, rec_id))
                conn.commit()
                conn.close()

                self._send_json(200, {
                    "success": True,
                    "title": title,
                    "transcription": ai_result.get("transcription"),
                    "summary": ai_result.get("summary")
                })
            except Exception as e:
                err_msg = str(e)
                print(f"[Error Processing] {err_msg}")
                cur.execute("UPDATE recordings SET status = 'error', error_message = ? WHERE id = ?", (err_msg, rec_id))
                conn.commit()
                conn.close()
                self._send_json(500, {"success": False, "error": err_msg})
            return

        elif path.endswith("/chat") and "/api/recordings/" in path:
            rec_id = path.split("/")[3]
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)
            user_msg = data.get("message", "").strip()

            if not user_msg:
                self._send_json(400, {"error": "Message vide"})
                return

            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,))
            rec = cur.fetchone()
            if not rec:
                conn.close()
                self._send_json(404, {"error": "Enregistrement non trouvé"})
                return

            # Récupère historique
            cur.execute("SELECT role, content FROM chat_messages WHERE recording_id = ? ORDER BY id ASC", (rec_id,))
            history = [dict(r) for r in cur.fetchall()]

            cfg = load_config()
            now = datetime.now().isoformat()

            # Enregistre message utilisateur
            cur.execute("INSERT INTO chat_messages (recording_id, role, content, created_at) VALUES (?, 'user', ?, ?)", (rec_id, user_msg, now))
            conn.commit()

            try:
                ai_reply = AIService.chat_with_recording(
                    rec_id,
                    user_msg,
                    rec["transcription"] or "",
                    rec["summary"] or "",
                    history,
                    cfg
                )
                # Enregistre réponse IA
                cur.execute("INSERT INTO chat_messages (recording_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (rec_id, ai_reply, datetime.now().isoformat()))
                conn.commit()
                conn.close()
                self._send_json(200, {"reply": ai_reply})
            except Exception as e:
                conn.close()
                self._send_json(500, {"error": f"Erreur IA Chat: {str(e)}"})
            return

        self.send_error(404, "Route inconnue")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/recordings/"):
            parts = path.split("/")
            rec_id = parts[3]
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # Suppression d'un fichier spécifique de la session
            if len(parts) >= 6 and parts[4] == "files":
                file_id = parts[5]
                cur.execute("SELECT filename, file_size, duration FROM recording_files WHERE id = ? AND recording_id = ?", (file_id, rec_id))
                f_row = cur.fetchone()
                if f_row:
                    audio_path = os.path.join(RECORDINGS_DIR, f_row["filename"])
                    if os.path.exists(audio_path):
                        try: os.remove(audio_path)
                        except Exception: pass
                    cur.execute("DELETE FROM recording_files WHERE id = ?", (file_id,))
                    cur.execute("""
                    UPDATE recordings
                    SET file_size = MAX(0, file_size - ?),
                        duration = MAX(0, duration - ?)
                    WHERE id = ?
                    """, (f_row["file_size"], f_row["duration"], rec_id))
                    conn.commit()
                conn.close()
                self._send_json(200, {"success": True})
                return

            # Suppression de l'ensemble de la session et tous ses fichiers
            cur.execute("SELECT filename FROM recording_files WHERE recording_id = ?", (rec_id,))
            for f_row in cur.fetchall():
                audio_file = os.path.join(RECORDINGS_DIR, f_row["filename"])
                if os.path.exists(audio_file):
                    try: os.remove(audio_file)
                    except Exception: pass

            cur.execute("SELECT filename FROM recordings WHERE id = ?", (rec_id,))
            rec_row = cur.fetchone()
            if rec_row and rec_row["filename"]:
                audio_file = os.path.join(RECORDINGS_DIR, rec_row["filename"])
                if os.path.exists(audio_file):
                    try: os.remove(audio_file)
                    except Exception: pass

            cur.execute("DELETE FROM recording_files WHERE recording_id = ?", (rec_id,))
            cur.execute("DELETE FROM chat_messages WHERE recording_id = ?", (rec_id,))
            cur.execute("DELETE FROM recordings WHERE id = ?", (rec_id,))
            conn.commit()
            conn.close()
            self._send_json(200, {"success": True})
            return
        self.send_error(404)

def run():
    init_db()
    load_config()
    server_address = ("0.0.0.0", PORT)
    httpd = HTTPServer(server_address, DictaphoneHandler)
    print(f"==================================================")
    print(f"🎙️  VoxAI - Dictaphone Intelligent démarré sur :")
    print(f"👉  http://localhost:{PORT}")
    print(f"==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur.")
        httpd.server_close()

if __name__ == "__main__":
    run()
