"""
lattice/encrypt.py
==================
Vote encryption using Module-LWE (Kyber-style) public key encryption.

From the paper (ICCC 2025 §II):
  "In the first step, from the public key pk = (ρ, t₁), a matrix (A) is generated
   in the Number Theoretic Transform (NTT) domain ...
   Next two vectors are generated: s' secret vector, e' error vector.
   The ciphertext C is computed using the formula: C = A·s' + e' + vote_value"

Here C = (u, v) where:
  u = A^T · r + e1      (k-vector of polynomials)
  v = t^T · r + e2 + m  (scalar polynomial)
  r (s'), e1 (e'), e2 are Gaussian noise vectors/scalars.
"""

from lattice.params import N, Q, K, REJECTION_BOUND, vote_scale
from lattice.ntt import ntt, intt, mat_vec_mul_ntt, vec_add, poly_add, poly_sub, poly_mul_ntt
from lattice.sampling import expand_A, sample_gaussian_vec, sample_gaussian


def encode_vote(vote_value: int, num_candidates: int) -> list[int]:
    """Encode an integer vote value into a ring polynomial in Z_q[x]/(x^n+1)."""
    if not (0 <= vote_value < num_candidates):
        raise ValueError(f"vote_value {vote_value} out of range [0, {num_candidates})")
    scale = vote_scale(num_candidates)
    m = [0] * N
    m[0] = (vote_value * scale) % Q
    return m


def decode_vote(m_poly: list[int], num_candidates: int) -> int:
    """Decode vote value from a polynomial using nearest-multiple rounding."""
    scale = vote_scale(num_candidates)
    raw = m_poly[0] % Q
    return round(raw / scale) % num_candidates


def encrypt(pk: dict, vote_value: int, num_candidates: int, rng=None) -> tuple[dict, list[list[int]], list[list[int]], list[int]]:
    """
    Encrypt a vote using Module-LWE encryption: C = (u, v)

    Parameters
    ----------
    pk             : dict with 'rho' (32 bytes) and 't' (k-vector of NTT polynomials)
    vote_value     : candidate index (0-based)
    num_candidates : total number of candidates
    rng            : optional numpy RNG for deterministic testing

    Returns
    -------
    C  : dict {'u': k-vector of polys, 'v': poly}
    r  : k-vector of Gaussian polynomials (secret randomness)
    e1 : k-vector of Gaussian polynomials (error)
    e2 : single Gaussian polynomial (error)
    """
    rho = pk["rho"]
    t_hat = pk["t"]

    A_hat = expand_A(rho)
    A_hat_T = [[A_hat[j][i] for j in range(K)] for i in range(K)]

    r = sample_gaussian_vec(K, rng)
    e1 = sample_gaussian_vec(K, rng)
    e2 = sample_gaussian(rng)

    # u = A^T · r + e1
    r_hat = [ntt(ri) for ri in r]
    u_hat = mat_vec_mul_ntt(A_hat_T, r_hat)
    u = vec_add([intt(u_hat[i]) for i in range(K)], e1)

    # v = t^T · r + e2 + m
    tr_hat = [0] * N
    for i in range(K):
        tr_hat = poly_add(tr_hat, poly_mul_ntt(t_hat[i], r_hat[i]))
    tr_coeff = intt(tr_hat)

    m_poly = encode_vote(vote_value, num_candidates)
    v = poly_add(poly_add(tr_coeff, e2), m_poly)

    C = {"u": u, "v": v}
    return C, r, e1, e2


def decrypt(sk: dict, C: dict, num_candidates: int) -> int:
    """Decrypt a ciphertext C = (u, v) using secret key sk = (s, e, rho)."""
    s = sk["s"]
    u = C["u"]
    v = C["v"]

    s_hat = [ntt(si) for si in s]
    u_hat = [ntt(ui) for ui in u]

    su_hat = [0] * N
    for i in range(K):
        su_hat = poly_add(su_hat, poly_mul_ntt(s_hat[i], u_hat[i]))
    su_coeff = intt(su_hat)

    diff = poly_sub(v, su_coeff)
    return decode_vote(diff, num_candidates)


def check_rejection_bound(z: list[list[int]] | list[int]) -> bool:
    """Check ||z||_∞ < REJECTION_BOUND (centred representation)."""
    items = z if isinstance(z[0], list) else [z]
    for poly in items:
        for coeff in poly:
            c = coeff % Q
            if c > Q // 2:
                c -= Q
            if abs(c) >= REJECTION_BOUND:
                return False
    return True
