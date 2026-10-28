"""
Face Enrollment Router
======================
Endpoints:
  POST   /face/enroll/{subject_id}   - Enroll face images for a subject
  GET    /face/profile/{subject_id}  - Get enrollment status
  DELETE /face/profile/{subject_id}  - Delete face profile
"""

import base64
import logging
from typing import List

import torch
import numpy as np
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.detection import detect_and_align
from core.preprocessing import preprocess_face
from core.facenet_model import get_model, get_device
from core.liveness import check_liveness
from core.embedding_store import (
    save_profile,
    load_profile,
    delete_profile,
    profile_exists,
)
from core.quality import check_image_quality

logger = logging.getLogger("face-service.enroll")

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response Schemas
# ---------------------------------------------------------------------------

class EnrollRequest(BaseModel):
    """
    Request body for face enrollment.
    images: list of base64-encoded image strings (JPEG or PNG, 3–10 images).
    subject_id_str: human-readable subject ID (e.g. "Admin") for display.
    """
    images: List[str]                  # base64 strings
    subject_id_str: str = ""           # human-readable ID (optional metadata)


class EnrollResponse(BaseModel):
    success: bool
    subject_id: str
    embeddings_created: int
    message: str


class ProfileResponse(BaseModel):
    subject_id: str
    enrolled: bool
    embedding_count: int
    model_version: str
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode_base64_image(b64_string: str) -> np.ndarray:
    """Decode a base64 image string to a NumPy BGR array (OpenCV format)."""
    import cv2

    # Strip data-URL prefix if present (e.g. "data:image/png;base64,...")
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]

    img_bytes = base64.b64decode(b64_string)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("Could not decode image from base64 data")

    return img


# ---------------------------------------------------------------------------
# POST /face/enroll/{subject_id}
# ---------------------------------------------------------------------------

@router.post(
    "/enroll/{subject_id}",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
    summary="Enroll face images for a subject",
)
async def enroll_face(subject_id: str, body: EnrollRequest):
    """
    Accepts 3–10 base64-encoded images of a subject.
    Runs MTCNN detection, quality check, FaceNet embedding.
    Stores embeddings keyed by subject_id.
    """
    if not body.images:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No images provided. Please send 3–10 face images.",
        )

    if len(body.images) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Too few images ({len(body.images)}). Minimum 3 required for reliable enrollment.",
        )

    if len(body.images) > 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Too many images. Maximum 10 per enrollment.",
        )

    model = get_model()
    embeddings: List[List[float]] = []
    rejected: List[str] = []

    for idx, b64 in enumerate(body.images):
        image_label = f"Image {idx + 1}"
        try:
            # 1. Decode
            img = _decode_base64_image(b64)

            # 2. Quality gate
            quality_ok, quality_reason = check_image_quality(img)
            if not quality_ok:
                rejected.append(f"{image_label}: {quality_reason}")
                logger.warning(f"[{subject_id}] {image_label} rejected — {quality_reason}")
                continue

            # 3. Face detection + alignment
            face_tensor, landmarks = detect_and_align(img)

            # 4. Anti-spoofing check
            is_live, liveness_score, spoof_reason = check_liveness(img, landmarks)
            if not is_live:
                rejected.append(f"{image_label}: {spoof_reason}")
                logger.warning(f"[{subject_id}] {image_label} rejected — {spoof_reason}")
                continue

            # 5. Preprocess
            face_tensor = preprocess_face(face_tensor)

            # 5. FaceNet embedding
            with torch.inference_mode():
                device = get_device()
                embedding = model(face_tensor.unsqueeze(0).to(device))  # shape: (1, 512)
                embedding_list = embedding.detach().cpu().numpy().flatten().tolist()
            embeddings.append(embedding_list)

            logger.info(f"[{subject_id}] {image_label} — embedding generated (dim={len(embedding_list)})")

        except ValueError as ve:
            rejected.append(f"{image_label}: {str(ve)}")
            logger.warning(f"[{subject_id}] {image_label} skipped — {ve}")
        except Exception as exc:
            rejected.append(f"{image_label}: Processing error — {str(exc)}")
            logger.error(f"[{subject_id}] {image_label} error — {exc}", exc_info=True)

    # Require at least 3 successful embeddings
    if len(embeddings) < 3:
        detail = (
            f"Only {len(embeddings)} usable face(s) found. "
            f"Need at least 3. Rejections: {'; '.join(rejected) if rejected else 'none'}"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )

    # Save profile
    save_profile(
        subject_id=subject_id,
        subject_id_str=body.subject_id_str,
        embeddings=embeddings,
    )

    logger.info(
        f"[{subject_id}] Enrollment complete — "
        f"{len(embeddings)} embeddings stored, {len(rejected)} rejected"
    )

    return EnrollResponse(
        success=True,
        subject_id=subject_id,
        embeddings_created=len(embeddings),
        message=(
            f"Successfully enrolled {len(embeddings)} face embedding(s)."
            + (f" {len(rejected)} image(s) were rejected." if rejected else "")
        ),
    )


# ---------------------------------------------------------------------------
# GET /face/profile/{subject_id}
# ---------------------------------------------------------------------------

@router.get(
    "/profile/{subject_id}",
    response_model=ProfileResponse,
    summary="Get face enrollment status for a subject",
)
async def get_face_profile(subject_id: str):
    """Returns enrollment metadata for the given subject."""
    if not profile_exists(subject_id):
        return ProfileResponse(
            subject_id=subject_id,
            enrolled=False,
            embedding_count=0,
            model_version="",
            created_at="",
            updated_at="",
        )

    profile = load_profile(subject_id)
    return ProfileResponse(
        subject_id=subject_id,
        enrolled=True,
        embedding_count=len(profile.get("embeddings", [])),
        model_version=profile.get("model_version", ""),
        created_at=profile.get("created_at", ""),
        updated_at=profile.get("updated_at", ""),
    )


# ---------------------------------------------------------------------------
# DELETE /face/profile/{subject_id}
# ---------------------------------------------------------------------------

@router.delete(
    "/profile/{subject_id}",
    summary="Delete face profile for a subject",
)
async def delete_face_profile(subject_id: str):
    """Removes all stored embeddings for the given subject."""
    if not profile_exists(subject_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No face profile found for subject {subject_id}",
        )

    delete_profile(subject_id)
    logger.info(f"[{subject_id}] Face profile deleted")
    return {"success": True, "message": f"Face profile for {subject_id} deleted"}
