"""
test/test_anomaly.py
====================
Pytest suite for the Phase 4 anomaly detection pipeline.

Tests verify:
1. Dataset generation produces expected record counts and label ratios
2. Anomaly injection functions emit records with the correct label
3. Feature columns are present and numeric
4. Model training produces a saved model and split artefact
5. Evaluation produces a metrics dict with all required keys and sane values
"""

import json
import os
import sys
import tempfile

import numpy as np
import pandas as pd
import pytest

# Allow running from project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from anomaly.generate_dataset import (
    CONTAMINATION_RATE,
    _inject_gas_outlier_high,
    _inject_gas_outlier_low,
    _inject_impossible_timestamp,
    _inject_rapid_fire,
    generate_dataset,
)
from anomaly.train_model import FEATURE_COLUMNS, train
from anomaly.evaluate import evaluate


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def tmp_dirs(tmp_path_factory):
    base = tmp_path_factory.mktemp("anomaly_test")
    data_dir = base / "data"
    model_dir = base / "model"
    results_dir = base / "results"
    for d in (data_dir, model_dir, results_dir):
        d.mkdir()
    return {
        "data": data_dir,
        "model": model_dir,
        "results": results_dir,
        "dataset_csv": str(data_dir / "votes_dataset.csv"),
    }


@pytest.fixture(scope="session")
def dataset(tmp_dirs):
    """Generate dataset once for the whole session."""
    df = generate_dataset(n_normal=200, seed=42)
    df.to_csv(tmp_dirs["dataset_csv"], index=False)
    return df


@pytest.fixture(scope="session")
def trained_model(tmp_dirs, dataset):
    """Train model once for the whole session."""
    train(dataset_path=tmp_dirs["dataset_csv"], model_dir=str(tmp_dirs["model"]))
    return tmp_dirs["model"]


# ---------------------------------------------------------------------------
# 1. Dataset generation tests
# ---------------------------------------------------------------------------

class TestGenerateDataset:
    def test_returns_dataframe(self, dataset):
        assert isinstance(dataset, pd.DataFrame)

    def test_has_required_columns(self, dataset):
        from anomaly.train_model import FEATURE_COLUMNS as FC
        required = set(FC) | {"label", "session_id_hash"}
        assert required.issubset(set(dataset.columns))

    def test_normal_records_present(self, dataset):
        normal_count = (dataset["label"] == "normal").sum()
        assert normal_count >= 180, f"Expected ~200 normal records, got {normal_count}"

    def test_anomalous_records_present(self, dataset):
        anom_count = (dataset["label"] == "anomalous").sum()
        assert anom_count > 0, "No anomalous records were injected"

    def test_contamination_rate_approximately_correct(self, dataset):
        actual_rate = (dataset["label"] == "anomalous").mean()
        # Allow ±2% tolerance around the target rate
        assert abs(actual_rate - CONTAMINATION_RATE) < 0.02, (
            f"Actual contamination rate {actual_rate:.3f} far from target {CONTAMINATION_RATE}"
        )

    def test_feature_columns_are_numeric(self, dataset):
        from anomaly.train_model import FEATURE_COLUMNS as FC
        for col in FC:
            assert pd.api.types.is_numeric_dtype(dataset[col]), f"Column {col} is not numeric"

    def test_session_id_hash_is_hex_string(self, dataset):
        sample = dataset["session_id_hash"].iloc[0]
        assert isinstance(sample, str), "session_id_hash should be a string"
        assert len(sample) == 16, "session_id_hash should be 16 hex chars"


# ---------------------------------------------------------------------------
# 2. Anomaly injection function tests
# ---------------------------------------------------------------------------

class TestInjectionFunctions:
    def test_rapid_fire_label(self):
        rng = np.random.default_rng(0)
        records = _inject_rapid_fire(rng, prev_ts=1_700_000_000.0, n=3)
        assert all(r["label"] == "anomalous" for r in records)

    def test_rapid_fire_same_session(self):
        rng = np.random.default_rng(0)
        records = _inject_rapid_fire(rng, prev_ts=1_700_000_000.0, n=3)
        session_ids = {r["session_id_hash"] for r in records}
        assert len(session_ids) == 1, "Rapid-fire records should share the same session_id_hash"

    def test_rapid_fire_short_intervals(self):
        from anomaly.generate_dataset import RAPID_FIRE_INTERVAL_MAX_S
        rng = np.random.default_rng(0)
        records = _inject_rapid_fire(rng, prev_ts=1_700_000_000.0, n=5)
        for r in records:
            assert r["submission_interval_s"] <= RAPID_FIRE_INTERVAL_MAX_S

    def test_gas_outlier_high_label(self):
        rng = np.random.default_rng(0)
        rec = _inject_gas_outlier_high(rng, prev_ts=1_700_000_000.0)
        assert rec["label"] == "anomalous"

    def test_gas_outlier_high_value(self):
        from anomaly.generate_dataset import GAS_PRICE_OUTLIER_HIGH_GWEI
        rng = np.random.default_rng(0)
        rec = _inject_gas_outlier_high(rng, prev_ts=1_700_000_000.0)
        assert rec["gas_price_gwei"] >= GAS_PRICE_OUTLIER_HIGH_GWEI

    def test_gas_outlier_low_label(self):
        rng = np.random.default_rng(0)
        rec = _inject_gas_outlier_low(rng, prev_ts=1_700_000_000.0)
        assert rec["label"] == "anomalous"

    def test_gas_outlier_low_value(self):
        from anomaly.generate_dataset import GAS_PRICE_OUTLIER_LOW_GWEI
        rng = np.random.default_rng(0)
        rec = _inject_gas_outlier_low(rng, prev_ts=1_700_000_000.0)
        assert rec["gas_price_gwei"] <= GAS_PRICE_OUTLIER_LOW_GWEI

    def test_impossible_timestamp_label(self):
        rng = np.random.default_rng(0)
        rec = _inject_impossible_timestamp(rng, prev_ts=1_700_000_000.0)
        assert rec["label"] == "anomalous"

    def test_impossible_timestamp_negative_interval(self):
        rng = np.random.default_rng(0)
        rec = _inject_impossible_timestamp(rng, prev_ts=1_700_000_000.0)
        assert rec["submission_interval_s"] < 0, "Impossible timestamp should produce negative interval"


