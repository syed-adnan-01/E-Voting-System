const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { getDb } = require("../db/knex");
const { initSchema } = require("../db/schema");

const app = express();
const PORT = process.env.PORT || 4002;
const DB_FILE = path.join(__dirname, "tally_db.json");
const ANOMALY_SERVICE_URL = process.env.ANOMALY_SERVICE_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json());

const knex = getDb();
let initialized = false;

async function ensureDb() {
    if (!initialized) {
        await initSchema(knex);
        // If tally_db.json does not exist (e.g. wiped by test setup), clear test tables
        if (!fs.existsSync(DB_FILE)) {
            await knex("audit_logs").del();
            await knex("tallies").del();
            saveSnapshot({ tallies: {}, auditLogs: {} });
        }
        initialized = true;
    }
}

function saveSnapshot(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
        // Non-fatal
    }
}

async function syncSnapshot() {
    try {
        const talliesRows = await knex("tallies").select("*");
        const auditRows = await knex("audit_logs").select("*").orderBy("timestamp", "desc");

        const talliesObj = {};
        for (const row of talliesRows) {
            talliesObj[row.election_id] = {
                total_votes: row.total_votes,
                candidate_totals: typeof row.candidate_totals === "string" ? JSON.parse(row.candidate_totals) : row.candidate_totals,
                proof_types: {
                    groth16: row.proof_types_groth16,
                    lattice: row.proof_types_lattice
                }
            };
        }

        const auditLogsObj = {};
        for (const log of auditRows) {
            if (!auditLogsObj[log.election_id]) {
                auditLogsObj[log.election_id] = [];
            }
            auditLogsObj[log.election_id].push({
                nullifier_hash: log.nullifier_hash,
                proof_type: log.proof_type,
                tx_hash: log.tx_hash,
                timestamp: Number(log.timestamp)
            });
        }

        saveSnapshot({
            tallies: talliesObj,
            auditLogs: auditLogsObj
        });
    } catch (e) {
        // Non-fatal
    }
}

// --- TALLY SERVICE ENDPOINTS ---

// GET /health
app.get("/health", async (req, res) => {
    try {
        await ensureDb();
        res.json({ status: "ok", service: "tallying-service", database: "connected", timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ status: "error", message: e.message });
    }
});

