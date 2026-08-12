#!/usr/bin/env python3
"""
benchmarks/run_benchmarks.py
============================
PQ-ZKVote Classical vs. PQC Benchmark Suite

Measures both proving systems (Groth16 classical and QRZ-KPA lattice-based
post-quantum) across five metrics:

  1. Proof generation time (wall clock, N runs, mean + stddev)
  2. Verification time (same methodology)
  3. Proof size in bytes
  4. On-chain gas cost (Hardhat gas reporter)
  5. Peak memory usage during proving

Outputs:
  benchmarks/results.csv  — raw data
  benchmarks/report.md    — summary table + discussion

Usage:
  python benchmarks/run_benchmarks.py           # Full run (N=100)
  python benchmarks/run_benchmarks.py --quick   # Quick validation (N=5)
  python benchmarks/run_benchmarks.py --runs 50 # Custom N

Requirements:
  - Python venv active with lattice package importable
  - Node.js with snarkjs installed (npm install in project root)
  - Compiled circuit artifacts in build/ (run scripts/compile_circuit.sh)
  - Hardhat contracts compiled (cd contracts && npx hardhat compile)
"""

import argparse
import csv
import json
import math
import os
import platform
import subprocess
import sys
import time
import tracemalloc

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BENCHMARKS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

# ---------------------------------------------------------------------------
# Lattice imports
# ---------------------------------------------------------------------------
from lattice.keygen import keygen
from lattice.prove import generate_proof, proof_to_json
from lattice.verify import verify_proof
from lattice.merkle import build_demo_tree, TREE_DEPTH
from lattice.nullifier import compute_nullifier, compute_leaf_commitment

# ---------------------------------------------------------------------------
# Constants (matching test defaults in prove_vote.js / lattice_prove.py)
# ---------------------------------------------------------------------------
DEFAULT_SECRET_HEX = "313233343536373839"  # hex("123456789")
DEFAULT_ELECTION_ID = 1
DEFAULT_NUM_CANDIDATES = 4
DEFAULT_LEAF_INDEX = 0


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / (len(values) - 1))


# ============================================================================
# Lattice (PQC) Benchmarks
# ============================================================================

