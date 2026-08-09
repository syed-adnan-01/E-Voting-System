"""
lattice/ntt.py
==============
Number Theoretic Transform (NTT) for fast polynomial multiplication.

The QRZ-KPA paper (ICCC 2025 §II) specifies that "a matrix (A) is generated
in the Number Theoretic Transform (NTT) domain, forming the base for the
encryption process." This module implements that NTT domain.

NTT is the exact equivalent of FFT but over Z_q instead of the complex numbers.
It allows polynomial multiplication mod (x^n + 1, q) in O(n log n) instead
of O(n^2). This is the speed advantage the paper refers to.

Implementation follows Algorithm 1 of FIPS 203 (ML-KEM specification).
"""

from lattice.params import N, Q, ZETA
import numpy as np


# ---------------------------------------------------------------------------
# Precompute powers of zeta for bit-reversed NTT
# ---------------------------------------------------------------------------

def _precompute_zetas() -> list[int]:
    """
    Precompute zeta^(br(i)) for i = 0..n-1, where br is the bit-reversal.
    This table matches FIPS 203 Table 1 layout.
    """
    def bit_reverse(k: int, bits: int) -> int:
        result = 0
        for _ in range(bits):
            result = (result << 1) | (k & 1)
            k >>= 1
        return result

    log_n = N.bit_length() - 1  # = 8 for n=256
    zetas = []
    for i in range(N):
        br_i = bit_reverse(i, log_n)
        zetas.append(pow(ZETA, br_i, Q))
    return zetas

_ZETAS = _precompute_zetas()


# ---------------------------------------------------------------------------
# Core NTT / INTT
# ---------------------------------------------------------------------------

def ntt(f: list[int]) -> list[int]:
    """
    Forward NTT of polynomial f ∈ Z_q[x]/(x^n + 1).

    Input : coefficient list f[0..n-1] in Z_q
    Output: NTT representation f̂[0..n-1] in Z_q (in-place semantics, returns new list)

    Algorithm: Cooley-Tukey butterfly, bit-reversed output order
    (matches Kyber/FIPS 203 Algorithm 9 NTT).
    """
    a = list(f)
    k = 1
    length = N >> 1  # 128
    while length >= 1:
        start = 0
        while start < N:
            zeta = _ZETAS[k]
            k += 1
            for j in range(start, start + length):
                t = (zeta * a[j + length]) % Q
                a[j + length] = (a[j] - t) % Q
                a[j] = (a[j] + t) % Q
            start += 2 * length
        length >>= 1
    return a


def intt(f_hat: list[int]) -> list[int]:
    """
    Inverse NTT of f̂ back to coefficient form.

    Algorithm: Gentleman-Sande butterfly (matches FIPS 203 Algorithm 10 NTTInv).
    """
    a = list(f_hat)
    k = N - 1
    length = 1
    while length <= N >> 1:
        start = 0
        while start < N:
            zeta = _ZETAS[k]
            k -= 1
            for j in range(start, start + length):
                t = a[j]
                a[j] = (t + a[j + length]) % Q
                a[j + length] = (zeta * (a[j + length] - t)) % Q
            start += 2 * length
        length <<= 1
    # Scale by n^{-1} mod q
    n_inv = pow(N, Q - 2, Q)   # Fermat's little theorem: n^{q-2} mod q
    a = [(n_inv * x) % Q for x in a]
    return a


def poly_mul_ntt(a_hat: list[int], b_hat: list[int]) -> list[int]:
    """
    Pointwise multiplication in NTT domain (= polynomial multiplication mod x^n+1, q).
    Both inputs must already be in NTT form.
    """
    return [(a_hat[i] * b_hat[i]) % Q for i in range(N)]


def poly_add(a: list[int], b: list[int]) -> list[int]:
    """Coefficient-wise polynomial addition mod q."""
    return [(a[i] + b[i]) % Q for i in range(N)]


def poly_sub(a: list[int], b: list[int]) -> list[int]:
    """Coefficient-wise polynomial subtraction mod q."""
    return [(a[i] - b[i]) % Q for i in range(N)]


def poly_scale(a: list[int], scalar: int) -> list[int]:
    """Coefficient-wise scalar multiplication mod q."""
    return [(scalar * x) % Q for x in a]


# ---------------------------------------------------------------------------
# Matrix × vector in NTT domain
# ---------------------------------------------------------------------------

def mat_vec_mul_ntt(A_hat: list[list[list[int]]], v_hat: list[list[int]]) -> list[list[int]]:
    """
    Matrix-vector product in NTT domain.
    A_hat: k×k matrix of NTT-form polynomials
    v_hat: k-length vector of NTT-form polynomials
    Returns: k-length vector of NTT-form polynomials

    This is the operation A·s used in the paper's key generation and encryption.
    """
    k = len(A_hat)
    result = [[0] * N for _ in range(k)]
    for i in range(k):
        for j in range(k):
            product = poly_mul_ntt(A_hat[i][j], v_hat[j])
            result[i] = poly_add(result[i], product)
    return result


def vec_add(u: list[list[int]], v: list[list[int]]) -> list[list[int]]:
    """Element-wise vector addition of two k-vectors of polynomials."""
    return [poly_add(u[i], v[i]) for i in range(len(u))]
