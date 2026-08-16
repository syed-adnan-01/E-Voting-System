"""
test/test_phase7_anomaly.py
============================
Pytest suite verifying the FastAPI live anomaly monitoring service (anomaly/server.py).
Tests health check, submission telemetry analysis, IsolationForest inference,
anomaly flagging, and retrieval of flagged anomalies by election ID.
"""

import os
import sys
import pytest
from fastapi.testclient import TestClient

# Add workspace root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from anomaly.server import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "anomaly-detection-service"
    assert "model_loaded" in data

def test_normal_vote_submission():
    payload = {
        "election_id": "702",
        "nullifier_hash": "0xnullifier_normal_1",
        "tx_hash": "0xtx_normal_1",
        "timestamp": 1700000000.0,
        "verification_latency_ms": 120.0,
        "gas_price_gwei": 25.0,
        "submission_interval_s": 5.0
    }
    response = client.post("/analyze_submission", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "is_anomalous" in data

def test_anomalous_vote_submission():
    # Extreme gas price and rapid interval attack vector
    payload = {
        "election_id": "702",
        "nullifier_hash": "0xnullifier_attack_1",
        "tx_hash": "0xtx_attack_1",
        "timestamp": 1700000005.0,
        "verification_latency_ms": 4500.0,
        "gas_price_gwei": 650.0,
        "submission_interval_s": 0.10
    }
    response = client.post("/analyze_submission", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["is_anomalous"] is True
    assert data["prediction"] == -1
    assert data["severity"] in ["CRITICAL", "HIGH", "MEDIUM"]

def test_get_anomalies_by_election():
    response = client.get("/anomalies/702")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["election_id"] == "702"
    assert data["total_anomalies"] >= 1
    assert len(data["anomalies"]) >= 1
    assert data["anomalies"][0]["nullifier_hash"] == "0xnullifier_attack_1"