def bench_lattice(n_runs: int) -> dict:
    """Benchmark the QRZ-KPA lattice-based proving track."""
    credential_secret = bytes.fromhex(DEFAULT_SECRET_HEX)

    print(f"\n{'='*60}")
    print(f"  LATTICE (QRZ-KPA) BENCHMARK — {n_runs} runs")
    print(f"{'='*60}")

    # --- Setup (not timed) ---
    print("[lattice] Generating key pair...")
    pk, sk = keygen()

    print("[lattice] Building Merkle tree...")
    tree, merkle_data = build_demo_tree(credential_secret, DEFAULT_LEAF_INDEX)
    merkle_root = tree.root
    path_elements = merkle_data["path_elements"]
    path_indices = merkle_data["path_indices"]

    # --- 1. Proof generation benchmark ---
    prove_times = []
    last_proof = None

    # Warm-up
    print("[lattice] Warm-up run...")
    _ = generate_proof(
        pk=pk, sk=sk, vote_value=1,
        credential_secret=credential_secret,
        election_id=DEFAULT_ELECTION_ID,
        merkle_path_elements=path_elements,
        merkle_path_indices=path_indices,
        merkle_root=merkle_root,
        num_candidates=DEFAULT_NUM_CANDIDATES,
    )

    print(f"[lattice] Running {n_runs} proof generation iterations...")
    tracemalloc.start()
    peak_memory = 0

    for i in range(n_runs):
        tracemalloc.reset_peak()
        t0 = time.perf_counter()
        proof = generate_proof(
            pk=pk, sk=sk, vote_value=1,
            credential_secret=credential_secret,
            election_id=DEFAULT_ELECTION_ID,
            merkle_path_elements=path_elements,
            merkle_path_indices=path_indices,
            merkle_root=merkle_root,
            num_candidates=DEFAULT_NUM_CANDIDATES,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _, current_peak = tracemalloc.get_traced_memory()
        peak_memory = max(peak_memory, current_peak)

        prove_times.append(elapsed_ms)
        last_proof = proof

        if (i + 1) % max(1, n_runs // 10) == 0:
            print(f"  [prove] {i + 1}/{n_runs} ({elapsed_ms:.1f} ms)")

    tracemalloc.stop()

    # --- 2. Verification benchmark ---
    verify_times = []

    print(f"[lattice] Running {n_runs} verification iterations...")
    for i in range(n_runs):
        t0 = time.perf_counter()
        valid, reason = verify_proof(last_proof)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        verify_times.append(elapsed_ms)

        if not valid:
            print(f"  WARNING: Verification failed at iteration {i}: {reason}")

        if (i + 1) % max(1, n_runs // 10) == 0:
            print(f"  [verify] {i + 1}/{n_runs} ({elapsed_ms:.1f} ms)")

    # --- 3. Proof size ---
    proof_json = proof_to_json(last_proof)
    proof_size_bytes = len(proof_json.encode("utf-8"))

    print(f"\n[lattice] Results:")
    print(f"  Prove  : {mean(prove_times):.1f} ± {stddev(prove_times):.1f} ms")
    print(f"  Verify : {mean(verify_times):.1f} ± {stddev(verify_times):.1f} ms")
    print(f"  Proof size : {proof_size_bytes:,} bytes")
    print(f"  Peak memory: {peak_memory:,} bytes ({peak_memory / 1024 / 1024:.1f} MB)")

    return {
        "prove_times_ms": prove_times,
        "verify_times_ms": verify_times,
        "proof_size_bytes": proof_size_bytes,
        "peak_memory_bytes": peak_memory,
    }


# ============================================================================
# Classical (Groth16) Benchmarks — via Node.js subprocess
# ============================================================================

def bench_classical(n_runs: int) -> dict:
    """Benchmark the Groth16 classical track by calling bench_classical.js."""
    print(f"\n{'='*60}")
    print(f"  CLASSICAL (GROTH16) BENCHMARK — {n_runs} runs")
    print(f"{'='*60}")

    script_path = os.path.join(BENCHMARKS_DIR, "bench_classical.js")

    cmd = ["node", script_path, "--runs", str(n_runs)]
    print(f"[classical] Running: {' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
        timeout=600,  # 10 minute timeout for N=100
    )

    # Print stderr (progress messages) to terminal
    if result.stderr:
        for line in result.stderr.strip().split("\n"):
            print(f"  {line}")

    if result.returncode != 0:
        print(f"[classical] ERROR: bench_classical.js exited with code {result.returncode}")
        print(f"  stdout: {result.stdout[:500]}")
        print(f"  stderr: {result.stderr[:500]}")
        raise RuntimeError(f"Classical benchmark failed: {result.stderr[:200]}")

    data = json.loads(result.stdout)

    if "error" in data:
        raise RuntimeError(f"Classical benchmark error: {data['error']}")

    prove_times = data["prove_times_ms"]
    verify_times = data["verify_times_ms"]

    print(f"\n[classical] Results:")
    print(f"  Prove  : {mean(prove_times):.1f} ± {stddev(prove_times):.1f} ms")
    print(f"  Verify : {mean(verify_times):.1f} ± {stddev(verify_times):.1f} ms")
    print(f"  Proof size : {data['proof_size_bytes']:,} bytes")
    print(f"  Peak memory: {data['peak_memory_bytes']:,} bytes ({data['peak_memory_bytes'] / 1024 / 1024:.1f} MB)")

    return data


# ============================================================================
# Gas Cost Benchmarks — via Hardhat subprocess
# ============================================================================

def bench_gas() -> dict:
    """Measure on-chain gas costs by running bench_gas.js via Hardhat."""
    print(f"\n{'='*60}")
    print(f"  GAS COST BENCHMARK")
    print(f"{'='*60}")

    contracts_dir = os.path.join(PROJECT_ROOT, "contracts")
    script_path = os.path.join(BENCHMARKS_DIR, "bench_gas.js")

    # NODE_PATH ensures require('hardhat') resolves from the contracts/ node_modules
    env = os.environ.copy()
    env["NODE_PATH"] = os.path.join(contracts_dir, "node_modules")

    cmd = [
        "npx", "hardhat", "run", script_path, "--network", "hardhat"
    ]
    print(f"[gas] Running: {' '.join(cmd)}")
    print(f"[gas] CWD: {contracts_dir}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=contracts_dir,
        timeout=120,
        env=env,
    )

    if result.stderr:
        for line in result.stderr.strip().split("\n"):
            print(f"  {line}")

    if result.returncode != 0:
        print(f"[gas] ERROR: bench_gas.js exited with code {result.returncode}")
        print(f"  stdout: {result.stdout[:500]}")
        print(f"  stderr: {result.stderr[:500]}")
        raise RuntimeError(f"Gas benchmark failed: {result.stderr[:200]}")

    # Parse JSON from stdout — skip any non-JSON preamble
    stdout = result.stdout.strip()
    # Find the JSON object in stdout (Hardhat may print other text)
    json_start = stdout.rfind("{")
    json_end = stdout.rfind("}") + 1
    if json_start == -1 or json_end == 0:
        raise RuntimeError(f"Gas benchmark did not produce JSON output. stdout: {stdout[:300]}")

    data = json.loads(stdout[json_start:json_end])

    if "error" in data:
        raise RuntimeError(f"Gas benchmark error: {data['error']}")

    print(f"\n[gas] Results:")
    print(f"  Groth16 submitVote()       : {data['groth16_gas']:,} gas")
    print(f"  Lattice submitLatticeVote(): {data['lattice_gas']:,} gas")

    return data


# ============================================================================
# CSV + Report Generation
# ============================================================================

def write_csv(classical: dict, lattice: dict, gas: dict, n_runs: int):
    """Write raw benchmark data to benchmarks/results.csv."""
    csv_path = os.path.join(BENCHMARKS_DIR, "results.csv")

    rows = [
        ("classical", "proof_generation_time",
         f"{mean(classical['prove_times_ms']):.2f}",
         f"{stddev(classical['prove_times_ms']):.2f}",
         "ms", str(n_runs)),
        ("classical", "verification_time",
         f"{mean(classical['verify_times_ms']):.2f}",
         f"{stddev(classical['verify_times_ms']):.2f}",
         "ms", str(n_runs)),
        ("classical", "proof_size",
         str(classical["proof_size_bytes"]),
         "0", "bytes", "1"),
        ("classical", "gas_cost",
         str(gas["groth16_gas"]),
         "0", "gas", "1"),
        ("classical", "peak_memory",
         str(classical["peak_memory_bytes"]),
         "0", "bytes", "1"),
        ("lattice", "proof_generation_time",
         f"{mean(lattice['prove_times_ms']):.2f}",
         f"{stddev(lattice['prove_times_ms']):.2f}",
         "ms", str(n_runs)),
        ("lattice", "verification_time",
         f"{mean(lattice['verify_times_ms']):.2f}",
         f"{stddev(lattice['verify_times_ms']):.2f}",
         "ms", str(n_runs)),
        ("lattice", "proof_size",
         str(lattice["proof_size_bytes"]),
         "0", "bytes", "1"),
        ("lattice", "gas_cost",
         str(gas["lattice_gas"]),
         "0", "gas", "1"),
        ("lattice", "peak_memory",
         str(lattice["peak_memory_bytes"]),
         "0", "bytes", "1"),
    ]

    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["track", "metric", "mean", "stddev", "unit", "n_runs"])
        writer.writerows(rows)

    print(f"\n[output] CSV written to: {csv_path}")
    return csv_path


def write_report(classical: dict, lattice: dict, gas: dict, n_runs: int):
    """Write auto-generated benchmark report to benchmarks/report.md."""
    report_path = os.path.join(BENCHMARKS_DIR, "report.md")

    # System info
    import platform as pf
    try:
        import psutil
        ram_gb = psutil.virtual_memory().total / (1024 ** 3)
        cpu_count = psutil.cpu_count(logical=True)
        ram_str = f"{ram_gb:.1f} GB"
        cpu_str = f"{cpu_count} logical cores"
    except ImportError:
        ram_str = "N/A (psutil not installed)"
        cpu_str = "N/A"

    node_version = "N/A"
    try:
        r = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=5)
        node_version = r.stdout.strip()
    except Exception:
        pass

    # Compute derived metrics
    c_prove_mean = mean(classical["prove_times_ms"])
    c_prove_std = stddev(classical["prove_times_ms"])
    c_verify_mean = mean(classical["verify_times_ms"])
    c_verify_std = stddev(classical["verify_times_ms"])
    c_proof_size = classical["proof_size_bytes"]
    c_memory = classical["peak_memory_bytes"]
    c_gas = gas["groth16_gas"]

    l_prove_mean = mean(lattice["prove_times_ms"])
    l_prove_std = stddev(lattice["prove_times_ms"])
    l_verify_mean = mean(lattice["verify_times_ms"])
    l_verify_std = stddev(lattice["verify_times_ms"])
    l_proof_size = lattice["proof_size_bytes"]
    l_memory = lattice["peak_memory_bytes"]
    l_gas = gas["lattice_gas"]

    # Ratios
    prove_ratio = l_prove_mean / c_prove_mean if c_prove_mean > 0 else float("inf")
    verify_ratio = l_verify_mean / c_verify_mean if c_verify_mean > 0 else float("inf")
    size_ratio = l_proof_size / c_proof_size if c_proof_size > 0 else float("inf")
    gas_ratio = c_gas / l_gas if l_gas > 0 else float("inf")

    report = f"""# PQ-ZKVote Benchmark Report — Classical vs. Post-Quantum

> **Auto-generated** by `benchmarks/run_benchmarks.py` on {time.strftime('%Y-%m-%d %H:%M:%S %Z')}.
> Every number in this report was produced by the benchmark script — no manually entered values.

---

## System Information

| Property | Value |
|---|---|
| OS | {pf.system()} {pf.release()} |
| CPU | {pf.processor() or pf.machine()} ({cpu_str}) |
| RAM | {ram_str} |
| Python | {pf.python_version()} |
| Node.js | {node_version} |

---

## Summary

| Metric | Classical (Groth16) | Lattice (QRZ-KPA) | Ratio (Lattice / Classical) |
|---|---|---|---|
| Proof generation time | {c_prove_mean:.1f} ± {c_prove_std:.1f} ms | {l_prove_mean:.1f} ± {l_prove_std:.1f} ms | {prove_ratio:.1f}× |
| Verification time | {c_verify_mean:.1f} ± {c_verify_std:.1f} ms | {l_verify_mean:.1f} ± {l_verify_std:.1f} ms | {verify_ratio:.1f}× |
| Proof size | {c_proof_size:,} bytes | {l_proof_size:,} bytes | {size_ratio:.1f}× |
| On-chain gas cost | {c_gas:,} gas | {l_gas:,} gas | {gas_ratio:.2f}× (classical / lattice) |
| Peak memory (proving) | {c_memory / 1024 / 1024:.1f} MB | {l_memory / 1024 / 1024:.1f} MB | — |

N = {n_runs} runs for timing metrics.

---

## Discussion

### Proof Generation Time

The classical Groth16 track generates proofs in **{c_prove_mean:.1f} ms** (mean), while the
lattice-based QRZ-KPA track requires **{l_prove_mean:.1f} ms** — approximately
**{prove_ratio:.1f}× {"slower" if prove_ratio > 1 else "faster"}**.

{"This is expected: Groth16 uses highly optimised elliptic-curve multi-exponentiations via WASM, whereas the lattice scheme performs polynomial NTT operations and rejection sampling in Python. A Rust port of the lattice prover would likely narrow this gap significantly." if prove_ratio > 1 else "The lattice prover is faster, likely due to simpler arithmetic operations compared to elliptic-curve pairings."}

### Verification Time

Classical verification takes **{c_verify_mean:.1f} ms** vs. lattice verification at
**{l_verify_mean:.1f} ms** ({verify_ratio:.1f}×).

{"The lattice verifier performs polynomial multiplications and modular arithmetic, which are computationally lighter than elliptic-curve pairing checks but involve larger data structures." if verify_ratio < 1 else "Lattice verification is slower due to the larger proof structures and multiple polynomial operations."}

### Proof Size

Groth16 proofs are **{c_proof_size:,} bytes** — one of the scheme's key advantages. Lattice proofs
are **{l_proof_size:,} bytes** ({size_ratio:.1f}× larger). This is the well-known size tradeoff for
post-quantum constructions: lattice-based proofs carry polynomial vectors that are inherently larger
than the three elliptic-curve group elements in a Groth16 proof.

### On-Chain Gas Cost

Groth16 on-chain verification costs **{c_gas:,} gas** (pairing-based check). The lattice track's
on-chain component costs **{l_gas:,} gas**.

**Important context**: The lattice track's on-chain gas cost is lower because the full polynomial
ring-equation verification (A·z = w + c·t) is performed **off-chain** by the tallying service,
not on-chain. The on-chain contract only checks nullifier uniqueness, Merkle root match, and
proof-hash non-emptiness. This is an honest architectural tradeoff documented in
`contracts/contracts/LatticeVerifier.sol` and `docs/pqc_scheme.md` §7 — not a claim that lattice
verification is cheaper than pairing-based verification.

### Peak Memory

Classical track: **{c_memory / 1024 / 1024:.1f} MB** (Node.js process RSS).
Lattice track: **{l_memory / 1024 / 1024:.1f} MB** (Python tracemalloc peak).

**Methodology note**: These numbers use different measurement approaches (process RSS vs.
Python allocator tracking) and are not directly comparable. They are included for reference,
not for head-to-head comparison.

---

## Methodology

- **Timing**: `process.hrtime()` (Node.js) / `time.perf_counter()` (Python), wall-clock.
- **Memory**: `process.memoryUsage().rss` (Node.js) / `tracemalloc` peak (Python).
- **Gas**: Actual `tx.gasUsed` from Hardhat local network transactions.
- **Proof size**: `JSON.stringify(proof).length` (classical) / `len(json.dumps(proof).encode())` (lattice).
- **Warm-up**: One untimed warm-up run before each timed loop.
- **Test data**: Identical vote parameters across both tracks (candidate 1 of 4, credential "123456789", election ID 1, Merkle depth 10).

### Known Limitations

1. Classical and lattice benchmarks run in different runtimes (Node.js vs. Python), introducing
   interpreter overhead differences. A production comparison would use the same language.
2. The lattice prover is a pure-Python prototype; a Rust or C implementation would be
   substantially faster.
3. Memory measurement methodologies differ between tracks (see above).
4. Gas costs reflect Hardhat's local EVM, not mainnet conditions.

---

## Reproducing These Results

```bash
# From the project root:
python benchmarks/run_benchmarks.py

# Quick validation run (N=5):
python benchmarks/run_benchmarks.py --quick

# Custom number of runs:
python benchmarks/run_benchmarks.py --runs 50
```

Raw data is in `benchmarks/results.csv`.
"""

    with open(report_path, "w") as f:
        f.write(report)

    print(f"[output] Report written to: {report_path}")
    return report_path


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="PQ-ZKVote Classical vs. PQC Benchmark Suite"
    )
    parser.add_argument("--runs", type=int, default=100,
                        help="Number of timed iterations for prove/verify (default: 100)")
    parser.add_argument("--quick", action="store_true",
                        help="Quick validation run (N=5)")
    parser.add_argument("--skip-gas", action="store_true",
                        help="Skip gas benchmark (useful if Hardhat is not set up)")
    args = parser.parse_args()

    n_runs = 5 if args.quick else args.runs

    print("=" * 60)
    print("  PQ-ZKVote Benchmark Suite")
    print(f"  N = {n_runs} runs {'(--quick mode)' if args.quick else ''}")
    print("=" * 60)

    # --- Run benchmarks ---
    lattice_results = bench_lattice(n_runs)
    classical_results = bench_classical(n_runs)

    if args.skip_gas:
        gas_results = {"groth16_gas": 0, "lattice_gas": 0}
        print("\n[gas] SKIPPED (--skip-gas flag)")
    else:
        gas_results = bench_gas()

    # --- Generate outputs ---
    csv_path = write_csv(classical_results, lattice_results, gas_results, n_runs)
    report_path = write_report(classical_results, lattice_results, gas_results, n_runs)

    print(f"\n{'='*60}")
    print("  BENCHMARK COMPLETE")
    print(f"{'='*60}")
    print(f"  CSV    : {csv_path}")
    print(f"  Report : {report_path}")
    print(f"  Runs   : {n_runs}")
    print()


if __name__ == "__main__":
    main()