// POST /record-vote — Record a vote submission & aggregate atomically
app.post("/record-vote", async (req, res) => {
    try {
        await ensureDb();

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
        const candidateIdx = String(candidate_index);
        const pType = Number(proof_type) === 1 ? "lattice" : "groth16";
        const ts = timestamp || Date.now();
        const hash = tx_hash || ("0x" + Math.random().toString(16).substring(2).padStart(64, "0"));

        let auditRecord;
        let finalTally;

        // Atomic Transaction: checks nullifier uniqueness at DB level and aggregates tally
        try {
            await knex.transaction(async (trx) => {
                // Ensure election exists in elections table for referential integrity
                const electionExists = await trx("elections").where({ id: eid }).first();
                if (!electionExists) {
                    await trx("elections").insert({
                        id: eid,
                        name: `Election ${eid}`,
                        candidates: JSON.stringify([]),
                        merkle_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
                        next_leaf_index: 0,
                        status: "active",
                        open_at: new Date().toISOString(),
                        close_at: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }).onConflict("id").ignore();
                }

                // Check if nullifier already exists
                const existing = await trx("audit_logs").where({ nullifier_hash }).first();
                if (existing) {
                    const err = new Error("Nullifier has already been tallied for this election");
                    err.isDuplicateNullifier = true;
                    throw err;
                }

                // Insert into audit_logs table (enforced by UNIQUE constraint on nullifier_hash)
                auditRecord = {
                    nullifier_hash,
                    proof_type: pType,
                    tx_hash: hash,
                    timestamp: ts
                };

                await trx("audit_logs").insert({
                    election_id: eid,
                    nullifier_hash,
                    proof_type: pType,
                    tx_hash: hash,
                    timestamp: ts,
                    encrypted_vote: encrypted_vote || null
                });

                // Fetch or initialize tally
                let tallyRow = await trx("tallies").where({ election_id: eid }).first();

                let candidateTotals = {};
                let totalVotes = 0;
                let groth16Count = 0;
                let latticeCount = 0;

                if (tallyRow) {
                    totalVotes = tallyRow.total_votes;
                    candidateTotals = typeof tallyRow.candidate_totals === "string" 
                        ? JSON.parse(tallyRow.candidate_totals) 
                        : (tallyRow.candidate_totals || {});
                    groth16Count = tallyRow.proof_types_groth16;
                    latticeCount = tallyRow.proof_types_lattice;
                }

                // Increment counts
                totalVotes += 1;
                candidateTotals[candidateIdx] = (candidateTotals[candidateIdx] || 0) + 1;
                if (pType === "lattice") {
                    latticeCount += 1;
                } else {
                    groth16Count += 1;
                }

                const updatedTallyData = {
                    total_votes: totalVotes,
                    candidate_totals: JSON.stringify(candidateTotals),
                    proof_types_groth16: groth16Count,
                    proof_types_lattice: latticeCount
                };

                if (tallyRow) {
                    await trx("tallies").where({ election_id: eid }).update(updatedTallyData);
                } else {
                    await trx("tallies").insert({
                        election_id: eid,
                        ...updatedTallyData
                    });
                }

                finalTally = {
                    total_votes: totalVotes,
                    candidate_totals: candidateTotals,
                    proof_types: {
                        groth16: groth16Count,
                        lattice: latticeCount
                    }
                };
            });
        } catch (trxErr) {
            if (trxErr.isDuplicateNullifier || trxErr.message.includes("UNIQUE constraint failed") || trxErr.message.includes("duplicate key")) {
                return res.status(400).json({ error: "Nullifier has already been tallied for this election" });
            }
            throw trxErr;
        }

        await syncSnapshot();

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
                    console.log("Anomaly stream ping error:", err.message);
                });
            } catch (e) {
                // Ignore fetch errors
            }
        }

        res.json({
            success: true,
            message: "Vote recorded and aggregated successfully",
            record: auditRecord,
            tally: finalTally
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function computeWinner(candidateTotals, totalVotes) {
    if (!candidateTotals || totalVotes === 0) return null;
    let maxVotes = -1;
    let winners = [];

    Object.keys(candidateTotals).forEach(candidateIdx => {
        const count = candidateTotals[candidateIdx];
        if (count > maxVotes) {
            maxVotes = count;
            winners = [candidateIdx];
        } else if (count === maxVotes && maxVotes > 0) {
            winners.push(candidateIdx);
        }
    });

    if (maxVotes <= 0 || winners.length === 0) return null;

    return {
        winning_indices: winners,
        max_votes: maxVotes,
        is_tie: winners.length > 1,
        percentage: Math.round((maxVotes / totalVotes) * 100)
    };
}

// GET /tally/:election_id — Retrieve aggregated vote totals
app.get("/tally/:election_id", async (req, res) => {
    try {
        await ensureDb();
        const eid = String(req.params.election_id);

        const tallyRow = await knex("tallies").where({ election_id: eid }).first();
        const tally = tallyRow ? {
            total_votes: tallyRow.total_votes,
            candidate_totals: typeof tallyRow.candidate_totals === "string" ? JSON.parse(tallyRow.candidate_totals) : tallyRow.candidate_totals,
            proof_types: {
                groth16: tallyRow.proof_types_groth16,
                lattice: tallyRow.proof_types_lattice
            }
        } : {
            total_votes: 0,
            candidate_totals: {},
            proof_types: { groth16: 0, lattice: 0 }
        };

        const winner = computeWinner(tally.candidate_totals, tally.total_votes);

        res.json({
            success: true,
            election_id: eid,
            total_votes: tally.total_votes,
            candidate_totals: tally.candidate_totals,
            proof_types: tally.proof_types,
            winner
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /audit-log/:election_id — Public audit log (Zero-PII) with pagination
app.get("/audit-log/:election_id", async (req, res) => {
    try {
        await ensureDb();
        const eid = String(req.params.election_id);
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        const offset = req.query.offset ? parseInt(req.query.offset) : 0;

        const countQuery = await knex("audit_logs").where({ election_id: eid }).count("id as count").first();
        const totalRecords = Number(countQuery?.count || 0);

        let query = knex("audit_logs")
            .where({ election_id: eid })
            .select("nullifier_hash", "proof_type", "tx_hash", "timestamp")
            .orderBy("timestamp", "desc");

        if (limit) {
            query = query.limit(limit).offset(offset);
        }

        const logs = await query;
        const formatted = logs.map(l => ({
            nullifier_hash: l.nullifier_hash,
            proof_type: l.proof_type,
            tx_hash: l.tx_hash,
            timestamp: Number(l.timestamp)
        }));

        res.json({
            success: true,
            election_id: eid,
            total_records: totalRecords,
            audit_log: formatted
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
