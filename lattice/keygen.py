"""
lattice/keygen.py
=================
Key generation for the QRZ-KPA scheme.

From the paper (ICCC 2025 §II Methodology):
  "from the public key pk = (ρ, t₁), a matrix (A) is generated in the
   Number Theoretic Transform (NTT) domain"

Key generation:
  1. Sample a random 32-byte seed ρ
  2. Expand ρ → A (k×k NTT-domain matrix) via SHAKE-128
  3. Sample secret vector s  ← χ_σ^k  (discrete Gaussian)
  4. Sample error vector  e  ← χ_σ^k
  5. Compute t = NTT(A) · NTT(s) + e  (in NTT domain)
  6. Public key:  pk = (ρ, t)
  7. Secret key:  sk = (s, e, ρ)
"""

import os
import numpy as np
from lattice.params import N, Q, K
from lattice.ntt import ntt, intt, mat_vec_mul_ntt, vec_add
from lattice.sampling import expand_A, sample_gaussian_vec


def keygen(seed: bytes | None = None) -> tuple[dict, dict]:
    """
    Generate a QRZ-KPA key pair.

    Parameters
    ----------
    seed : bytes or None
        32-byte seed for ρ. If None, uses os.urandom (cryptographically secure).
        Pass a fixed seed for deterministic testing.

    Returns
    -------
    pk : dict with keys 'rho' (bytes) and 't' (list of NTT-form polynomials)
    sk : dict with keys 's', 'e' (lists of coefficient-form polynomials) and 'rho'
    """
    rho = seed if seed is not None else os.urandom(32)

    # Expand seed into NTT-domain matrix A (paper: "A generated in NTT domain")
    A_hat = expand_A(rho)

    if seed is not None:
        rng = np.random.default_rng(int.from_bytes(seed[:8], "big"))
    else:
        rng = None

    # Sample secret and error vectors from discrete Gaussian
    s = sample_gaussian_vec(K, rng=rng)
    e = sample_gaussian_vec(K, rng=rng)

    # Compute t = A·s + e in NTT domain
    s_hat = [ntt(si) for si in s]
    t_hat = mat_vec_mul_ntt(A_hat, s_hat)

    # Convert to coefficient domain, add error e, then NTT back for storage
    t_coeff = [intt(t_hat[i]) for i in range(K)]
    t_plus_e = vec_add(t_coeff, e)
    t_final_hat = [ntt(ti) for ti in t_plus_e]

    pk = {"rho": rho, "t": t_final_hat}
    sk = {"s": s, "e": e, "rho": rho}

    return pk, sk


def pk_to_bytes(pk: dict) -> bytes:
    """Serialise public key into bytes."""
    out = pk["rho"]
    for poly in pk["t"]:
        for coeff in poly:
            out += (coeff % Q).to_bytes(2, "little")
    return out


def sk_to_bytes(sk: dict) -> bytes:
    """Serialise secret key into bytes."""
    out = sk["rho"]
    for poly in sk["s"]:
        for coeff in poly:
            c = coeff % Q
            if c > Q // 2:
                c -= Q
            out += c.to_bytes(2, "little", signed=True)
    return out
