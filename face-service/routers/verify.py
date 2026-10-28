"""
Face Verification Router
========================
Endpoints:
  POST /face/verify               - 1:N Identification (matches image against all enrolled profiles)
  POST /face/verify/{subject_id}  - 1:1 Verification (verifies image against a specific subject)
"""

import base64
import logging
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.detection import detect_and_align, detect_landmarks_only
from core.preprocessing import preprocess_face
from core.facenet_model import get_model, get_device
from core.quality import check_image_quality
from core.liveness import check_liveness, check_eye_blink_liveness
from core.recognition import identify_face_1toN, verify_face_1to1, get_match_threshold, set_match_threshold
import torch

logger = logging.getLogger("face-service.verify")

router = APIRouter()


class VerifyRequest(BaseModel):
    """Request body containing captured image frame(s)."""
    image: str                          # base64 encoded image string (current frame)
    prev_image: Optional[str] = None    # optional previous frame (~250ms prior) for eye blink check
    subject_id: Optional[str] = None    # optional subject ID for 1:1 check


class VerifyResponse(BaseModel):
    matched: bool
    subject_id: Optional[str] = None
    subject_id_str: Optional[str] = None
    similarity: float
    distance: float
    confidence: float
    message: str


def _decode_base64(b64_string: str) -> np.ndarray:
    import cv2
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_string)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image data. Could not decode base64.")
    return img


@router.post(
    "/verify",
    response_model=VerifyResponse,
    status_code=status.HTTP_200_OK,
    summary="1:N Face Recognition (Auto-identify subject from image)",
)
async def verify_face_1toN_endpoint(body: VerifyRequest):
    if not body.image:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No image provided for verification.",
        )

    # 1. Decode image
    try:
        img = _decode_base64(body.image)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    # 2. Quality check
    quality_ok, quality_reason = check_image_quality(img)
    if not quality_ok:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Image quality issue: {quality_reason}",
        )

    # 3. Detection & alignment
    try:
        face_tensor, landmarks = detect_and_align(img)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(ve),
        )

    # 4. Anti-Spoofing & Liveness Check
    is_live, liveness_score, spoof_reason = check_liveness(img, landmarks)
    if not is_live:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Anti-spoofing check failed: {spoof_reason}",
        )

    # 4b. Dual-frame Eye Blink & Motion Check (Required for Anti-Spoofing)
    if not body.prev_image:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Anti-spoofing check failed: Dual-frame camera stream required for eye blink verification.",
        )

    try:
        prev_img = _decode_base64(body.prev_image)
        prev_landmarks, _ = detect_landmarks_only(prev_img)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Anti-spoofing frame 1 error: {str(exc)}",
        )

    is_blink_live, blink_score, blink_reason = check_eye_blink_liveness(
        img, prev_img, landmarks, prev_landmarks
    )
    if not is_blink_live:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Anti-spoofing check failed: {blink_reason}",
        )

    # 5. Preprocess & embed
    with torch.inference_mode():
        model = get_model()
        device = get_device()
        face_tensor = preprocess_face(face_tensor)
        embedding = model(face_tensor.unsqueeze(0).to(device))
        query_emb = embedding.detach().cpu().numpy().flatten().tolist()

    # 5. Perform 1:1 or 1:N matching
    if body.subject_id:
        result = verify_face_1to1(query_emb, body.subject_id)
    else:
        match = identify_face_1toN(query_emb)
        if match:
            result = match
        else:
            result = {
                "matched": False,
                "subject_id": None,
                "subject_id_str": None,
                "similarity": 0.0,
                "distance": 1.0,
                "confidence": 0.0,
            }

    if result["matched"]:
        msg = f"Face verified successfully! Matched {result.get('subject_id_str') or result['subject_id']} ({result['confidence']}% match)."
        logger.info(f"Verification SUCCESS — {result['subject_id']} ({result['confidence']}%)")
    else:
        msg = "Face not recognized. Please ensure you are enrolled and face the camera directly."
        logger.warning("Verification FAILED — No matching profile found")

    return VerifyResponse(
        matched=result["matched"],
        subject_id=result.get("subject_id"),
        subject_id_str=result.get("subject_id_str"),
        similarity=result.get("similarity", 0.0),
        distance=result.get("distance", 1.0),
        confidence=result.get("confidence", 0.0),
        message=msg,
    )


@router.post(
    "/verify/{subject_id}",
    response_model=VerifyResponse,
    status_code=status.HTTP_200_OK,
    summary="1:1 Face Verification against a specific subject",
)
async def verify_face_1to1_endpoint(subject_id: str, body: VerifyRequest):
    body.subject_id = subject_id
    return await verify_face_1toN_endpoint(body)


class ThresholdRequest(BaseModel):
    threshold: float


@router.get("/threshold", summary="Get current face recognition similarity threshold")
async def get_threshold_endpoint():
    return {"threshold": get_match_threshold()}


@router.post("/threshold", summary="Update face recognition similarity threshold")
async def update_threshold_endpoint(body: ThresholdRequest):
    new_val = set_match_threshold(body.threshold)
    return {"success": True, "threshold": new_val, "message": f"Match threshold updated to {new_val}"}
