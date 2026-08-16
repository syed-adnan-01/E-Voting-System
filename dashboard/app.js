const REGISTRAR_URL = "http://localhost:4000";
const TALLY_URL = "http://localhost:4002";
const ANOMALY_URL = "http://localhost:8000";

// DOM Elements
const electionSelect = document.getElementById("electionSelect");
const statusRegistrar = document.getElementById("statusRegistrar");
const statusTally = document.getElementById("statusTally");
const statusAnomaly = document.getElementById("statusAnomaly");

const kpiTotalVotes = document.getElementById("kpiTotalVotes");
const kpiGroth16Votes = document.getElementById("kpiGroth16Votes");
const kpiLatticeVotes = document.getElementById("kpiLatticeVotes");
const kpiAnomalyCount = document.getElementById("kpiAnomalyCount");
const kpiElectionStatus = document.getElementById("kpiElectionStatus");

const tallyContainer = document.getElementById("tallyContainer");
const barGroth16 = document.getElementById("barGroth16");
const barLattice = document.getElementById("barLattice");
const anomalyFeed = document.getElementById("anomalyFeed");
const auditTableBody = document.getElementById("auditTableBody");

const btnRefresh = document.getElementById("btnRefresh");
const btnSimulateVote = document.getElementById("btnSimulateVote");
const btnSimulateAttack = document.getElementById("btnSimulateAttack");

// State
let selectedElectionId = "1";
let electionsMap = {};

// --- INITIALIZATION ---
async function initDashboard() {
    await checkServiceStatuses();
    await fetchElections();
    await refreshAllData();

    // Auto refresh every 3 seconds
    setInterval(refreshAllData, 3000);
}

// Check backend service health
async function checkServiceStatuses() {
    updateStatusPill(statusRegistrar, await pingService(`${REGISTRAR_URL}/events`));
    updateStatusPill(statusTally, await pingService(`${TALLY_URL}/health`));
    updateStatusPill(statusAnomaly, await pingService(`${ANOMALY_URL}/health`));
}

async function pingService(url) {
    try {
        const res = await fetch(url, { method: "GET" });
        return res.ok;
    } catch {
        return false;
    }
}

function updateStatusPill(el, isOnline) {
    if (isOnline) {
        el.classList.add("online");
        el.classList.remove("offline");
    } else {
        el.classList.add("offline");
        el.classList.remove("online");
    }
}

// Fetch Elections from Registrar
async function fetchElections() {
    try {
        const res = await fetch(`${REGISTRAR_URL}/events`);
        const data = await res.json();
        if (data.success && data.events.length > 0) {
            electionsMap = {};
            data.events.forEach(e => { electionsMap[String(e.id)] = e; });
            
            electionSelect.innerHTML = data.events.map(e => `
                <option value="${e.id}">#${e.id} — ${escapeHtml(e.name)}</option>
            `).join("");
            selectedElectionId = String(data.events[0].id);
        } else {
            // Default placeholder if registrar server is offline or empty
            electionsMap["1"] = { id: "1", name: "Default System Election", candidates: ["Alice (Party A)", "Bob (Party B)", "Charlie (Party C)"] };
            electionSelect.innerHTML = `<option value="1">#1 — Default System Election</option>`;
            selectedElectionId = "1";
        }
    } catch {
        electionsMap["1"] = { id: "1", name: "Default System Election", candidates: ["Alice (Party A)", "Bob (Party B)", "Charlie (Party C)"] };
        electionSelect.innerHTML = `<option value="1">#1 — Default System Election</option>`;
        selectedElectionId = "1";
    }
}

electionSelect.addEventListener("change", (e) => {
    selectedElectionId = e.target.value;
    refreshAllData();
});

// Refresh Tally, Anomalies, and Audit Log
async function refreshAllData() {
    await checkServiceStatuses();
    await fetchTallyData();
    await fetchAnomalyData();
    await fetchAuditLog();
}

btnRefresh.addEventListener("click", refreshAllData);

// Fetch Tally Data
async function fetchTallyData() {
    try {
        const res = await fetch(`${TALLY_URL}/tally/${selectedElectionId}`);
        const data = await res.json();

        if (data.success) {
            const total = data.total_votes || 0;
            const candidateTotals = data.candidate_totals || {};
            const proofTypes = data.proof_types || { groth16: 0, lattice: 0 };

            kpiTotalVotes.textContent = total;
            kpiGroth16Votes.textContent = proofTypes.groth16 || 0;
            kpiLatticeVotes.textContent = proofTypes.lattice || 0;

            const groth16Pct = total > 0 ? Math.round(((proofTypes.groth16 || 0) / total) * 100) : 50;
            const latticePct = total > 0 ? (100 - groth16Pct) : 50;

            barGroth16.style.width = `${groth16Pct}%`;
            barGroth16.textContent = `Groth16 (${groth16Pct}%)`;

            barLattice.style.width = `${latticePct}%`;
            barLattice.textContent = `QRZ-KPA Lattice (${latticePct}%)`;

            renderCandidateTally(candidateTotals, total);
        }
    } catch {
        renderCandidateTally({}, 0);
    }
}

