#!/usr/bin/env bash
# ==============================================================================
# PQ-ZKVote — Post-Quantum Zero-Knowledge E-Voting System Demo Script
# ==============================================================================
# Executes complete automated 100-voter election end-to-end:
# Registrar -> Register -> Approve -> Merkle Tree -> 100 Votes (50 Groth16 / 50 Lattice)
# -> On-Chain Ledger -> Anomaly Stream -> Tally -> Independent Audit Verification
# ==============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "------------------------------------------------------------------------"
echo "  PQ-ZKVote: Post-Quantum Zero-Knowledge E-Voting One-Command Demo"
echo "------------------------------------------------------------------------"

# Pre-flight check: verify build artifacts exist
if [ ! -f "build/vote_js/vote.wasm" ] || [ ! -f "build/vote_final.zkey" ]; then
    echo "[!] Circuit build artifacts missing. Compiling circuit..."
    ./scripts/compile_circuit.sh
fi

echo "[+] Launching automated 100-voter test election..."
(cd contracts && NUM_VOTERS="${NUM_VOTERS:-100}" NODE_PATH=node_modules npx hardhat run ../scripts/run_e2e_election.js)

echo "[+] Demo completed successfully!"
