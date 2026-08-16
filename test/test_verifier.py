"""
test/test_verifier.py
=====================
Pytest suite for the Independent Election Verifier CLI (verifier/verify_election.py).
"""

import os
import sys
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from verifier.verify_election import verify_election


@pytest.fixture
def mock_clean_election_data():
    event_data = {
        "event": {
            "id": "1",
            "name": "Test Election 2026",
            "status": "closed",
            "close_at": "2026-08-16T12:00:00Z",
            "merkle_root": "0x1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2"
        }
    }
    root_data = {
        "merkle_root": "0x1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2"
    }
    tally_data = {
        "total_votes": 4,
        "candidate_totals": {"0": 1, "1": 1, "2": 1, "3": 1},
        "proof_types": {"groth16": 2, "lattice": 2}
    }
    audit_data = {
        "total_records": 4,
        "audit_log": [
            {"nullifier_hash": "0x" + "1" * 64, "timestamp": 1700000000, "proof_type": "groth16", "tx_hash": "0xabc"},
            {"nullifier_hash": "0x" + "2" * 64, "timestamp": 1700000001, "proof_type": "groth16", "tx_hash": "0xdef"},
            {"nullifier_hash": "0x" + "3" * 64, "timestamp": 1700000002, "proof_type": "lattice", "tx_hash": "0x123"},
            {"nullifier_hash": "0x" + "4" * 64, "timestamp": 1700000003, "proof_type": "lattice", "tx_hash": "0x456"}
        ]
    }
    return event_data, root_data, tally_data, audit_data


def test_verify_election_success(mock_clean_election_data):
    event_data, root_data, tally_data, audit_data = mock_clean_election_data

    def mock_get(url, **kwargs):
        mock_res = MagicMock()
        mock_res.status_code = 200
        if "/events/" in url:
            mock_res.json.return_value = event_data
        elif "/merkle-root/" in url:
            mock_res.json.return_value = root_data
        elif "/tally/" in url:
            mock_res.json.return_value = tally_data
        elif "/audit-log/" in url:
            mock_res.json.return_value = audit_data
        return mock_res

    with patch("requests.get", side_effect=mock_get):
        passed, report = verify_election("1", "http://localhost:4000", "http://localhost:4002")

    assert passed is True
    assert report["passed"] is True
    assert report["total_votes"] == 4
    assert report["integrity"] == "VERIFIED"


def test_verify_election_duplicate_nullifier(mock_clean_election_data):
    event_data, root_data, tally_data, audit_data = mock_clean_election_data
    # Inject duplicate nullifier
    audit_data["audit_log"][1]["nullifier_hash"] = audit_data["audit_log"][0]["nullifier_hash"]

    def mock_get(url, **kwargs):
        mock_res = MagicMock()
        mock_res.status_code = 200
        if "/events/" in url:
            mock_res.json.return_value = event_data
        elif "/merkle-root/" in url:
            mock_res.json.return_value = root_data
        elif "/tally/" in url:
            mock_res.json.return_value = tally_data
        elif "/audit-log/" in url:
            mock_res.json.return_value = audit_data
        return mock_res

    with patch("requests.get", side_effect=mock_get):
        passed, report = verify_election("1", "http://localhost:4000", "http://localhost:4002")

    assert passed is False
    assert report["integrity"] == "FAILED"
    nullifier_item = next(i for i in report["audit_items"] if i["item"] == "Nullifier Uniqueness")
    assert nullifier_item["status"] == "FAIL"


def test_verify_election_tally_discrepancy(mock_clean_election_data):
    event_data, root_data, tally_data, audit_data = mock_clean_election_data
    # Manipulate reported tally total
    tally_data["total_votes"] = 999

    def mock_get(url, **kwargs):
        mock_res = MagicMock()
        mock_res.status_code = 200
        if "/events/" in url:
            mock_res.json.return_value = event_data
        elif "/merkle-root/" in url:
            mock_res.json.return_value = root_data
        elif "/tally/" in url:
            mock_res.json.return_value = tally_data
        elif "/audit-log/" in url:
            mock_res.json.return_value = audit_data
        return mock_res

    with patch("requests.get", side_effect=mock_get):
        passed, report = verify_election("1", "http://localhost:4000", "http://localhost:4002")

    assert passed is False
    tally_item = next(i for i in report["audit_items"] if i["item"] == "Tally Integrity")
    assert tally_item["status"] == "FAIL"


def test_verify_election_pii_leak(mock_clean_election_data):
    event_data, root_data, tally_data, audit_data = mock_clean_election_data
    # Inject PII secret into audit log record
    audit_data["audit_log"][0]["credential_secret"] = "voter_secret_12345"

    def mock_get(url, **kwargs):
        mock_res = MagicMock()
        mock_res.status_code = 200
        if "/events/" in url:
            mock_res.json.return_value = event_data
        elif "/merkle-root/" in url:
            mock_res.json.return_value = root_data
        elif "/tally/" in url:
            mock_res.json.return_value = tally_data
        elif "/audit-log/" in url:
            mock_res.json.return_value = audit_data
        return mock_res

    with patch("requests.get", side_effect=mock_get):
        passed, report = verify_election("1", "http://localhost:4000", "http://localhost:4002")

    assert passed is False
    pii_item = next(i for i in report["audit_items"] if i["item"] == "Zero-PII Audit Ledger")
    assert pii_item["status"] == "FAIL"
