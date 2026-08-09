"""
anomaly/generate_dataset.py
===========================
Generates a labelled synthetic dataset of vote-submission event records.

Normal records reflect realistic on-chain voting behaviour.
Anomalous records are injected with explicit, documented logic — nothing is
hidden in a black box.  Ground-truth labels are written alongside the features
so that evaluation code can measure detection quality precisely.

Output
------
anomaly/data/votes_dataset.csv  — labelled feature matrix ready for training

Usage
-----
    python anomaly/generate_dataset.py [--n-normal 1000] [--seed 42]
"""

import argparse
import hashlib
import os
import random
import time

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Constants — document every choice
# ---------------------------------------------------------------------------

# Base gas price range for a healthy Hardhat/testnet environment (in gwei)
NORMAL_GAS_PRICE_GWEI_MIN = 1.0
NORMAL_GAS_PRICE_GWEI_MAX = 30.0

# Typical proof-verification latency on a local node (milliseconds)
NORMAL_LATENCY_MS_MIN = 50.0
NORMAL_LATENCY_MS_MAX = 400.0

# Inter-submission gap for a healthy election (seconds between different voters)
NORMAL_INTERVAL_MIN_S = 5.0
NORMAL_INTERVAL_MAX_S = 600.0

# Election window: 24 hours starting from a fixed Unix epoch offset
ELECTION_START_EPOCH = 1_700_000_000   # Arbitrary fixed start time
ELECTION_DURATION_S = 86_400           # 24 hours

# Anomaly thresholds used during injection — these values must match
# the documentation in docs/anomaly_methodology.md
RAPID_FIRE_INTERVAL_MAX_S = 2.0        # Same-session bursts < 2 s apart
GAS_PRICE_OUTLIER_HIGH_GWEI = 150.0   # High-gas outlier floor
GAS_PRICE_OUTLIER_LOW_GWEI = 0.05     # Low-gas outlier ceiling (< base fee)
IMPOSSIBLE_TIMESTAMP_DELTA = -10       # Seconds — submission before previous

# Fraction of the total dataset that should be anomalous
# (used later by IsolationForest as the contamination parameter)
CONTAMINATION_RATE = 0.05


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _pseudonymise(session_id: str) -> str:
    """
    Hash session IDs with SHA-256 before writing to disk so that the dataset
    does not expose raw session metadata (PRD §7, Privacy requirement).
    """
    return hashlib.sha256(session_id.encode()).hexdigest()[:16]


def _normal_record(rng: np.random.Generator, prev_ts: float) -> dict:
    """Return a single normal vote-submission feature vector."""
    interval = rng.uniform(NORMAL_INTERVAL_MIN_S, NORMAL_INTERVAL_MAX_S)
    timestamp = prev_ts + interval
    return {
        "timestamp": timestamp,
        "verification_latency_ms": rng.uniform(NORMAL_LATENCY_MS_MIN, NORMAL_LATENCY_MS_MAX),
        "gas_price_gwei": rng.uniform(NORMAL_GAS_PRICE_GWEI_MIN, NORMAL_GAS_PRICE_GWEI_MAX),
        "submission_interval_s": interval,
        "session_id_hash": _pseudonymise(f"session_{rng.integers(1, 500)}"),
        "label": "normal",
    }


# ---------------------------------------------------------------------------
# Anomaly injection functions — each function is explicit and documented
# ---------------------------------------------------------------------------

