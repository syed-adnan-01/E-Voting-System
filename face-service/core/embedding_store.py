"""
Embedding Store
===============
Persists face embeddings as a JSON file at face-service/data/embeddings.json.

Structure:
{
  "<subject_id>": {
    "subject_id_str": "Admin",
    "embeddings": [[...512 floats...], ...],
    "model_version": "vggface2",
    "created_at": "2026-08-14T16:00:00Z",
    "updated_at": "2026-08-14T16:00:00Z"
  },
  ...
}

This flat JSON approach keeps the face-service lightweight and self-contained.
An in-memory cache is maintained for fast similarity searches.
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import threading

logger = logging.getLogger("face-service.store")

# ---------------------------------------------------------------------------
# Store path — relative to face-service root or custom DATA_DIR
# ---------------------------------------------------------------------------
_data_dir_env = os.getenv("DATA_DIR")
_STORE_DIR = Path(_data_dir_env) if _data_dir_env else (Path(__file__).resolve().parent.parent / "data")
_STORE_PATH = _STORE_DIR / "embeddings.json"

# Thread lock for safe concurrent writes (FastAPI can run concurrent requests)
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ensure_store_exists() -> None:
    """Create the data directory and empty store file if they don't exist."""
    _STORE_DIR.mkdir(parents=True, exist_ok=True)
    if not _STORE_PATH.exists():
        _STORE_PATH.write_text("{}", encoding="utf-8")


def _load_store() -> Dict[str, Any]:
    _ensure_store_exists()
    try:
        with open(_STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Failed to read embedding store: {e}")
        return {}


def _save_store(data: Dict[str, Any]) -> None:
    _ensure_store_exists()
    with open(_STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


import base64
import hashlib
import json
import logging
import os

_SECRET_KEY = os.getenv("EMBEDDING_ENCRYPTION_KEY", "PQZKVOTE_BIOMETRIC_KEY_2026")


def _get_cipher_key() -> bytes:
    return hashlib.sha256(_SECRET_KEY.encode("utf-8")).digest()


def _encrypt_vectors(embeddings: List[List[float]]) -> str:
    """Serialize float matrix to JSON, then encrypt into base64 ciphertext string."""
    raw_bytes = json.dumps(embeddings).encode("utf-8")
    key = _get_cipher_key()

    encrypted = bytearray()
    for i, b in enumerate(raw_bytes):
        key_byte = key[i % len(key)]
        encrypted.append(b ^ key_byte)

    return "enc_v1:" + base64.b64encode(bytes(encrypted)).decode("utf-8")


def _decrypt_vectors(data_val: Any) -> List[List[float]]:
    """Decrypt base64 ciphertext string back to float matrix."""
    if isinstance(data_val, list):
        # Plaintext fallback for existing legacy profiles
        return data_val

    if not isinstance(data_val, str) or not data_val.startswith("enc_v1:"):
        return []

    try:
        raw_b64 = data_val.replace("enc_v1:", "", 1)
        encrypted = base64.b64decode(raw_b64.encode("utf-8"))
        key = _get_cipher_key()

        decrypted = bytearray()
        for i, b in enumerate(encrypted):
            key_byte = key[i % len(key)]
            decrypted.append(b ^ key_byte)

        return json.loads(decrypted.decode("utf-8"))
    except Exception as e:
        logger.error(f"Failed to decrypt embedding vectors: {e}")
        return []


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


_CACHE: Optional[Dict[str, Any]] = None
_CACHE_LOCK = threading.Lock()


def invalidate_cache() -> None:
    global _CACHE
    with _CACHE_LOCK:
        _CACHE = None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def save_profile(
    subject_id: str,
    subject_id_str: str,
    embeddings: List[List[float]],
    model_version: str = "vggface2",
) -> None:
    """
    Save (or replace) the face profile for the given subject with encryption.
    """
    with _lock:
        store = _load_store()
        now = _now_iso()

        existing = store.get(subject_id)
        created_at = existing["created_at"] if existing else now

        store[subject_id] = {
            "subject_id_str": subject_id_str,
            "encrypted": True,
            "embeddings": _encrypt_vectors(embeddings),
            "embedding_count": len(embeddings),
            "model_version": model_version,
            "created_at": created_at,
            "updated_at": now,
        }

        _save_store(store)
        invalidate_cache()

    logger.info(
        f"Encrypted & saved {len(embeddings)} embedding(s) for subject {subject_id} ({subject_id_str})"
    )


def load_profile(subject_id: str) -> Optional[Dict[str, Any]]:
    """Return the full profile dict for the given subject with decrypted embeddings."""
    all_profs = load_all_profiles()
    return all_profs.get(subject_id)


def profile_exists(subject_id: str) -> bool:
    """Return True if a face profile exists for the given subject."""
    all_profs = load_all_profiles()
    return subject_id in all_profs


def delete_profile(subject_id: str) -> bool:
    """
    Delete the face profile for the given subject.
    """
    with _lock:
        store = _load_store()
        if subject_id not in store:
            return False
        del store[subject_id]
        _save_store(store)
        invalidate_cache()

    logger.info(f"Deleted face profile for subject {subject_id}")
    return True


def load_all_profiles() -> Dict[str, Any]:
    """Return all profiles with decrypted embeddings (cached in memory for high-performance 1:N matching)."""
    global _CACHE
    with _CACHE_LOCK:
        if _CACHE is not None:
            return _CACHE

        raw_store = _load_store()
        decrypted_store = {}
        for subj_id, prof in raw_store.items():
            copy_prof = dict(prof)
            copy_prof["embeddings"] = _decrypt_vectors(prof.get("embeddings"))
            decrypted_store[subj_id] = copy_prof
        _CACHE = decrypted_store
        return _CACHE
