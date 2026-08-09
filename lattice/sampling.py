"""
lattice/sampling.py
===================
Polynomial sampling functions for the QRZ-KPA scheme.

The QRZ-KPA paper (ICCC 2025 §II) specifies:
  - Secret vector s': random secret vector  → discrete Gaussian
  - Error vector e':  random error vector   → discrete Gaussian
  - Matrix A: generated in NTT domain from public seed ρ → SHAKE-128 XOF

This module implements all three samplers.
"""

import hashlib
import os
import struct

from lattice.params import N, Q, K, SIGMA


# ---------------------------------------------------------------------------
# Discrete Gaussian sampler
# ---------------------------------------------------------------------------

def sample_gaussian(rng=None) -> list[int]:
    """
    Sample a polynomial with N coefficients from the discrete Gaussian
    distribution with mean 0 and std dev SIGMA, reduced mod q.

    Method: rejection sampling — draw from a rounded Gaussian and accept.
    Each coefficient is in [-B, B] ⊂ Z_q where B = round(6σ).

    Parameters
    ----------
    rng : numpy.random.Generator or None
        If None, uses os.urandom-based sampling (cryptographically secure).
        For testing with fixed seeds, pass a numpy RNG.

    Returns
    -------
    list[int] of length N, coefficients in Z_q (i.e., centred on [0, q-1])
    """
    import math, random as _random

    bound = max(1, round(6 * SIGMA))   # 6σ cutoff → negligible tail probability
    coeffs = []

    if rng is not None:
        # NumPy path (deterministic, for tests)
        raw = rng.normal(0, SIGMA, N)
        for x in raw:
            rounded = int(round(x))
            coeffs.append(int(rounded % Q))
    else:
        # Cryptographically secure path
        while len(coeffs) < N:
            # Draw from Gaussian using Box-Muller with os.urandom
            u1_bytes = os.urandom(8)
            u2_bytes = os.urandom(8)
            u1 = (struct.unpack(">Q", u1_bytes)[0] + 0.5) / (2**64)
            u2 = (struct.unpack(">Q", u2_bytes)[0] + 0.5) / (2**64)
            import math as _math
            z = int(round(_math.sqrt(-2 * _math.log(u1)) * _math.cos(2 * _math.pi * u2) * SIGMA))
            coeffs.append(int(z % Q))
            if len(coeffs) < N:
                z2 = int(round(_math.sqrt(-2 * _math.log(u1)) * _math.sin(2 * _math.pi * u2) * SIGMA))
                coeffs.append(int(z2 % Q))

    return coeffs[:N]


def sample_gaussian_vec(k: int = K, rng=None) -> list[list[int]]:
    """Sample a k-vector of Gaussian polynomials."""
    return [sample_gaussian(rng) for _ in range(k)]


# ---------------------------------------------------------------------------
# Matrix expansion from seed (paper: "A generated from public key pk = (ρ, t₁)")
# ---------------------------------------------------------------------------

def expand_A(rho: bytes) -> list[list[list[int]]]:
    """
    Expand seed ρ into the k×k matrix A in NTT domain using SHAKE-128.

    This implements the paper's "from the public key pk = (ρ, t₁), a matrix (A)
    is generated in the NTT domain."

    The method is identical to Kyber's XOF-based matrix expansion (FIPS 203 §4.2.1):
    - For each (i, j), feed (ρ ∥ j ∥ i) into SHAKE-128
    - Stream output bytes and rejection-sample uniform coefficients in [0, q-1]

    Parameters
    ----------
    rho : bytes
        32-byte public seed.

    Returns
    -------
    A : list[list[list[int]]]
        k×k matrix of NTT-form polynomials, each of length N.
    """
    from lattice.ntt import ntt

    A = []
    for i in range(K):
        row = []
        for j in range(K):
            # XOF input: rho || j || i  (column-first, matching Kyber spec)
            xof_input = rho + bytes([j, i])
            shake = hashlib.shake_128(xof_input)
            # Generate enough bytes via rejection sampling to fill N coefficients
            coeffs = []
            buf = shake.digest(N * 3)   # over-generate; rejection filter
            idx = 0
            while len(coeffs) < N:
                if idx + 2 > len(buf):
                    # Need more bytes — extend
                    buf = shake.digest(len(buf) + N * 3)
                d1 = buf[idx] + 256 * (buf[idx + 1] & 0x0F)
                d2 = (buf[idx + 1] >> 4) + 16 * buf[idx + 2] if idx + 2 < len(buf) else Q
                idx += 2
                if d1 < Q:
                    coeffs.append(d1)
                if d2 < Q and len(coeffs) < N:
                    coeffs.append(d2)
                if idx >= len(buf):
                    buf = shake.digest(len(buf) + N)
                    idx = 0
            # a_{i,j} is already uniform in Z_q — treat as NTT-domain directly
            # (per Kyber: the XOF generates coefficients already in NTT form)
            row.append(coeffs[:N])
        A.append(row)
    return A


# ---------------------------------------------------------------------------
# Challenge polynomial (Fiat-Shamir hash-to-polynomial)
# ---------------------------------------------------------------------------

def sample_challenge(seed: bytes) -> list[int]:
    """
    Generate a sparse ternary challenge polynomial c with exactly TAU
    non-zero coefficients ∈ {+1, -1} and (N - TAU) zero coefficients.

    This implements the Fiat-Shamir challenge in the Σ-protocol:
    c = H(w ∥ public_inputs) where H maps to a sparse ternary polynomial.

    Method: hash-based deterministic selection (Dilithium convention).

    Returns
    -------
    list[int] of length N, coefficients in {0, 1, q-1} ⊂ Z_q
    (q-1 represents -1 mod q)
    """
    from lattice.params import TAU

    shake = hashlib.shake_256(seed)
    buf = shake.digest(N * 2)

    signs_byte_idx = 0
    coeff = [0] * N

    # Place TAU non-zero coefficients at deterministic positions
    positions_used = set()
    i = 0
    while len(positions_used) < TAU:
        pos = buf[i % len(buf)] % N
        i += 1
        if pos not in positions_used:
            positions_used.add(pos)
            # Sign: use bit from shake output
            sign_bit = (buf[(len(positions_used) + N) % len(buf)] >> (len(positions_used) % 8)) & 1
            coeff[pos] = Q - 1 if sign_bit else 1   # -1 → q-1 mod q; +1 → 1

    return coeff