def _inject_rapid_fire(rng: np.random.Generator, prev_ts: float, n: int) -> list[dict]:
    """
    Rapid-fire submissions from the same session window.

    Anomaly pattern: a single session submits multiple votes within a very
    short time window (< RAPID_FIRE_INTERVAL_MAX_S seconds per submission).
    This could indicate a script-driven bot or a replay attack attempting
    to exhaust the nullifier set.

    Note: on-chain the nullifier prevents actual double-voting; this anomaly
    is detectable off-chain before the transaction is confirmed.
    """
    session = _pseudonymise(f"rapid_fire_{rng.integers(1, 1_000_000)}")
    records = []
    ts = prev_ts
    for _ in range(n):
        interval = rng.uniform(0.1, RAPID_FIRE_INTERVAL_MAX_S)
        ts += interval
        records.append({
            "timestamp": ts,
            "verification_latency_ms": rng.uniform(NORMAL_LATENCY_MS_MIN, NORMAL_LATENCY_MS_MAX),
            "gas_price_gwei": rng.uniform(NORMAL_GAS_PRICE_GWEI_MIN, NORMAL_GAS_PRICE_GWEI_MAX),
            "submission_interval_s": interval,
            "session_id_hash": session,   # same session — distinguishing feature
            "label": "anomalous",
        })
    return records


def _inject_gas_outlier_high(rng: np.random.Generator, prev_ts: float) -> dict:
    """
    Abnormally high gas price.

    Anomaly pattern: a submission pays a gas price far above the normal
    range, suggesting an adversary trying to front-run or guarantee rapid
    inclusion — behaviour inconsistent with normal voter activity.
    """
    interval = rng.uniform(NORMAL_INTERVAL_MIN_S, NORMAL_INTERVAL_MAX_S)
    return {
        "timestamp": prev_ts + interval,
        "verification_latency_ms": rng.uniform(NORMAL_LATENCY_MS_MIN, NORMAL_LATENCY_MS_MAX),
        "gas_price_gwei": rng.uniform(GAS_PRICE_OUTLIER_HIGH_GWEI, GAS_PRICE_OUTLIER_HIGH_GWEI * 3),
        "submission_interval_s": interval,
        "session_id_hash": _pseudonymise(f"gas_hi_{rng.integers(1, 1_000_000)}"),
        "label": "anomalous",
    }


def _inject_gas_outlier_low(rng: np.random.Generator, prev_ts: float) -> dict:
    """
    Abnormally low gas price (below the network base fee).

    Anomaly pattern: a submission specifies a gas price below the current
    base fee, which would normally cause the transaction to be rejected by
    the mempool.  If it somehow appears on-chain it indicates either a
    private relay, a fee manipulation attack, or data corruption.
    """
    interval = rng.uniform(NORMAL_INTERVAL_MIN_S, NORMAL_INTERVAL_MAX_S)
    return {
        "timestamp": prev_ts + interval,
        "verification_latency_ms": rng.uniform(NORMAL_LATENCY_MS_MIN, NORMAL_LATENCY_MS_MAX),
        "gas_price_gwei": rng.uniform(0.0, GAS_PRICE_OUTLIER_LOW_GWEI),
        "submission_interval_s": interval,
        "session_id_hash": _pseudonymise(f"gas_lo_{rng.integers(1, 1_000_000)}"),
        "label": "anomalous",
    }


def _inject_impossible_timestamp(rng: np.random.Generator, prev_ts: float) -> dict:
    """
    Impossible (negative) submission interval.

    Anomaly pattern: a submission whose recorded timestamp is *before* the
    previous submission.  This is physically impossible in an append-only
    blockchain log and indicates either clock manipulation, a forged event,
    or log tampering.
    """
    delta = rng.uniform(IMPOSSIBLE_TIMESTAMP_DELTA, -1)   # negative — before prev
    return {
        "timestamp": prev_ts + delta,
        "verification_latency_ms": rng.uniform(NORMAL_LATENCY_MS_MIN, NORMAL_LATENCY_MS_MAX),
        "gas_price_gwei": rng.uniform(NORMAL_GAS_PRICE_GWEI_MIN, NORMAL_GAS_PRICE_GWEI_MAX),
        "submission_interval_s": delta,         # negative value — key feature
        "session_id_hash": _pseudonymise(f"ts_{rng.integers(1, 1_000_000)}"),
        "label": "anomalous",
    }


# ---------------------------------------------------------------------------
# Dataset assembler
# ---------------------------------------------------------------------------

