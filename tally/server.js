const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4002;
const DB_FILE = path.join(__dirname, "tally_db.json");
const ANOMALY_SERVICE_URL = process.env.ANOMALY_SERVICE_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json());

// In-memory data store with file persistence
let store = {
    tallies: {},    // election_id -> { total_votes, candidate_totals: { [idx]: count }, proof_types: { groth16: count, lattice: count } }
    auditLogs: {}   // election_id -> [ { nullifier_hash, proof_type, tx_hash, timestamp } ]
};

function loadStore() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, "utf8");
            store = JSON.parse(data);
        } catch (e) {
            console.error("Error reading tally DB file, initializing empty store:", e.message);
        }
    }
}

function saveStore() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), "utf8");
    } catch (e) {
        console.error("Error writing tally DB file:", e.message);
    }
}

loadStore();

// --- TALLY SERVICE ENDPOINTS ---

// GET /health
app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "tallying-service", timestamp: new Date().toISOString() });
});

// POST /record-vote — Record a vote submission & aggregate
app.post("/record-vote", async (req, res) => {
    const {
        election_id,
        nullifier_hash,
        candidate_index,
        encrypted_vote,
        proof_type, // 0 = Groth16, 1 = QRZ-KPA Lattice
        tx_hash,
        timestamp,
        metrics
    } = req.body;

    if (!election_id || nullifier_hash === undefined || candidate_index === undefined) {
        return res.status(400).json({ error: "Missing required vote parameters: election_id, nullifier_hash, candidate_index" });
    }

    const eid = String(election_id);

    // Initialize election tally if not present
    if (!store.tallies[eid]) {
        store.tallies[eid] = {
            total_votes: 0,
            candidate_totals: {},
            proof_types: { groth16: 0, lattice: 0 }
        };
        store.auditLogs[eid] = [];
    }

    // Check for double recording of nullifier
    const alreadyRecorded = store.auditLogs[eid].some(log => log.nullifier_hash === nullifier_hash);
    if (alreadyRecorded) {
        return res.status(400).json({ error: "Nullifier has already been tallied for this election" });
    }

    const candidateIdx = String(candidate_index);
    const pType = Number(proof_type) === 1 ? "lattice" : "groth16";
    const ts = timestamp || Date.now();
    const hash = tx_hash || ("0x" + Math.random().toString(16).substring(2).padStart(64, "0"));

    // Update tallies
    store.tallies[eid].total_votes += 1;
    store.tallies[eid].candidate_totals[candidateIdx] = (store.tallies[eid].candidate_totals[candidateIdx] || 0) + 1;
    store.tallies[eid].proof_types[pType] += 1;

    // Append to public non-PII audit log
    const auditRecord = {
        nullifier_hash,
        proof_type: pType,
        tx_hash: hash,
        timestamp: ts
    };
    store.auditLogs[eid].unshift(auditRecord); // newest first

    saveStore();

    // Asynchronously notify live anomaly detection service if metrics are provided
    if (metrics) {
        try {
            fetch(`${ANOMALY_SERVICE_URL}/analyze_submission`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: eid,
                    nullifier_hash,
                    tx_hash: hash,
                    timestamp: metrics.timestamp || Math.floor(ts / 1000),
                    verification_latency_ms: metrics.verification_latency_ms || 120.0,
                    gas_price_gwei: metrics.gas_price_gwei || 25.0,
                    submission_interval_s: metrics.submission_interval_s || 5.0
                })
            }).catch(err => {
                // Silently log anomaly stream notification errors without failing vote tallying
                console.log("Anomaly stream ping error:", err.message);
            });
        } catch (e) {
            // Ignore fetch availability errors
        }
    }

    res.json({
        success: true,
        message: "Vote recorded and aggregated successfully",
        record: auditRecord,
        tally: store.tallies[eid]
    });
});

// GET /tally/:election_id — Retrieve aggregated vote totals
app.get("/tally/:election_id", (req, res) => {
    const eid = String(req.params.election_id);
    const tally = store.tallies[eid] || {
        total_votes: 0,
        candidate_totals: {},
        proof_types: { groth16: 0, lattice: 0 }
    };

    res.json({
        success: true,
        election_id: eid,
        total_votes: tally.total_votes,
        candidate_totals: tally.candidate_totals,
        proof_types: tally.proof_types
    });
});

// GET /audit-log/:election_id — Public audit log (Zero-PII)
app.get("/audit-log/:election_id", (req, res) => {
    const eid = String(req.params.election_id);
    const logs = store.auditLogs[eid] || [];
    res.json({
        success: true,
        election_id: eid,
        total_records: logs.length,
        audit_log: logs
    });
});

// GET /verify-election/:election_id — Execute Independent Verifier audit
app.get("/verify-election/:election_id", (req, res) => {
    const eid = String(req.params.election_id);
    const { exec } = require("child_process");
    const tmpFile = path.join(__dirname, `../scratch_audit_${eid}_${Date.now()}.json`);
    const regUrl = process.env.REGISTRAR_URL || "http://localhost:4000";
    const tallyUrl = `http://localhost:${PORT}`;
    const cmd = `./venv/bin/python verifier/verify_election.py --election ${eid} --registrar-url ${regUrl} --tally-url ${tallyUrl} --export-json ${tmpFile}`;

    exec(cmd, { cwd: path.join(__dirname, "..") }, (error, stdout, stderr) => {
        let report = null;
        if (fs.existsSync(tmpFile)) {
            try {
                report = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
                fs.unlinkSync(tmpFile);
            } catch (e) {}
        }
        if (report) {
            res.json({ success: true, ...report, stdout });
        } else {
            res.status(500).json({ success: false, error: stderr || error?.message || "Verification failed", stdout });
        }
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Tallying Service running on http://localhost:${PORT}`);
    });
}

module.exports = app;