# ---------------------------------------------------------------------------
# 3. Model training tests
# ---------------------------------------------------------------------------

class TestTrainModel:
    def test_model_file_created(self, trained_model):
        model_path = os.path.join(str(trained_model), "isolation_forest.pkl")
        assert os.path.exists(model_path), "isolation_forest.pkl not created"

    def test_split_file_created(self, trained_model):
        split_path = os.path.join(str(trained_model), "train_test_split.npz")
        assert os.path.exists(split_path), "train_test_split.npz not created"

    def test_split_contains_required_keys(self, trained_model):
        split_path = os.path.join(str(trained_model), "train_test_split.npz")
        split = np.load(split_path, allow_pickle=True)
        for key in ("X_train", "X_test", "y_train", "y_test"):
            assert key in split, f"Missing key '{key}' in split file"

    def test_model_is_loadable(self, trained_model):
        import pickle
        model_path = os.path.join(str(trained_model), "isolation_forest.pkl")
        with open(model_path, "rb") as f:
            model = pickle.load(f)
        from sklearn.ensemble import IsolationForest
        assert isinstance(model, IsolationForest)

    def test_model_can_predict(self, trained_model, dataset):
        import pickle
        model_path = os.path.join(str(trained_model), "isolation_forest.pkl")
        with open(model_path, "rb") as f:
            model = pickle.load(f)
        X = dataset[FEATURE_COLUMNS].values.astype(float)
        preds = model.predict(X[:10])
        assert preds.shape == (10,)
        assert set(preds).issubset({-1, 1})


# ---------------------------------------------------------------------------
# 4. Evaluation tests
# ---------------------------------------------------------------------------

class TestEvaluate:
    def test_evaluate_returns_dict(self, trained_model, tmp_dirs):
        results = evaluate(
            model_dir=str(trained_model),
            results_dir=str(tmp_dirs["results"]),
        )
        assert isinstance(results, dict)

    def test_metrics_json_created(self, trained_model, tmp_dirs):
        metrics_path = os.path.join(str(tmp_dirs["results"]), "metrics.json")
        assert os.path.exists(metrics_path), "metrics.json not created"

    def test_metrics_json_has_required_keys(self, trained_model, tmp_dirs):
        metrics_path = os.path.join(str(tmp_dirs["results"]), "metrics.json")
        with open(metrics_path) as f:
            metrics = json.load(f)
        for key in ("precision", "recall", "f1", "roc_auc", "confusion_matrix"):
            assert key in metrics, f"Missing metric key: {key}"

    def test_metrics_in_valid_range(self, trained_model, tmp_dirs):
        metrics_path = os.path.join(str(tmp_dirs["results"]), "metrics.json")
        with open(metrics_path) as f:
            metrics = json.load(f)
        for key in ("precision", "recall", "f1", "roc_auc"):
            val = metrics[key]
            assert 0.0 <= val <= 1.0, f"Metric {key}={val} out of [0,1] range"

    def test_roc_auc_above_chance(self, trained_model, tmp_dirs):
        metrics_path = os.path.join(str(tmp_dirs["results"]), "metrics.json")
        with open(metrics_path) as f:
            metrics = json.load(f)
        # A trained model should perform better than random (AUC > 0.5)
        # Use a lenient threshold because the test set is small
        assert metrics["roc_auc"] > 0.5, (
            f"ROC-AUC {metrics['roc_auc']:.4f} is below chance — model may be broken"
        )

    def test_confusion_matrix_png_created(self, trained_model, tmp_dirs):
        cm_path = os.path.join(str(tmp_dirs["results"]), "confusion_matrix.png")
        assert os.path.exists(cm_path), "confusion_matrix.png not created"

    def test_confusion_matrix_counts_sum_to_test_size(self, trained_model, tmp_dirs):
        metrics_path = os.path.join(str(tmp_dirs["results"]), "metrics.json")
        with open(metrics_path) as f:
            metrics = json.load(f)
        cm = metrics["confusion_matrix"]
        total = cm["TN"] + cm["FP"] + cm["FN"] + cm["TP"]
        assert total == metrics["test_set_size"], (
            f"Confusion matrix counts ({total}) don't match test set size ({metrics['test_set_size']})"
        )