def generate_dataset(n_normal: int = 1000, seed: int = 42) -> pd.DataFrame:
    """
    Generate the full labelled dataset.

    Anomaly budget is derived from CONTAMINATION_RATE applied to the *total*
    (normal + anomalous) size so that the contamination parameter passed to
    IsolationForest during training matches the actual ratio.

    Parameters
    ----------
    n_normal : int
        Number of normal records to generate.
    seed : int
        NumPy random seed — set to reproduce results exactly.

    Returns
    -------
    pd.DataFrame with columns:
        timestamp, verification_latency_ms, gas_price_gwei,
        submission_interval_s, session_id_hash, label
    """
    rng = np.random.default_rng(seed)
    records: list[dict] = []
    prev_ts = float(ELECTION_START_EPOCH)

    # 1. Generate normal records
    for _ in range(n_normal):
        rec = _normal_record(rng, prev_ts)
        prev_ts = rec["timestamp"]
        records.append(rec)

    # 2. Compute anomaly budget
    # n_total = n_normal / (1 - CONTAMINATION_RATE)  =>  n_anomalous = n_total * CONTAMINATION_RATE
    n_anomalous = int(round(n_normal * CONTAMINATION_RATE / (1 - CONTAMINATION_RATE)))

    # 3. Inject anomalies — distribute evenly across the four documented types
    injected = 0

    # Type A: rapid-fire bursts (groups of 3 submissions)
    burst_size = 3
    type_a_count = max(1, n_anomalous // 4)
    for _ in range(type_a_count // burst_size + 1):
        if injected >= n_anomalous:
            break
        records_added = _inject_rapid_fire(rng, prev_ts, min(burst_size, n_anomalous - injected))
        for r in records_added:
            prev_ts = r["timestamp"]
        records.extend(records_added)
        injected += len(records_added)

    # Type B: high-gas outliers
    type_b_count = max(1, n_anomalous // 4)
    for _ in range(type_b_count):
        if injected >= n_anomalous:
            break
        rec = _inject_gas_outlier_high(rng, prev_ts)
        prev_ts = rec["timestamp"]
        records.append(rec)
        injected += 1

    # Type C: low-gas outliers
    type_c_count = max(1, n_anomalous // 4)
    for _ in range(type_c_count):
        if injected >= n_anomalous:
            break
        rec = _inject_gas_outlier_low(rng, prev_ts)
        prev_ts = rec["timestamp"]
        records.append(rec)
        injected += 1

    # Type D: impossible timestamp sequences
    remaining = n_anomalous - injected
    for _ in range(remaining):
        rec = _inject_impossible_timestamp(rng, prev_ts)
        # NOTE: do NOT advance prev_ts with this record — it's intentionally out-of-order
        records.append(rec)

    df = pd.DataFrame(records)

    # 4. Shuffle rows so anomalies are not clustered at the end (important for
    #    realistic train/test splits that don't leak positional information)
    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)

    return df


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic voting dataset for anomaly detection.")
    parser.add_argument("--n-normal", type=int, default=1000, help="Number of normal records (default: 1000)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed (default: 42)")
    parser.add_argument("--output", type=str, default="anomaly/data/votes_dataset.csv",
                        help="Output CSV path (default: anomaly/data/votes_dataset.csv)")
    args = parser.parse_args()

    df = generate_dataset(n_normal=args.n_normal, seed=args.seed)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    df.to_csv(args.output, index=False)

    normal_count = (df["label"] == "normal").sum()
    anomalous_count = (df["label"] == "anomalous").sum()
    actual_rate = anomalous_count / len(df)

    print(f"Dataset saved to: {args.output}")
    print(f"  Total records  : {len(df)}")
    print(f"  Normal records : {normal_count}")
    print(f"  Anomalous recs : {anomalous_count}")
    print(f"  Actual contamination rate: {actual_rate:.3f} (target: {CONTAMINATION_RATE})")


if __name__ == "__main__":
    main()
