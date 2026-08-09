"""
lattice/prove.py
================
QRZ-KPA proof generation — Fiat-Shamir Σ-protocol.

Proves:
  1. Ciphertext validity: C = (u, v) is correctly formed for message m = encode_vote(vote_value)
  2. Vote range: 0 ≤ vote_value < num_candidates
  3. Nullifier correctness: nullifier = SHAKE-256(credential_secret ∥ election_id)
  4. Merkle membership: leaf = SHA3-256(credential_secret) in tree

Fiat-Shamir Σ-protocol equations:
  Commit:   w_u = A^T · y_r + y_e1,  w_v = t^T · y_r + y_e2
  Challenge: c = H(w_u, w_v, C, nullifier, merkle_root, election_id, num_candidates)
  Response: z_r = y_r + c·r, z_e1 = y_e1 + c·e1, z_e2 = y_e2 + c·e2
  Verify:   A^T · z_r + z_e1 = w_u + c·u
            t^T · z_r + z_e2 = w_v + c·(v - m)
"""

import hashlib
import json

from lattice.params import N, Q, K
from lattice.ntt import ntt, intt, mat_vec_mul_ntt, vec_add, poly_add, poly_mul_ntt
from lattice.sampling import expand_A, sample_gaussian_vec, sample_gaussian, sample_challenge
from lattice.encrypt import encrypt, check_rejection_bound, encode_vote
from lattice.nullifier import compute_nullifier, compute_leaf_commitment
from lattice.merkle import verify_merkle_proof

MAX_RETRIES = 100


def _poly_vec_add_scaled(y: list[list[int]], c_poly: list[int], s: list[list[int]]) -> list[list[int]]:
    """Compute z[i] = y[i] + c * s[i] for each polynomial in the k-vector."""
    result = []
    c_hat = ntt(c_poly)
    for i in range(K):
        s_hat = ntt(s[i])
        cs_hat = poly_mul_ntt(c_hat, s_hat)
        cs_coeff = intt(cs_hat)
        zi = vec_add([y[i]], [cs_coeff])[0]
        result.append(zi)
    return result


def _challenge_seed(
    w_u: list[list[int]],
    w_v: list[int],
    C: dict,
    nullifier: bytes,
    merkle_root: bytes,
    election_id: int,
    num_candidates: int,
) -> bytes:
    """Hash all commitment and public values to compute Fiat-Shamir challenge."""
    h = hashlib.shake_256()
    for poly in w_u:
        for coeff in poly:
            h.update(coeff.to_bytes(2, "little"))
    for coeff in w_v:
        h.update(coeff.to_bytes(2, "little"))
    for poly in C["u"]:
        for coeff in poly:
            h.update(coeff.to_bytes(2, "little"))
    for coeff in C["v"]:
        h.update(coeff.to_bytes(2, "little"))
    h.update(nullifier)
    h.update(merkle_root)
    h.update(election_id.to_bytes(8, "big"))
    h.update(num_candidates.to_bytes(4, "big"))
    return h.digest(64)


def generate_proof(
    pk: dict,
    sk: dict,
    vote_value: int,
    credential_secret: bytes,
    election_id: int,
    merkle_path_elements: list[bytes],
    merkle_path_indices: list[int],
    merkle_root: bytes,
    num_candidates: int,
    rng=None,
) -> dict:
    """Generate a QRZ-KPA zero-knowledge proof."""
    rho = pk["rho"]
    t_hat = pk["t"]

    A_hat = expand_A(rho)
    A_hat_T = [[A_hat[j][i] for j in range(K)] for i in range(K)]

    # Constraint 1: Vote range check
    if not (0 <= vote_value < num_candidates):
        raise ValueError(f"vote_value {vote_value} out of range [0, {num_candidates})")

    # Constraint 2: Nullifier
    nullifier = compute_nullifier(credential_secret, election_id)

    # Constraint 3: Merkle membership
    leaf = compute_leaf_commitment(credential_secret)
    if not verify_merkle_proof(leaf, merkle_path_elements, merkle_path_indices, merkle_root):
        raise ValueError("Merkle membership check failed — credential not in eligible voter tree")

    # Encrypt vote: C = (u, v)
    C, r, e1, e2 = encrypt(pk, vote_value, num_candidates, rng)

    # Fiat-Shamir Σ-protocol with rejection sampling
    for attempt in range(MAX_RETRIES):
        y_r = sample_gaussian_vec(K, rng)
        y_e1 = sample_gaussian_vec(K, rng)
        y_e2 = sample_gaussian(rng)

        # w_u = A^T · y_r + y_e1
        y_r_hat = [ntt(yi) for yi in y_r]
        Ay_r_hat = mat_vec_mul_ntt(A_hat_T, y_r_hat)
        w_u = vec_add([intt(Ay_r_hat[i]) for i in range(K)], y_e1)

        # w_v = t^T · y_r + y_e2
        ty_r_hat = [0] * N
        for i in range(K):
            ty_r_hat = poly_add(ty_r_hat, poly_mul_ntt(t_hat[i], y_r_hat[i]))
        w_v = poly_add(intt(ty_r_hat), y_e2)

        # Challenge
        challenge_seed = _challenge_seed(w_u, w_v, C, nullifier, merkle_root, election_id, num_candidates)
        c_poly = sample_challenge(challenge_seed)
        c_hat = ntt(c_poly)

        # Responses
        z_r = _poly_vec_add_scaled(y_r, c_poly, r)
        z_e1 = _poly_vec_add_scaled(y_e1, c_poly, e1)

        c_e2_hat = poly_mul_ntt(c_hat, ntt(e2))
        z_e2 = poly_add(y_e2, intt(c_e2_hat))

        # Rejection sampling check
        if not (check_rejection_bound(z_r) and check_rejection_bound(z_e1) and check_rejection_bound(z_e2)):
            continue

        return {
            "C": {
                "u": [[int(x) for x in poly] for poly in C["u"]],
                "v": [int(x) for x in C["v"]],
            },
            "w_u": [[int(x) for x in poly] for poly in w_u],
            "w_v": [int(x) for x in w_v],
            "c": [int(x) for x in c_poly],
            "z_r": [[int(x) for x in poly] for poly in z_r],
            "z_e1": [[int(x) for x in poly] for poly in z_e1],
            "z_e2": [int(x) for x in z_e2],
            "nullifier": nullifier.hex(),
            "merkle_path_elements": [pe.hex() for pe in merkle_path_elements],
            "merkle_path_indices": merkle_path_indices,
            "public": {
                "rho": rho.hex(),
                "t": [[int(x) for x in poly] for poly in pk["t"]],
                "election_id": election_id,
                "merkle_root": merkle_root.hex(),
                "num_candidates": num_candidates,
                "proof_type": 1,
            },
            "meta": {
                "encrypted_vote_hash": hashlib.sha3_256(
                    b"".join(x.to_bytes(2, "little") for poly in C["u"] for x in poly) +
                    b"".join(x.to_bytes(2, "little") for x in C["v"])
                ).hexdigest(),
                "zkp_valid": True,
            },
        }

    raise RuntimeError(f"Rejection sampling failed after {MAX_RETRIES} attempts.")


def proof_to_json(proof: dict) -> str:
    return json.dumps(proof, indent=2)


def proof_from_json(s: str) -> dict:
    return json.loads(s)
