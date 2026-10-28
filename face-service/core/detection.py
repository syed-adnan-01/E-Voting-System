"""
Face Detection and Alignment
============================
Uses MTCNN (Multi-task Cascaded Convolutional Networks) from facenet-pytorch.
MTCNN handles:
  - Face detection with bounding boxes
  - Landmark detection (eyes, nose, mouth corners)
  - Automatic face alignment (rotation correction)
  - Output: 160×160 aligned face tensor

Validation rules:
  - Exactly ONE face must be detected
  - Detection confidence must be > 0.85
  - Face bounding box must be at least 60×60 pixels
"""

import logging
from typing import Optional, Tuple

import cv2
import numpy as np
import torch
from PIL import Image
from facenet_pytorch import MTCNN

logger = logging.getLogger("face-service.detection")

# Minimum acceptable face size (pixels) in the original image
MIN_FACE_SIZE_PX = 60

# Minimum MTCNN detection probability
MIN_CONFIDENCE = 0.85

# Maximum width to scale high-res webcam frames before detection
MAX_DETECTION_WIDTH = 640

# Singleton MTCNN instance (CPU by default for portability)
_mtcnn: Optional[MTCNN] = None


def _get_mtcnn() -> MTCNN:
    global _mtcnn
    if _mtcnn is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _mtcnn = MTCNN(
            image_size=160,          # output face size
            margin=20,               # pixels of context around the face
            min_face_size=30,        # smallest face to detect (in image pixels)
            thresholds=[0.6, 0.7, 0.7],  # P-Net, R-Net, O-Net thresholds
            factor=0.709,            # scale factor for image pyramid
            post_process=False,      # return raw pixel tensor, not normalized
            keep_all=True,           # keep ALL detected faces so we can count them
            device=device,
        )
        logger.info(f"MTCNN initialized on {device}")
    return _mtcnn


def warmup_detection() -> None:
    """Pre-initialize MTCNN singleton on application startup."""
    _get_mtcnn()


def _downscale_if_large(img_bgr: np.ndarray, max_width: int = MAX_DETECTION_WIDTH) -> Tuple[np.ndarray, float]:
    """Downscale large input image to speed up MTCNN multi-scale pyramid sweeps."""
    h, w = img_bgr.shape[:2]
    if w > max_width:
        scale = max_width / float(w)
        new_w = max_width
        new_h = int(h * scale)
        scaled_img = cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)
        return scaled_img, scale
    return img_bgr, 1.0


def detect_landmarks_only(img_bgr: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[Tuple[int, int]]]:
    """
    Fast landmark detection helper for frame 1 in eye-blink verification.
    Avoids full face tensor alignment extraction.
    Returns (landmarks, image_shape).
    """
    if img_bgr is None or img_bgr.size == 0:
        return None, None

    img_scaled, scale = _downscale_if_large(img_bgr)
    img_rgb = cv2.cvtColor(img_scaled, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(img_rgb)

    mtcnn = _get_mtcnn()
    with torch.inference_mode():
        boxes, probs, landmarks = mtcnn.detect(pil_image, landmarks=True)

    if landmarks is None or len(landmarks) == 0:
        return None, (img_bgr.shape[0], img_bgr.shape[1])

    first_landmarks = landmarks[0]
    if scale != 1.0 and first_landmarks is not None:
        first_landmarks = first_landmarks / scale

    return first_landmarks, (img_bgr.shape[0], img_bgr.shape[1])


def detect_and_align(img_bgr: np.ndarray) -> Tuple[torch.Tensor, Optional[np.ndarray]]:
    """
    Detect and align a face from a BGR NumPy image (OpenCV format).

    Returns:
        Tuple of (torch.Tensor of shape (3, 160, 160), landmarks)

    Raises:
        ValueError: with a user-friendly reason string if detection fails
    """
    mtcnn = _get_mtcnn()

    # Pre-downscale high-res input images (e.g. 1080p -> 640p)
    img_scaled, scale = _downscale_if_large(img_bgr)

    # Convert BGR → RGB for MTCNN / PIL
    img_rgb = cv2.cvtColor(img_scaled, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(img_rgb)

    # Single-pass face detection + bounding boxes + landmarks
    with torch.inference_mode():
        boxes, probs, landmarks = mtcnn.detect(pil_image, landmarks=True)

    # -----------------------------------------------------------------------
    # Validation: face count
    # -----------------------------------------------------------------------
    if boxes is None or len(boxes) == 0:
        raise ValueError("No face detected. Please ensure your face is clearly visible and well-lit.")

    if len(boxes) > 1:
        raise ValueError(
            f"{len(boxes)} faces detected in the image. "
            "Please ensure only one person is visible."
        )

    # -----------------------------------------------------------------------
    # Validation: confidence
    # -----------------------------------------------------------------------
    confidence = float(probs[0])
    if confidence < MIN_CONFIDENCE:
        raise ValueError(
            f"Low detection confidence ({confidence:.2f}). "
            "Please improve lighting and ensure your face is clearly visible."
        )

    # -----------------------------------------------------------------------
    # Validation: face size (calculate size in original unscaled pixels)
    # -----------------------------------------------------------------------
    x1, y1, x2, y2 = boxes[0]
    face_w = (x2 - x1) / scale
    face_h = (y2 - y1) / scale

    if face_w < MIN_FACE_SIZE_PX or face_h < MIN_FACE_SIZE_PX:
        raise ValueError(
            f"Face too small ({int(face_w)}×{int(face_h)} px). "
            f"Please move closer to the camera (minimum {MIN_FACE_SIZE_PX}px required)."
        )

    # -----------------------------------------------------------------------
    # Extract aligned face tensor directly without running MTCNN neural net a second time
    # -----------------------------------------------------------------------
    with torch.inference_mode():
        extracted_faces = mtcnn.extract(pil_image, boxes[0:1], save_path=None)

    if extracted_faces is None or len(extracted_faces) == 0:
        raise ValueError(
            "Face was detected but could not be aligned. "
            "Please try again with better lighting."
        )

    face_tensor = extracted_faces[0]  # shape: (3, 160, 160)

    first_landmarks = landmarks[0] if (landmarks is not None and len(landmarks) > 0) else None
    if scale != 1.0 and first_landmarks is not None:
        first_landmarks = first_landmarks / scale

    logger.debug(
        f"Face detected — bbox=({int(x1/scale)},{int(y1/scale)},{int(x2/scale)},{int(y2/scale)}), "
        f"size={int(face_w)}×{int(face_h)}, confidence={confidence:.3f}"
    )

    return face_tensor, first_landmarks

