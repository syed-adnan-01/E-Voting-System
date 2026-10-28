"""
Image Quality Checks
====================
Pre-filters images before running expensive MTCNN detection.
Catches obviously unusable images early to give better user feedback.

Checks performed:
  1. Blur detection     — Laplacian variance (catches out-of-focus captures)
  2. Brightness check   — mean pixel value (catches too dark / too bright)
  3. Minimum resolution — image must be at least 100×100 pixels
"""

import logging
from typing import Tuple

import cv2
import numpy as np

logger = logging.getLogger("face-service.quality")

# Tunable thresholds
MIN_LAPLACIAN_VARIANCE = 15.0    # below this → image is too blurry (lowered for webcam compatibility)
MIN_MEAN_BRIGHTNESS = 20.0       # below this → image is too dark
MAX_MEAN_BRIGHTNESS = 245.0      # above this → image is overexposed
MIN_IMAGE_SIZE_PX = 100          # minimum width or height


def check_image_quality(img_bgr: np.ndarray) -> Tuple[bool, str]:
    """
    Run quality checks on a BGR NumPy image.

    Returns:
        (True, "")                if all checks pass
        (False, reason_string)    if any check fails
    """
    if img_bgr is None or img_bgr.size == 0:
        return False, "Empty or null image received"

    h, w = img_bgr.shape[:2]

    # ------------------------------------------------------------------
    # 1. Minimum resolution
    # ------------------------------------------------------------------
    if w < MIN_IMAGE_SIZE_PX or h < MIN_IMAGE_SIZE_PX:
        return (
            False,
            f"Image too small ({w}×{h}px). Minimum {MIN_IMAGE_SIZE_PX}×{MIN_IMAGE_SIZE_PX}px required.",
        )

    # ------------------------------------------------------------------
    # 2. Blur detection via Laplacian variance
    # ------------------------------------------------------------------
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()

    if laplacian_var < MIN_LAPLACIAN_VARIANCE:
        return (
            False,
            f"Image is too blurry (sharpness score: {laplacian_var:.1f}). "
            "Please hold steady and ensure good lighting.",
        )

    # ------------------------------------------------------------------
    # 3. Brightness check
    # ------------------------------------------------------------------
    mean_brightness = float(np.mean(gray))

    if mean_brightness < MIN_MEAN_BRIGHTNESS:
        return (
            False,
            f"Image is too dark (brightness: {mean_brightness:.1f}/255). "
            "Please move to a brighter area or turn on a light.",
        )

    if mean_brightness > MAX_MEAN_BRIGHTNESS:
        return (
            False,
            f"Image is overexposed (brightness: {mean_brightness:.1f}/255). "
            "Please reduce direct light sources behind the camera.",
        )

    logger.debug(
        f"Quality OK — size={w}×{h}, blur={laplacian_var:.1f}, brightness={mean_brightness:.1f}"
    )
    return True, ""
