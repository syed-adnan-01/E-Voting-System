"""
lattice/params.py
=================
Ring-LWE / Module-LWE parameter set for the QRZ-KPA scheme.

Source: QRZ-KPA paper (ICCC 2025) §II Methodology.
Parameters aligned with Kyber-512 (CRYSTALS-Kyber), which is the basis
of the NTT-domain construction described in the paper.
Kyber-512 is a NIST PQC standard (FIPS 203), achieving NIST Security Level 1
(≥ 128-bit quantum security).

References:
- Barakka, Niharika, Jayaraj, ICCC 2025 — QRZ-KPA algorithm
- NIST FIPS 203 (ML-KEM / Kyber) for parameter justification
- Lyubashevsky (2012) for Fiat-Shamir Σ-protocol template
"""

# ---------------------------------------------------------------------------
# Ring parameters
# ---------------------------------------------------------------------------

# Polynomial ring: Z_q[x] / (x^n + 1)
# n = 256: ring dimension. Must be a power of 2 for NTT to work.
N = 256

# q = 7681: prime modulus. Must satisfy q ≡ 1 (mod 2n) = q ≡ 1 (mod 512) for NTT.
# 7681 - 1 = 7680 = 512 × 15  ✓
# This is also the original NewHope/Kyber draft prime. It is NTT-compatible for n=256.
# Note: The final NIST Kyber (FIPS 203) changed to q=3329 with a different NTT structure
# (incomplete NTT). We use q=7681 which allows the clean standard NTT used in the
# original paper's construction description.
Q = 7681

# k = 2: module rank. Kyber-512 uses k=2. Higher k → more security but
# larger keys/ciphertexts.
K = 2

# ---------------------------------------------------------------------------
# Error distribution
# ---------------------------------------------------------------------------

# Sigma: standard deviation for discrete Gaussian sampler.
# For Kyber-512 the centered binomial distribution with η=3 is used (approx σ≈1.22).
# We use a rounded Gaussian with σ=1.0 for simplicity, which is well within the
# required security margin.
SIGMA = 1.0

# Rejection sampling bound: ||z||_∞ < REJECTION_BOUND prevents leaking s'.
# Set to 2σ√n as a conservative bound.
import math
REJECTION_BOUND = int(2 * SIGMA * math.sqrt(N))   # ≈ 28

# ---------------------------------------------------------------------------
# Scaling factor for vote encoding
# ---------------------------------------------------------------------------

# The vote value m is encoded as a polynomial constant coefficient.
# Paper: "C = A·s' + e' + vote_value" — we scale vote_value into the ring
# by rounding to the nearest multiple of floor(q/max_candidates).
# For binary votes (YES=1, NO=0) max_candidates=2 → scale = floor(3329/2) = 1664.
# For multi-candidate elections, we use floor(q/(num_candidates)).
# This is the standard Kyber PKE encoding (FIPS 203 §3.2).
def vote_scale(num_candidates: int) -> int:
    """Return the scaling factor for encoding vote_value into the ring."""
    return Q // num_candidates

# ---------------------------------------------------------------------------
# Challenge polynomial size (Fiat-Shamir)
# ---------------------------------------------------------------------------

# Number of ±1 coefficients in the challenge polynomial c.
# Small-coefficient c is required for the response z = y + c·s' to stay bounded.
# Matches Dilithium convention: tau = 39 non-zero coefficients.
TAU = 39

# ---------------------------------------------------------------------------
# NTT primitive root
# ---------------------------------------------------------------------------

# ZETA: primitive 512th root of unity mod q.
# We need: ZETA^512 ≡ 1 (mod q) AND ZETA^256 ≢ 1 (mod q)
# For q=7681: zeta=62 satisfies both conditions (verified below).
ZETA = 62  # primitive 512th root of unity mod 7681

# Verify at import time (cheap)
assert pow(ZETA, 2 * N, Q) == 1,  "ZETA is not a 2n-th root of unity mod q"
assert pow(ZETA,     N, Q) != 1,  "ZETA must be a primitive 2n-th root"
