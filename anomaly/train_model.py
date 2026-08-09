"""
anomaly/train_model.py
======================
Trains an Isolation Forest anomaly-detection model on the synthetic dataset
produced by generate_dataset.py.

Design decisions documented here:
- Algorithm  : Isolation Forest (sklearn.ensemble.IsolationForest)
- Rationale  : Unsupervised; no labelled training data required in production;
               well-studied for tabular anomaly detection; matches the
               IsolationForest spec in PQ_ZKVote_Implementation_Plan.md §4.2.
- Contamination: 0.05 — matches the CONTAMINATION_RATE in generate_dataset.py.
               The contamination parameter tells the model what fraction of
               training data to treat as outliers when computing the decision
               threshold.  Setting it equal to the true injection rate gives
               the IsolationForest the best possible calibration.
- Train/test split: 80 / 20, random_state=42 — held-out test set is never
               touched until evaluate.py runs.
- Features   : numeric features only (the session_id_hash is excluded because
               it is a pseudonymised string; the label column is excluded
               because the model trains unsupervised).

Output
------
anomaly/model/isolation_forest.pkl    — serialised model
anomaly/model/train_test_split.npz   — saved split indices (so evaluate.py
                                        uses the exact same test partition)

Usage
-----
    python anomaly/train_model.py [--dataset anomaly/data/votes_dataset.csv]
"""

import argparse
import os
import pickle

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split


# ---------------------------------------------------------------------------
# Constants — hyperparameters must be documented here and in anomaly_methodology.md
# ---------------------------------------------------------------------------

CONTAMINATION_RATE = 0.05   # Matches generate_dataset.py — see docs/anomaly_methodology.md
RANDOM_STATE = 42
TEST_SIZE = 0.20

# Columns used as features (must be numeric, must not include identifying info)
FEATURE_COLUMNS = [
    "timestamp",
    "verification_latency_ms",
    "gas_price_gwei",
    "submission_interval_s",
]


# ---------------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------------

def load_and_prepare(dataset_path: str) -> tuple[pd.DataFrame, pd.Series, np.ndarray, np.ndarray]:
    """
    Load the dataset and return feature matrix X and label series y.

    The model trains on X only (unsupervised).  y is returned so that
    evaluate.py can measure detection quality against ground truth.
    """
    df = pd.read_csv(dataset_path)

    required = set(FEATURE_COLUMNS) | {"label"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")

    X = df[FEATURE_COLUMNS].values.astype(np.float64)
    y = (df["label"] == "anomalous").astype(int).values   # 1 = anomalous, 0 = normal

    return df, y, X


def train(dataset_path: str, model_dir: str) -> None:
    """
    Full training pipeline:
      1. Load and split dataset (train / test, 80 / 20)
      2. Fit IsolationForest on training split ONLY
      3. Save model and split indices
    """
    os.makedirs(model_dir, exist_ok=True)

    df, y, X = load_and_prepare(dataset_path)

    # --- Train / test split ---
    # Stratify by label so both splits contain a proportional share of
    # anomalies — this is important given the low contamination rate.
    X_train, X_test, y_train, y_test, idx_train, idx_test = train_test_split(
        X, y, np.arange(len(X)),
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    print(f"Training samples : {len(X_train)}  (anomalous: {y_train.sum()})")
    print(f"Test samples     : {len(X_test)}   (anomalous: {y_test.sum()})")

    # --- Model training ---
    # contamination=CONTAMINATION_RATE informs the model about the expected
    # fraction of outliers, calibrating the decision boundary appropriately.
    # The model itself is completely unsupervised during fit() — it never sees y.
    model = IsolationForest(
        contamination=CONTAMINATION_RATE,
        random_state=RANDOM_STATE,
        n_estimators=100,   # default; documented for reproducibility
    )
    model.fit(X_train)     # ← only training features, no labels

    # --- Persist model ---
    model_path = os.path.join(model_dir, "isolation_forest.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(model, f)
    print(f"\nModel saved to: {model_path}")

    # --- Persist split indices ---
    # Saving the exact indices ensures evaluate.py uses the same held-out test
    # set — no accidental data leakage from re-splitting with a different seed.
    split_path = os.path.join(model_dir, "train_test_split.npz")
    np.savez(
        split_path,
        X_train=X_train, X_test=X_test,
        y_train=y_train, y_test=y_test,
        idx_train=idx_train, idx_test=idx_test,
        feature_columns=np.array(FEATURE_COLUMNS),
    )
    print(f"Split indices saved to: {split_path}")

    # Quick sanity check: score on training data
    # IsolationForest.predict returns -1 for anomalies, +1 for normal.
    train_preds = model.predict(X_train)
    flagged_train = (train_preds == -1).sum()
    print(f"\nTraining-set sanity: {flagged_train}/{len(X_train)} records flagged as anomalous "
          f"({flagged_train/len(X_train)*100:.1f}%)")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Train Isolation Forest anomaly-detection model.")
    parser.add_argument(
        "--dataset", type=str, default="anomaly/data/votes_dataset.csv",
        help="Path to CSV dataset (default: anomaly/data/votes_dataset.csv)",
    )
    parser.add_argument(
        "--model-dir", type=str, default="anomaly/model",
        help="Directory to save model artefacts (default: anomaly/model)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.dataset):
        print(f"ERROR: Dataset not found at '{args.dataset}'.")
        print("Run 'python anomaly/generate_dataset.py' first.")
        raise SystemExit(1)

    train(dataset_path=args.dataset, model_dir=args.model_dir)


if __name__ == "__main__":
    main()