function renderCandidateTally(candidateTotals, totalVotes) {
    const election = electionsMap[selectedElectionId] || { candidates: ["Option 1", "Option 2"] };
    const candidates = election.candidates || [];

    if (candidates.length === 0) {
        tallyContainer.innerHTML = `<div class="empty-state">No candidates configured for election #${selectedElectionId}.</div>`;
        return;
    }

    tallyContainer.innerHTML = candidates.map((name, idx) => {
        const count = candidateTotals[String(idx)] || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

        return `
            <div class="candidate-bar-item">
                <div class="candidate-info">
                    <span>${escapeHtml(name)}</span>
                    <span class="candidate-votes">${count} votes (${pct}%)</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join("");
}

// Fetch Live Anomaly Feed
async function fetchAnomalyData() {
    try {
        const res = await fetch(`${ANOMALY_URL}/anomalies/${selectedElectionId}`);
        const data = await res.json();

        if (data.success) {
            const anomalies = data.anomalies || [];
            kpiAnomalyCount.textContent = anomalies.length;

            if (anomalies.length === 0) {
                anomalyFeed.innerHTML = `
                    <div class="empty-state green-state">
                        <div class="empty-icon">✓</div>
                        <p>No anomalous activity detected. All submission parameters nominal.</p>
                    </div>
                `;
            } else {
                anomalyFeed.innerHTML = anomalies.map(a => `
                    <div class="anomaly-item">
                        <div class="anomaly-header">
                            <span class="badge-severity badge-${a.severity}">${a.severity} (Score ${a.risk_score}/100)</span>
                            <span class="anomaly-time">${new Date(a.timestamp * 1000).toLocaleTimeString()}</span>
                        </div>
                        <div class="anomaly-reason">${escapeHtml(a.flag_reason)}</div>
                        <div class="anomaly-meta">
                            <span>Nullifier: ${truncateHash(a.nullifier_hash)}</span>
                            <span>Interval: ${a.submission_interval_s}s</span>
                            <span>Gas: ${a.gas_price_gwei} Gwei</span>
                        </div>
                    </div>
                `).join("");
            }
        }
    } catch {
        kpiAnomalyCount.textContent = "0";
    }
}

// Fetch Public Zero-PII Audit Log
async function fetchAuditLog() {
    try {
        const res = await fetch(`${TALLY_URL}/audit-log/${selectedElectionId}`);
        const data = await res.json();

        if (data.success && data.audit_log.length > 0) {
            auditTableBody.innerHTML = data.audit_log.map(log => `
                <tr>
                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                    <td class="font-mono">${escapeHtml(log.nullifier_hash)}</td>
                    <td>
                        <span class="proof-tag ${log.proof_type === 'lattice' ? 'proof-lattice' : 'proof-groth16'}">
                            ${log.proof_type === 'lattice' ? 'QRZ-KPA Lattice' : 'Groth16'}
                        </span>
                    </td>
                    <td class="font-mono">${truncateHash(log.tx_hash)}</td>
                    <td style="color: var(--accent-green); font-weight: 600;">VERIFIED</td>
                </tr>
            `).join("");
        } else {
            auditTableBody.innerHTML = `<tr><td colspan="5" class="empty-table">No votes recorded on ledger yet.</td></tr>`;
        }
    } catch {
        auditTableBody.innerHTML = `<tr><td colspan="5" class="empty-table">Tally service offline.</td></tr>`;
    }
}

// --- DEMO SIMULATION ACTIONS ---

// Simulate Valid Vote Submission
btnSimulateVote.addEventListener("click", async () => {
    btnSimulateVote.disabled = true;
    btnSimulateVote.textContent = "Recording...";

    const election = electionsMap[selectedElectionId] || { candidates: ["Option A", "Option B"] };
    const randomCandidate = Math.floor(Math.random() * election.candidates.length);
    const isLattice = Math.random() > 0.5;
    const randomNullifier = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
    const randomTxHash = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");

    try {
        await fetch(`${TALLY_URL}/record-vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: selectedElectionId,
                nullifier_hash: randomNullifier,
                candidate_index: randomCandidate,
                proof_type: isLattice ? 1 : 0,
                tx_hash: randomTxHash,
                timestamp: Date.now(),
                metrics: {
                    timestamp: Math.floor(Date.now() / 1000),
                    verification_latency_ms: 120 + Math.random() * 80,
                    gas_price_gwei: 25 + Math.random() * 10,
                    submission_interval_s: 4 + Math.random() * 5
                }
            })
        });

        await refreshAllData();
    } catch (err) {
        alert("Failed to simulate vote: " + err.message);
    } finally {
        btnSimulateVote.disabled = false;
        btnSimulateVote.textContent = "+ Cast Test Vote";
    }
});

// Simulate Anomaly Attack Vector
btnSimulateAttack.addEventListener("click", async () => {
    btnSimulateAttack.disabled = true;
    btnSimulateAttack.textContent = "Simulating Anomaly...";

    const randomNullifier = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
    const randomTxHash = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");

    const anomalyMetrics = {
        election_id: selectedElectionId,
        nullifier_hash: randomNullifier,
        tx_hash: randomTxHash,
        timestamp: Math.floor(Date.now() / 1000),
        verification_latency_ms: 3200.0,  // Latency anomaly
        gas_price_gwei: 480.0,            // Gas price anomaly spike
        submission_interval_s: 0.15       // Rapid fire submission anomaly
    };

    try {
        // Send to anomaly monitor server
        await fetch(`${ANOMALY_URL}/analyze_submission`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(anomalyMetrics)
        });

        // Also record vote
        await fetch(`${TALLY_URL}/record-vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: selectedElectionId,
                nullifier_hash: randomNullifier,
                candidate_index: 0,
                proof_type: 0,
                tx_hash: randomTxHash,
                timestamp: Date.now(),
                metrics: anomalyMetrics
            })
        });

        await refreshAllData();
    } catch (err) {
        alert("Failed to simulate anomaly: " + err.message);
    } finally {
        btnSimulateAttack.disabled = false;
        btnSimulateAttack.textContent = "⚡ Simulate Anomaly";
    }
});

// Helpers
function truncateHash(hash) {
    if (!hash || hash.length < 16) return hash || "N/A";
    return hash.substring(0, 10) + "..." + hash.substring(hash.length - 6);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Start on load
window.addEventListener("DOMContentLoaded", initDashboard);
