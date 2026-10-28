"""
Face Recognition & Vector Matching
==================================
Calculates similarity between a query face embedding and enrolled subject face embeddings.

Similarity Metric: Cosine Similarity
  Cosine Similarity = (A · B) / (||A|| * ||B||)
  Since FaceNet embeddings are L2-normalized (||A|| = ||B|| = 1.0),
  Cosine Similarity simplifies to the dot product A · B.

Thresholds:
  - MATCH_THRESHOLD = 0.70  (Cosine similarity >= 0.70 is considered a match)
  - Distances: Cosine Distance = 1.0 - Cosine Similarity (Distance <= 0.30 is a match)
"""

import logging
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

from core.embedding_store import load_all_profiles

logger = logging.getLogger("face-service.recognition")

# Minimum cosine similarity required to consider a match (0.0 to 1.0)
MATCH_THRESHOLD = 0.70


def get_match_threshold() -> float:
    return float(MATCH_THRESHOLD)


def set_match_threshold(new_threshold: float) -> float:
    global MATCH_THRESHOLD
    clamped = max(0.50, min(0.95, round(float(new_threshold), 2)))
    MATCH_THRESHOLD = clamped
    logger.info(f"Updated FaceNet recognition match threshold to {clamped}")
    return clamped


def compute_cosine_similarity(emb1: List[float], emb2: List[float]) -> float:
    """Compute cosine similarity between two 512-dim embedding vectors."""
    vec1 = np.array(emb1, dtype=np.float32)
    vec2 = np.array(emb2, dtype=np.float32)

    norm1 = np.linalg.norm(vec1)
    norm2 = np.linalg.norm(vec2)

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return float(np.dot(vec1, vec2) / (norm1 * norm2))


def calculate_confidence(similarity: float, threshold: float = MATCH_THRESHOLD) -> float:
    """
    Convert cosine similarity score to a user-friendly confidence percentage (0% to 100%).
    Similarity above threshold maps to 70%..100%.
    Similarity below threshold maps to 0%..69%.
    """
    if similarity >= threshold:
        # Scale range [threshold, 1.0] -> [70.0, 99.9]
        ratio = (similarity - threshold) / (1.0 - threshold) if threshold < 1.0 else 1.0
        conf = 70.0 + (ratio * 29.9)
    else:
        # Scale range [0.0, threshold) -> [0.0, 69.9)
        conf = (similarity / threshold) * 69.9 if threshold > 0 else 0.0

    return round(float(np.clip(conf, 0.0, 99.9)), 1)


def verify_against_profile(
    query_embedding: List[float],
    profile_data: Dict[str, Any],
) -> Tuple[float, float]:
    """
    Compare query embedding against all stored embeddings of a single subject profile.
    Returns the maximum similarity and maximum confidence found.
    """
    embeddings = profile_data.get("embeddings", [])
    if not embeddings:
        return 0.0, 0.0

    max_sim = 0.0
    for stored_emb in embeddings:
        sim = compute_cosine_similarity(query_embedding, stored_emb)
        if sim > max_sim:
            max_sim = sim

    conf = calculate_confidence(max_sim)
    return max_sim, conf


def identify_face_1toN(
    query_embedding: List[float],
    threshold: float = MATCH_THRESHOLD,
) -> Optional[Dict[str, Any]]:
    """
    1:N Recognition: Compare query embedding against ALL enrolled subject profiles.
    Returns dict with matched subject_id, similarity, confidence if match found above threshold,
    or None if no match passes the threshold.
    """
    all_profiles = load_all_profiles()
    if not all_profiles:
        return None

    best_match_id = None
    best_similarity = -1.0
    best_confidence = 0.0
    best_id_str = ""

    for subj_id, profile in all_profiles.items():
        sim, conf = verify_against_profile(query_embedding, profile)
        if sim > best_similarity:
            best_similarity = sim
            best_confidence = conf
            best_match_id = subj_id
            best_id_str = profile.get("subject_id_str", "")

    if best_similarity >= threshold and best_match_id:
        return {
            "matched": True,
            "subject_id": best_match_id,
            "subject_id_str": best_id_str,
            "similarity": round(best_similarity, 4),
            "distance": round(1.0 - best_similarity, 4),
            "confidence": best_confidence,
        }

    return None


def verify_face_1to1(
    query_embedding: List[float],
    subject_id: str,
    threshold: float = MATCH_THRESHOLD,
) -> Dict[str, Any]:
    """
    1:1 Verification: Compare query embedding against a specific subject's profile.
    """
    all_profiles = load_all_profiles()
    profile = all_profiles.get(subject_id)

    if not profile:
        return {
            "matched": False,
            "subject_id": subject_id,
            "similarity": 0.0,
            "distance": 1.0,
            "confidence": 0.0,
            "reason": "Subject face profile not found",
        }

    sim, conf = verify_against_profile(query_embedding, profile)
    is_match = sim >= threshold

    return {
        "matched": is_match,
        "subject_id": subject_id,
        "subject_id_str": profile.get("subject_id_str", ""),
        "similarity": round(sim, 4),
        "distance": round(1.0 - sim, 4),
        "confidence": conf,
    }
