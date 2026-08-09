"""
anomaly/evaluate.py
===================
Evaluates the trained Isolation Forest on the held-out test set saved by
train_model.py.  All metrics are computed exclusively on data the model
never saw during training.

Outputs
-------
- Console report: precision, recall, F1, ROC-AUC, confusion matrix (text)
- anomaly/results/metrics.json       — machine-readable metrics
- anomaly/results/confusion_matrix.png — confusion matrix plot

Usage
-----
    python anomaly/evaluate.py [--model-dir anomaly/model] [--results-dir anomaly/results]
"""

import argparse
import json
import os
import pickle

import numpy as np
import matplotlib
matplotlib.use("Agg")          # non-interactive backend for headless servers
import matplotlib.pyplot as plt
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


# ---------------------------------------------------------------------------
# Evaluation pipeline
# ---------------------------------------------------------------------------

def evaluate(model_dir: str, results_dir: str) -> dict:
    """
    Load the saved model and test split, run predictions, compute and report
    all required metrics.

    Returns
    -------
    dict with keys: precision, recall, f1, roc_auc, confusion_matrix
    """
    os.makedirs(results_dir, exist_ok=True)

    # --- Load model ---
    model_path = os.path.join(model_dir, "isolation_forest.pkl")
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Model not found at '{model_path}'. Run 'python anomaly/train_model.py' first."
        )
    with open(model_path, "rb") as f:
        model = pickle.load(f)
    print(f"Loaded model from: {model_path}")

    # --- Load held-out test split ---
    split_path = os.path.join(model_dir, "train_test_split.npz")
    if not os.path.exists(split_path):
        raise FileNotFoundError(
            f"Split data not found at '{split_path}'. Run 'python anomaly/train_model.py' first."
        )
    split = np.load(split_path, allow_pickle=True)
    X_test = split["X_test"]
    y_test = split["y_test"]           # 1 = anomalous, 0 = normal (ground truth)
    feature_columns = list(split["feature_columns"])

    print(f"Test set: {len(X_test)} records  (anomalous: {int(y_test.sum())})")
    print(f"Features: {feature_columns}\n")

    # --- Predict ---
    # IsolationForest.predict returns -1 for anomalies, +1 for inliers.
    # Convert to binary: 1 = anomalous (flagged), 0 = normal (inlier)
    raw_preds = model.predict(X_test)
    y_pred = (raw_preds == -1).astype(int)

    # Anomaly score: lower = more anomalous (negative of the sklearn score_samples output)
    anomaly_scores = -model.score_samples(X_test)  # higher score = more anomalous

    # --- Metrics ---
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall    = recall_score(y_test, y_pred, zero_division=0)
    f1        = f1_score(y_test, y_pred, zero_division=0)
    roc_auc   = roc_auc_score(y_test, anomaly_scores)
    cm        = confusion_matrix(y_test, y_pred)

    # --- Console report ---
    print("=" * 60)
    print("  ANOMALY DETECTION EVALUATION RESULTS")
    print("  (computed on held-out test set ONLY — model never saw this data)")
    print("=" * 60)
    print(f"  Precision : {precision:.4f}")
    print(f"  Recall    : {recall:.4f}")
    print(f"  F1 Score  : {f1:.4f}")
    print(f"  ROC-AUC   : {roc_auc:.4f}")
    print()
    print("Classification Report:")
    print(classification_report(y_test, y_pred, target_names=["normal", "anomalous"], zero_division=0))
    print("Confusion Matrix:")
    print(f"  TN={cm[0,0]}  FP={cm[0,1]}")
    print(f"  FN={cm[1,0]}  TP={cm[1,1]}")
    print()

    # --- Save metrics.json ---
    metrics = {
        "precision": round(float(precision), 6),
        "recall": round(float(recall), 6),
        "f1": round(float(f1), 6),
        "roc_auc": round(float(roc_auc), 6),
        "confusion_matrix": {
            "TN": int(cm[0, 0]),
            "FP": int(cm[0, 1]),
            "FN": int(cm[1, 0]),
            "TP": int(cm[1, 1]),
        },
        "test_set_size": int(len(X_test)),
        "anomalous_in_test": int(y_test.sum()),
        "contamination_rate_used": 0.05,
        "note": (
            "All metrics are computed exclusively on the held-out 20% test set. "
            "The model was trained on the remaining 80% without access to any labels. "
            "The contamination parameter (0.05) matches the injection rate in "
            "generate_dataset.py and is documented in docs/anomaly_methodology.md."
        ),
    }
    metrics_path = os.path.join(results_dir, "metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Metrics saved to: {metrics_path}")

    # --- Confusion matrix plot ---
    fig, ax = plt.subplots(figsize=(6, 5))
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=["normal", "anomalous"])
    disp.plot(ax=ax, colorbar=True, cmap="Blues")
    ax.set_title(
        "Isolation Forest — Confusion Matrix\n"
        f"(held-out test set, n={len(X_test)})\n"
        f"Precision={precision:.3f}  Recall={recall:.3f}  F1={f1:.3f}  AUC={roc_auc:.3f}",
        fontsize=10,
    )
    fig.tight_layout()
    cm_path = os.path.join(results_dir, "confusion_matrix.png")
    fig.savefig(cm_path, dpi=150)
    plt.close(fig)
    print(f"Confusion matrix plot saved to: {cm_path}")

    return metrics


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate trained anomaly-detection model.")
    parser.add_argument(
        "--model-dir", type=str, default="anomaly/model",
        help="Directory containing model artefacts (default: anomaly/model)",
    )
    parser.add_argument(
        "--results-dir", type=str, default="anomaly/results",
        help="Directory to write evaluation outputs (default: anomaly/results)",
    )
    args = parser.parse_args()

    evaluate(model_dir=args.model_dir, results_dir=args.results_dir)


if __name__ == "__main__":
    main()
