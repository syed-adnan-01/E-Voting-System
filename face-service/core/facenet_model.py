"""
FaceNet Model
=============
Singleton wrapper around facenet-pytorch's InceptionResnetV1.

Model: InceptionResnetV1 pretrained on VGGFace2
Output: 512-dimensional L2-normalized face embedding vector

The model is loaded once and reused for all requests.
Dynamic int8 quantization is applied on CPU to cut RAM footprint ~50%.
"""

import logging
import os
from typing import Optional

import torch
from facenet_pytorch import InceptionResnetV1

logger = logging.getLogger("face-service.facenet")

# Module-level singleton
_model = None
_device: Optional[torch.device] = None

MODEL_VERSION = "vggface2"

# Set to "0" via env var to disable quantization (e.g. for debugging)
_QUANTIZE = os.getenv("FACENET_QUANTIZE", "1") == "1"


def get_model():
    """
    Return the cached FaceNet model, loading it on first call.
    On CPU instances, applies dynamic int8 quantization to halve RAM usage.
    Thread-safe for FastAPI's async context (single process, single load).
    """
    global _model, _device

    if _model is None:
        _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if _device.type == "cpu":
            # Avoid CPU thread thrashing on limited CPU cores
            torch.set_num_threads(2)
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                pass  # May fail if already set in runtime
            logger.info("Configured PyTorch CPU threads (num_threads=2, num_interop_threads=1)")

        logger.info(f"Loading InceptionResnetV1 (pretrained={MODEL_VERSION}) on {_device}…")
        base_model = InceptionResnetV1(pretrained=MODEL_VERSION).eval()

        if _device.type == "cpu" and _QUANTIZE:
            logger.info("Applying dynamic int8 quantization to reduce RAM footprint…")
            _model = torch.quantization.quantize_dynamic(
                base_model,
                {torch.nn.Linear, torch.nn.Conv2d},
                dtype=torch.qint8,
            ).to(_device)
            logger.info("✅ FaceNet loaded with int8 quantization (~50% RAM reduction)")
        else:
            _model = base_model.to(_device)

        param_count = sum(p.numel() for p in base_model.parameters())
        logger.info(f"FaceNet ready — {param_count:,} parameters, device={_device}")

    return _model


def get_device() -> torch.device:
    """Return the device the model is running on."""
    if _device is None:
        get_model()
    return _device


def warmup_models() -> None:
    """Pre-warm FaceNet with a dummy tensor to avoid first-request latency spikes."""
    model = get_model()
    device = get_device()
    with torch.inference_mode():
        dummy_input = torch.zeros(1, 3, 160, 160, device=device)
        _ = model(dummy_input)
    logger.info("⚡ FaceNet model warm-up complete")


