# Anomaly Detection Methodology

## Overview

PQ-ZKVote layers a machine-learning anomaly monitor on top of cryptographic verification. Zero-knowledge proofs guarantee that a submitted vote is *mathematically valid* — correct nullifier, valid Merkle membership, in-range vote value. They cannot detect *behavioural irregularities* that are invisible to the circuit but suspicious at the network level, such as bot-driven rapid submissions or gas-price manipulation. The Isolation Forest pipeline described here fills that gap.

> **Important**: Anomalous votes are **flagged for human review only** — never automatically rejected. A cryptographically valid proof that the model scores as anomalous is surfaced on the admin dashboard; a human reviewer makes the final decision. This is a deliberate design choice (see PRD §6.5, FR4.3).

---

## Feature Vector

Each vote-submission event is represented as a four-element numeric feature vector:

| Feature | Unit | Description |
|---|---|---|
| `timestamp` | Unix epoch seconds | Block timestamp of the transaction |
| `verification_latency_ms` | Milliseconds | Wall-clock time from proof submission to on-chain verification |
| `gas_price_gwei` | Gwei | Gas price specified by the submitter |
| `submission_interval_s` | Seconds | Elapsed time since the previous submission in the event log |

Session metadata (session IDs) is **SHA-256 hashed and truncated to 16 hex characters** before any feature extraction to comply with the privacy requirement in PRD §7 — no raw session identifiers are ever written to disk or used as model inputs.

---

## Algorithm: Isolation Forest

**Algorithm**: `sklearn.ensemble.IsolationForest`

**Why Isolation Forest?**
- Unsupervised — no labelled data is required at inference time (legitimate production deployments will have no ground-truth labels)
- Designed explicitly for anomaly detection in tabular data
- Efficient on moderate-size datasets (O(n log n))
- Interpretable contamination parameter that directly controls the decision threshold
- Peer-reviewed, widely deployed, and directly specified in the implementation plan (§4.2)

**Hyperparameters:**

| Parameter | Value | Rationale |
|---|---|---|
| `contamination` | 0.05 | Matches the injection rate in `generate_dataset.py`. Setting this equal to the true anomaly fraction gives the model the best-calibrated decision boundary. |
| `n_estimators` | 100 | Default; provides stable performance without tuning against test metrics. |
| `random_state` | 42 | Fixed for reproducibility — re-running any script produces identical results. |

---

## Anomaly Types Injected in the Synthetic Dataset

The injection logic in `anomaly/generate_dataset.py` is **fully explicit** — each anomaly type has a dedicated, documented function. Nothing is hidden in a black box.

### Type A — Rapid-fire submissions (`_inject_rapid_fire`)
**Pattern**: A single pseudonymised session submits multiple votes with < 2-second inter-submission gaps.

**Why anomalous**: Legitimate voter clients submit a single vote per session. Sub-2-second gaps indicate a scripted bot or a replay/flooding attack attempting to exhaust nullifier slots (even though on-chain nullifiers prevent actual double-counting).

**Threshold**: `RAPID_FIRE_INTERVAL_MAX_S = 2.0` seconds

### Type B — High gas price outlier (`_inject_gas_outlier_high`)
**Pattern**: Gas price > 150 Gwei (≥ 5× the normal upper bound of 30 Gwei).

**Why anomalous**: A voter paying an extreme premium to guarantee fast block inclusion is inconsistent with expected voter behaviour. It suggests front-running, MEV extraction, or an adversary attempting to censor competing transactions.

**Threshold**: `GAS_PRICE_OUTLIER_HIGH_GWEI = 150.0` Gwei

### Type C — Low gas price outlier (`_inject_gas_outlier_low`)
**Pattern**: Gas price < 0.05 Gwei (below the network base fee).

**Why anomalous**: A transaction with a gas price below the base fee would be rejected by the mempool in normal operation. If such a record appears in the event log it indicates either a private relay, fee manipulation, or log tampering.

**Threshold**: `GAS_PRICE_OUTLIER_LOW_GWEI = 0.05` Gwei

### Type D — Impossible timestamp sequence (`_inject_impossible_timestamp`)
**Pattern**: A submission's recorded timestamp is 1–10 seconds *before* the previous submission.

**Why anomalous**: Blockchain events are append-only and timestamps are monotonically non-decreasing per block. A negative submission interval is physically impossible and indicates clock manipulation, a forged event, or data corruption.

**Threshold**: `IMPOSSIBLE_TIMESTAMP_DELTA = -10` seconds

---

## Dataset Composition

| Split | Size | Anomalous | Normal |
|---|---|---|---|
| Train (80%) | ~858 | ~43 (5%) | ~815 (95%) |
| Test (20%) | ~215 | ~11 (5%) | ~204 (95%) |

- Total dataset: 1,053 records (1,000 normal + 53 injected anomalies at 5% contamination)
- Rows are **shuffled** before splitting to avoid positional bias
- Train/test split uses `stratify=y` so both partitions contain a proportional share of anomalies
- **The model never sees test-set labels during training** — `IsolationForest.fit()` is called with `X_train` only

---

## Evaluation Protocol

All reported metrics are computed on the **held-out 20% test set exclusively**. The model is never evaluated on, tuned against, or re-trained on test data.

### Metrics Reported

| Metric | Definition |
|---|---|
| **Precision** | TP / (TP + FP) — what fraction of flagged votes are truly anomalous |
| **Recall** | TP / (TP + FN) — what fraction of injected anomalies are caught |
| **F1** | Harmonic mean of precision and recall |
| **ROC-AUC** | Area under the ROC curve; uses raw anomaly scores (not binary predictions), giving a threshold-free measure of discriminative power |
| **Confusion matrix** | TN, FP, FN, TP counts + saved as `anomaly/results/confusion_matrix.png` |

Results are written to `anomaly/results/metrics.json` and are reproducible by re-running the three scripts in order:

```bash
python anomaly/generate_dataset.py
python anomaly/train_model.py
python anomaly/evaluate.py
```

---

## Limitations and Honest Caveats

- The dataset is **fully synthetic**. Real-world performance depends on how well the injected anomaly types reflect actual attack patterns — this cannot be known without live production data.
- The model is calibrated with `contamination=0.05`, which is both the true injection rate and a reasonable assumption for a real election. If the actual anomaly rate is much higher or lower, the decision threshold will be miscalibrated.
- The anomaly detector is a **second layer** — it is not a replacement for cryptographic verification. Every submission still passes through `Groth16Verifier.verifyProof()` on-chain before being recorded.
- Session-based features (rapid-fire detection) depend on off-chain event aggregation; a sophisticated adversary using multiple wallets per session will not be caught by Type A detection alone.
