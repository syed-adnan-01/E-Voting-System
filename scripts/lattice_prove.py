#!/usr/bin/env python3
"""
scripts/lattice_prove.py
========================
CLI prover for the QRZ-KPA post-quantum proving track.

Mirrors the interface of scripts/prove_vote.js (Phase 1 classical track)
but uses the lattice-based construction from the paper.

Usage
-----
    source venv/bin/activate
    python scripts/lattice_prove.py --vote 2
    python scripts/lattice_prove.py --vote 1 --secret deadbeef01234567 --election-id 1 --num-candidates 4

Outputs
-------
    build/lattice_proof.json   — full proof (C, w, c, z, nullifier, merkle path, public)
    build/lattice_public.json  — public inputs only (for verifier and on-chain submission)

Default credential_secret is the same test value used in prove_vote.js
(hex of "123456789") for easy side-by-side comparison.
"""

import argparse
import json
import os
import sys
import time

# Allow running from project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lattice.keygen import keygen
from lattice.prove import generate_proof, proof_to_json
from lattice.merkle import build_demo_tree, TREE_DEPTH

# Match the test credential used in prove_vote.js for fair comparison
DEFAULT_SECRET_HEX = "313233343536373839"   # hex("123456789")
DEFAULT_ELECTION_ID = 1
DEFAULT_NUM_CANDIDATES = 4
DEFAULT_LEAF_INDEX = 0

BUILD_DIR = os.path.join(os.path.dirname(__file__), "..", "build")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a QRZ-KPA lattice-based zero-knowledge proof for a vote."
    )
    parser.add_argument("--vote", type=int, default=1,
                        help="Candidate index to vote for (0-based, default: 1)")
    parser.add_argument("--secret", type=str, default=DEFAULT_SECRET_HEX,
                        help="Credential secret as hex string (default: test value matching prove_vote.js)")
    parser.add_argument("--election-id", type=int, default=DEFAULT_ELECTION_ID,
                        help="Election identifier (default: 1)")
    parser.add_argument("--num-candidates", type=int, default=DEFAULT_NUM_CANDIDATES,
                        help="Number of candidates (default: 4)")
    parser.add_argument("--leaf-index", type=int, default=DEFAULT_LEAF_INDEX,
                        help="Voter's leaf index in Merkle tree (default: 0)")
    parser.add_argument("--out-dir", type=str, default=BUILD_DIR,
                        help="Output directory for proof JSON files (default: build/)")
    args = parser.parse_args()

    credential_secret = bytes.fromhex(args.secret)
    vote_value = args.vote
    election_id = args.election_id
    num_candidates = args.num_candidates
    leaf_index = args.leaf_index

    # Validate vote range before doing any work
    if not (0 <= vote_value < num_candidates):
        print(f"ERROR: vote value {vote_value} is out of range [0, {num_candidates})")
        print(f"       This mirrors the circuit constraint in vote.circom:57")
        sys.exit(1)

    print(f"=== QRZ-KPA Proof Generation (Post-Quantum Track) ===")
    print(f"  Vote choice     : {vote_value}")
    print(f"  Election ID     : {election_id}")
    print(f"  Num candidates  : {num_candidates}")
    print(f"  Tree depth      : {TREE_DEPTH}")
    print()

    t0 = time.perf_counter()

    # Key generation (in a real system, pk is the election public key stored by the registrar)
    print("[1/4] Generating Ring-LWE key pair ...")
    pk, sk = keygen()

    # Build demo Merkle tree with the voter's leaf
    print("[2/4] Building SHA3-256 Merkle tree ...")
    tree, merkle_proof_data = build_demo_tree(credential_secret, leaf_index)
    merkle_root = tree.root
    path_elements = merkle_proof_data["path_elements"]
    path_indices  = merkle_proof_data["path_indices"]

    # Generate QRZ-KPA proof
    print("[3/4] Running Fiat-Shamir Σ-protocol (this may retry for rejection sampling) ...")
    proof = generate_proof(
        pk=pk,
        sk=sk,
        vote_value=vote_value,
        credential_secret=credential_secret,
        election_id=election_id,
        merkle_path_elements=path_elements,
        merkle_path_indices=path_indices,
        merkle_root=merkle_root,
        num_candidates=num_candidates,
    )

    t_elapsed = time.perf_counter() - t0

    # Save outputs
    print("[4/4] Saving proof artefacts ...")
    os.makedirs(args.out_dir, exist_ok=True)

    proof_path  = os.path.join(args.out_dir, "lattice_proof.json")
    public_path = os.path.join(args.out_dir, "lattice_public.json")

    with open(proof_path, "w") as f:
        f.write(proof_to_json(proof))

    public_signals = {
        "election_id"     : proof["public"]["election_id"],
        "merkle_root"     : proof["public"]["merkle_root"],
        "nullifier"       : proof["nullifier"],
        "num_candidates"  : proof["public"]["num_candidates"],
        "proof_type"      : proof["public"]["proof_type"],
    }
    with open(public_path, "w") as f:
        json.dump(public_signals, f, indent=2)

    print()
    print("=== QRZ-KPA Proof Generation Successful ===")
    print(f"  Proof generation time : {t_elapsed*1000:.1f} ms")
    print(f"  Nullifier             : {proof['nullifier'][:16]}...")
    print(f"  Merkle root           : {proof['public']['merkle_root'][:16]}...")
    print(f"  Proof type            : {proof['public']['proof_type']} (1 = lattice/QRZ-KPA)")
    print(f"  Proof saved to        : {proof_path}")
    print(f"  Public signals saved  : {public_path}")


if __name__ == "__main__":
    main()
