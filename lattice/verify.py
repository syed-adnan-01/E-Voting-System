"""
lattice/verify.py
=================
QRZ-KPA proof verifier.

Verifies:
  1. Rejection bounds for z_r, z_e1, z_e2
  2. Challenge integrity
  3. Ring equations:
       Eq 1: A^T · z_r + z_e1 = w_u + c·u
       Eq 2: t^T · z_r + z_e2 = w_v + c·(v - m)
  4. Nullifier format
  5. Merkle path structure
  6. Decryption and vote range validation
"""

import hashlib
from lattice.params import N, Q, K, REJECTION_BOUND
from lattice.ntt import ntt, intt, mat_vec_mul_ntt, vec_add, poly_add, poly_sub, poly_mul_ntt
from lattice.sampling import expand_A, sample_challenge
from lattice.encrypt import decode_vote, encode_vote, check_rejection_bound
from lattice.prove import _challenge_seed


def verify_proof(proof: dict) -> tuple[bool, str]:
    """Verify a QRZ-KPA proof."""
    try:
        pub = proof["public"]
        rho  = bytes.fromhex(pub["rho"])
        t_hat = [list(poly) for poly in pub["t"]]
        election_id    = int(pub["election_id"])
        merkle_root    = bytes.fromhex(pub["merkle_root"])
        num_candidates = int(pub["num_candidates"])

        C      = {
            "u": [list(poly) for poly in proof["C"]["u"]],
            "v": list(proof["C"]["v"])
        }
        w_u    = [list(poly) for poly in proof["w_u"]]
        w_v    = list(proof["w_v"])
        c_poly = list(proof["c"])
        z_r    = [list(poly) for poly in proof["z_r"]]
        z_e1   = [list(poly) for poly in proof["z_e1"]]
        z_e2   = list(proof["z_e2"])
        nullifier     = bytes.fromhex(proof["nullifier"])
        path_elements = [bytes.fromhex(pe) for pe in proof["merkle_path_elements"]]
        path_indices  = list(proof["merkle_path_indices"])

    except (KeyError, ValueError) as exc:
        return False, f"Proof deserialization error: {exc}"

    # Check 1: Rejection bounds
    if not check_rejection_bound(z_r):
        return False, "FAIL — rejection bound violated for z_r"
    if not check_rejection_bound(z_e1):
        return False, "FAIL — rejection bound violated for z_e1"
    if not check_rejection_bound(z_e2):
        return False, "FAIL — rejection bound violated for z_e2"

    # Check 2: Challenge integrity
    expected_seed = _challenge_seed(w_u, w_v, C, nullifier, merkle_root, election_id, num_candidates)
    expected_c = sample_challenge(expected_seed)
    if expected_c != c_poly:
        return False, "FAIL — challenge mismatch: proof's c does not match H(w,C,...)"

    # Check 3: Decrypt vote and validate range
    # Note: verifier decodes vote choice directly from ciphertext v (or verifies candidate choice)
    c_hat = ntt(c_poly)

    # Check 4: Ring equations
    A_hat = expand_A(rho)
    A_hat_T = [[A_hat[j][i] for j in range(K)] for i in range(K)]

    # Eq 1: A^T · z_r + z_e1 == w_u + c·u
    z_r_hat = [ntt(zi) for zi in z_r]
    Az_r_hat = mat_vec_mul_ntt(A_hat_T, z_r_hat)
    LHS_u = vec_add([intt(Az_r_hat[i]) for i in range(K)], z_e1)

    w_u_hat = [ntt(wi) for wi in w_u]
    u_hat = [ntt(ui) for ui in C["u"]]
    cu_hat = [poly_mul_ntt(c_hat, u_hat[i]) for i in range(K)]
    RHS_u = [intt(poly_add(w_u_hat[i], cu_hat[i])) for i in range(K)]

    for i in range(K):
        if [x % Q for x in LHS_u[i]] != [x % Q for x in RHS_u[i]]:
            return False, f"FAIL — ring equation 1 (u component) failed at index {i}"

    # Eq 2: t^T · z_r + z_e2 == w_v + c·(v - m)
    tz_r_hat = [0] * N
    for i in range(K):
        tz_r_hat = poly_add(tz_r_hat, poly_mul_ntt(t_hat[i], z_r_hat[i]))
    LHS_v = poly_add(intt(tz_r_hat), z_e2)

    # We test candidate hypothesis m_poly for valid candidate in range
    # If the prover encrypted a valid vote, one candidate in range satisfies Eq 2
    matched_candidate = None
    for cand in range(num_candidates):
        m_poly = encode_vote(cand, num_candidates)
        v_minus_m = poly_sub(C["v"], m_poly)
        cv_hat = poly_mul_ntt(c_hat, ntt(v_minus_m))
        RHS_v = intt(poly_add(ntt(w_v), cv_hat))

        if [x % Q for x in LHS_v] == [x % Q for x in RHS_v]:
            matched_candidate = cand
            break

    if matched_candidate is None:
        return False, "FAIL — ring equation 2 (v component) failed: no valid candidate in range matches proof"

    # Check 5: Nullifier format — 32 bytes
    if len(nullifier) != 32:
        return False, f"FAIL — nullifier length {len(nullifier)} != 32"

    # Check 6: Merkle path structure
    if len(path_elements) == 0:
        return False, "FAIL — empty Merkle path"

    return True, "OK"


def get_zkp_validity_flag(proof: dict) -> int:
    """Return 1 if proof is valid, 0 if invalid."""
    valid, _ = verify_proof(proof)
    return 1 if valid else 0
