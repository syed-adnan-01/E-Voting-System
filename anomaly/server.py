"""
anomaly/server.py
=================
FastAPI server for real-time live anomaly monitoring of vote submissions.
Loads the trained IsolationForest model and streams real incoming vote telemetry metrics,
surfacing flagged anomalies for live admin inspection.
"""

import os
import pickle
import json
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model_and_storage()
    yield

app = FastAPI(
    title="PQ-ZKVote Live Anomaly Detection Service",
    description="Real-time IsolationForest anomaly monitor for E-Voting submission telemetry",
    version="0.1.0",
    lifespan=lifespan
)

# Enable CORS for dashboard integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "isolation_forest.pkl")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
ANOMALIES_FILE = os.path.join(RESULTS_DIR, "live_anomalies.json")

# Global state
model = None
live_anomalies: List[Dict[str, Any]] = []

def load_model_and_storage():
    global model, live_anomalies
    if os.path.exists(MODEL_PATH):
        try:
            with open(MODEL_PATH, "rb") as f:
                model = pickle.load(f)
            print(f"[Anomaly Service] Successfully loaded trained IsolationForest model from {MODEL_PATH}")
        except Exception as e:
            print(f"[Anomaly Service] Warning: Failed to load model: {e}")
            model = None
    else:
        print(f"[Anomaly Service] Warning: Model file not found at {MODEL_PATH}")

    os.makedirs(RESULTS_DIR, exist_ok=True)
    if os.path.exists(ANOMALIES_FILE):
        try:
            with open(ANOMALIES_FILE, "r") as f:
                live_anomalies = json.load(f)
        except Exception:
            live_anomalies = []

def save_anomalies():
    try:
        with open(ANOMALIES_FILE, "w") as f:
            json.dump(live_anomalies, f, indent=2)
    except Exception as e:
        print(f"[Anomaly Service] Error saving anomalies: {e}")

class VoteSubmissionTelemetry(BaseModel):
    election_id: str = Field(..., json_schema_extra={"example": "1"})
    nullifier_hash: str = Field(..., json_schema_extra={"example": "0x1234567890abcdef"})
    tx_hash: Optional[str] = Field(None, json_schema_extra={"example": "0xabcdef1234567890"})
    timestamp: float = Field(..., json_schema_extra={"example": 1700000000.0})
    verification_latency_ms: float = Field(..., json_schema_extra={"example": 120.0})
    gas_price_gwei: float = Field(..., json_schema_extra={"example": 25.0})
    submission_interval_s: float = Field(..., json_schema_extra={"example": 5.0})


def detect_anomaly_reasons(interval: float, gas: float, latency: float) -> tuple[str, str, int]:
    """Determine human-readable reason, severity rating, and risk score for flagged anomaly."""
    reasons = []
    risk_score = 65

    if interval < 1.0:
        reasons.append(f"Rapid-fire burst submission ({interval:.2f}s interval)")
        risk_score += 20
    if gas > 150.0:
        reasons.append(f"Abnormal gas price spike ({gas:.1f} Gwei)")
        risk_score += 15
    elif gas < 2.0:
        reasons.append(f"Suspicious sub-market gas fee ({gas:.1f} Gwei)")
        risk_score += 10
    if latency > 1000.0:
        reasons.append(f"High proof verification latency ({latency:.0f}ms)")
        risk_score += 10

    if not reasons:
        reasons.append("Outlier statistical metric distribution")

    reason_str = " | ".join(reasons)
    risk_score = min(risk_score, 99)

    if risk_score >= 85:
        severity = "CRITICAL"
    elif risk_score >= 70:
        severity = "HIGH"
    else:
        severity = "MEDIUM"

    return reason_str, severity, risk_score

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "anomaly-detection-service",
        "model_loaded": model is not None,
        "total_anomalies_flagged": len(live_anomalies)
    }

@app.post("/analyze_submission")
def analyze_submission(telemetry: VoteSubmissionTelemetry):
    global model, live_anomalies

    features = np.array([[
        telemetry.timestamp,
        telemetry.verification_latency_ms,
        telemetry.gas_price_gwei,
        telemetry.submission_interval_s
    ]], dtype=np.float64)

    is_anomalous = False
    prediction = 1
    score = 0.0

    if model is not None:
        try:
            prediction = int(model.predict(features)[0]) # -1 = anomaly, 1 = normal
            score = float(model.decision_function(features)[0])
            is_anomalous = (prediction == -1)
        except Exception as e:
            print(f"[Anomaly Service] Inference error: {e}")

    # Explicit threshold fallback if model is not loaded or for extreme outliers
    if not is_anomalous and (telemetry.submission_interval_s < 0.5 or telemetry.gas_price_gwei > 200.0):
        is_anomalous = True
        prediction = -1
        score = -0.15

    flag_reason = "Normal Submission"
    severity = "INFO"
    risk_score = 0

    if is_anomalous:
        flag_reason, severity, risk_score = detect_anomaly_reasons(
            telemetry.submission_interval_s,
            telemetry.gas_price_gwei,
            telemetry.verification_latency_ms
        )

        anomaly_record = {
            "election_id": str(telemetry.election_id),
            "nullifier_hash": telemetry.nullifier_hash,
            "tx_hash": telemetry.tx_hash or "0x" + "0"*64,
            "timestamp": telemetry.timestamp,
            "verification_latency_ms": telemetry.verification_latency_ms,
            "gas_price_gwei": telemetry.gas_price_gwei,
            "submission_interval_s": telemetry.submission_interval_s,
            "anomaly_score": round(score, 4),
            "risk_score": risk_score,
            "severity": severity,
            "flag_reason": flag_reason,
            "status": "flagged_for_review"
        }

        # Avoid duplicate nullifier entries in live list
        if not any(a["nullifier_hash"] == telemetry.nullifier_hash and a["election_id"] == str(telemetry.election_id) for a in live_anomalies):
            live_anomalies.insert(0, anomaly_record)
            save_anomalies()

    return {
        "success": True,
        "is_anomalous": is_anomalous,
        "prediction": prediction,
        "anomaly_score": round(score, 4),
        "severity": severity,
        "flag_reason": flag_reason
    }

@app.get("/anomalies/{election_id}")
def get_anomalies_by_election(election_id: str):
    eid = str(election_id)
    filtered = [a for a in live_anomalies if str(a.get("election_id")) == eid]
    return {
        "success": True,
        "election_id": eid,
        "total_anomalies": len(filtered),
        "anomalies": filtered
    }

@app.get("/anomalies")
def get_all_anomalies():
    return {
        "success": True,
        "total_anomalies": len(live_anomalies),
        "anomalies": live_anomalies
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
