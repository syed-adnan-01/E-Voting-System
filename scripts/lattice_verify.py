#!/usr/bin/env python3
"""
scripts/lattice_verify.py
=========================
CLI verifier for the QRZ-KPA post-quantum proving track.
"""

import argparse
import copy
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lattice.verify import verify_proof, get_zkp_validity_flag
from lattice.prove import proof_from_json

BUILD_DIR = os.path.join(os.path.dirname(__file__), "..", "build")
DEFAULT_PROOF_PATH = os.path.join(BUILD_DIR, "lattice_proof.json")


def load_proof(path: str) -> dict:
    with open(path) as f:
        return proof_from_json(f.read())


def tamper_ciphertext(proof: dict) -> dict:
    """Flip a bit in C['u'][0][0] — simulates a forged/corrupted ciphertext."""
    p = copy.deepcopy(proof)
    p["C"]["u"][0][0] = (p["C"]["u"][0][0] + 1000) % 7681
    return p


def tamper_nullifier(proof: dict) -> dict:
    """Replace nullifier with a forged value."""
    p = copy.deepcopy(proof)
    orig = bytes.fromhex(p["nullifier"])
    forged = bytes(b ^ 0xFF for b in orig)
    p["nullifier"] = forged.hex()
    return p


def tamper_challenge(proof: dict) -> dict:
    """Flip a bit in c[0] — breaks challenge integrity."""
    p = copy.deepcopy(proof)
    p["c"][0] = (p["c"][0] + 1) % 7681
    return p


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify a QRZ-KPA lattice-based zero-knowledge proof."
    )
    parser.add_argument("--proof-path", type=str, default=DEFAULT_PROOF_PATH,
                        help=f"Path to proof JSON (default: {DEFAULT_PROOF_PATH})")
    parser.add_argument("--tamper-ciphertext", action="store_true",
                        help="Tamper with C before verifying (negative test)")
    parser.add_argument("--tamper-nullifier", action="store_true",
                        help="Tamper with nullifier before verifying (negative test)")
    parser.add_argument("--tamper-challenge", action="store_true",
                        help="Tamper with challenge c before verifying (negative test)")
    args = parser.parse_args()

    if not os.path.exists(args.proof_path):
        print(f"ERROR: Proof file not found: {args.proof_path}")
        print("       Run 'python scripts/lattice_prove.py' first to generate a proof.")
        sys.exit(1)

    print(f"=== QRZ-KPA Proof Verifier (Post-Quantum Track) ===")

    proof = load_proof(args.proof_path)

    if args.tamper_ciphertext:
        print("[!] TAMPERING MODE: flipping ciphertext C['u'][0][0]")
        proof = tamper_ciphertext(proof)
    if args.tamper_nullifier:
        print("[!] TAMPERING MODE: replacing nullifier with forged value")
        proof = tamper_nullifier(proof)
    if args.tamper_challenge:
        print("[!] TAMPERING MODE: flipping challenge c[0]")
        proof = tamper_challenge(proof)

    print(f"  Election ID     : {proof['public']['election_id']}")
    print(f"  Merkle root     : {proof['public']['merkle_root'][:16]}...")
    print(f"  Nullifier       : {proof['nullifier'][:16]}...")
    print(f"  Num candidates  : {proof['public']['num_candidates']}")
    print(f"  Proof type      : {proof['public']['proof_type']} (1 = lattice/QRZ-KPA)")
    print()

    t0 = time.perf_counter()
    valid, reason = verify_proof(proof)
    elapsed = (time.perf_counter() - t0) * 1000

    print(f"  Verification time : {elapsed:.1f} ms")
    print()

    if valid:
        print("=== QRZ-KPA Verification SUCCESS ===")
        print("  ✓ Rejection bounds satisfied")
        print("  ✓ Fiat-Shamir challenge consistent")
        print("  ✓ Ring equation 1: A^T·z_r + z_e1 = w_u + c·u verified")
        print("  ✓ Ring equation 2: t^T·z_r + z_e2 = w_v + c·(v-m) verified")
        print("  ✓ Nullifier format valid (32-byte SHAKE-256)")
        print("  ✓ Merkle path structure valid")
        print("  ✓ Vote range valid")
        print()
        print("  ZKP validity flag (anomaly feature) :", get_zkp_validity_flag(proof))
        sys.exit(0)
    else:
        print("=== QRZ-KPA Verification FAILED ===")
        print(f"  Reason: {reason}")
        sys.exit(1)


if __name__ == "__main__":
    main()
