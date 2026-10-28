"""
Face Preprocessing
==================
Normalizes a face tensor from MTCNN (pixel values [0, 255])
into the format expected by FaceNet InceptionResnetV1:
  - Values normalized to range [-1.0, +1.0]
  - Tensor shape: (3, 160, 160), dtype: float32

This normalization is equivalent to: (pixel / 127.5) - 1.0
"""

import torch


def preprocess_face(face_tensor: torch.Tensor) -> torch.Tensor:
    """
    Normalize a face tensor for FaceNet inference.

    Args:
        face_tensor: shape (3, 160, 160), values in [0, 255]

    Returns:
        Normalized tensor, shape (3, 160, 160), values in [-1, 1], dtype float32
    """
    # Convert to float and normalize to [-1, 1]
    face = face_tensor.float()
    face = (face - 127.5) / 128.0
    return face
