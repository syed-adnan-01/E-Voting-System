# PQ-ZKVote Benchmark Report — Classical vs. Post-Quantum

> **Auto-generated** by `benchmarks/run_benchmarks.py` on 2026-08-15 12:23:29 IST.
> Every number in this report was produced by the benchmark script — no manually entered values.

---

## System Information

| Property | Value |
|---|---|
| OS | Linux 6.17.0-41-generic |
| CPU | x86_64 (8 logical cores) |
| RAM | 7.0 GB |
| Python | 3.13.7 |
| Node.js | v22.23.1 |

---

## Summary

| Metric | Classical (Groth16) | Lattice (QRZ-KPA) | Ratio (Lattice / Classical) |
|---|---|---|---|
| Proof generation time | 936.8 ± 22.9 ms | 249.7 ± 8.0 ms | 0.3× |
| Verification time | 31.1 ± 3.8 ms | 12.7 ± 0.6 ms | 0.4× |
| Proof size | 722 bytes | 42,149 bytes | 58.4× |
| On-chain gas cost | 296,547 gas | 63,910 gas | 4.64× (classical / lattice) |
| Peak memory (proving) | 497.5 MB | 0.4 MB | — |

N = 5 runs for timing metrics.

---

## Discussion

### Proof Generation Time

The classical Groth16 track generates proofs in **936.8 ms** (mean), while the
lattice-based QRZ-KPA track requires **249.7 ms** — approximately
**0.3× faster**.

The lattice prover is faster, likely due to simpler arithmetic operations compared to elliptic-curve pairings.

### Verification Time

Classical verification takes **31.1 ms** vs. lattice verification at
**12.7 ms** (0.4×).

The lattice verifier performs polynomial multiplications and modular arithmetic, which are computationally lighter than elliptic-curve pairing checks but involve larger data structures.

### Proof Size

Groth16 proofs are **722 bytes** — one of the scheme's key advantages. Lattice proofs
are **42,149 bytes** (58.4× larger). This is the well-known size tradeoff for
post-quantum constructions: lattice-based proofs carry polynomial vectors that are inherently larger
than the three elliptic-curve group elements in a Groth16 proof.

### On-Chain Gas Cost

Groth16 on-chain verification costs **296,547 gas** (pairing-based check). The lattice track's
on-chain component costs **63,910 gas**.

**Important context**: The lattice track's on-chain gas cost is lower because the full polynomial
ring-equation verification (A·z = w + c·t) is performed **off-chain** by the tallying service,
not on-chain. The on-chain contract only checks nullifier uniqueness, Merkle root match, and
proof-hash non-emptiness. This is an honest architectural tradeoff documented in
`contracts/contracts/LatticeVerifier.sol` and `docs/pqc_scheme.md` §7 — not a claim that lattice
verification is cheaper than pairing-based verification.

### Peak Memory

Classical track: **497.5 MB** (Node.js process RSS).
Lattice track: **0.4 MB** (Python tracemalloc peak).

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
