/* ==========================================================================
   PQ-ZKVote — Public Auditor & Verifier Controller (public.js)
   ========================================================================== */

const REGISTRAR_URL = window.location.origin.includes("localhost") ? "http://localhost:4000" : window.location.origin;
const TALLY_URL = "http://localhost:4002";
const ANOMALY_URL = "http://localhost:8000";

let currentElectionId = "1";
let electionsMap = {};

document.addEventListener("DOMContentLoaded", async () => {
    await fetchElections();
    await refreshPublicData();
    setupEventListeners();

    setInterval(refreshPublicData, 4000);
});

function setupEventListeners() {
    document.getElementById("btnRunVerifier").addEventListener("click", runElectionVerifierAudit);
    document.getElementById("btnExportAuditJson").addEventListener("click", exportAuditReport);
    document.getElementById("btnSimulateValid").addEventListener("click", simulateValidVote);
    document.getElementById("btnSimulateAttack").addEventListener("click", simulateAttackVote);
}

async function fetchElections() {
    try {
        const res = await fetch(`${REGISTRAR_URL}/events`);
        const data = await res.json();
        if (data.success && data.events.length > 0) {
            electionsMap = {};
            data.events.forEach(e => { electionsMap[String(e.id)] = e; });

            const options = data.events.map(e => `<option value="${e.id}">#${e.id} — ${escapeHtml(e.name)}</option>`).join("");
            document.getElementById("verifierElectionSelect").innerHTML = options;
            currentElectionId = String(data.events[0].id);
        }
    } catch (err) {
        console.error("Error fetching elections:", err);
    }
}

async function refreshPublicData() {
    const eid = currentElectionId || "1";

    // 1. Fetch Tally
    try {
        const tallyRes = await fetch(`${TALLY_URL}/tally/${eid}`);
        const tallyData = await tallyRes.json();
        if (tallyData.success) {
            document.getElementById("kpiTotalVotes").textContent = tallyData.total_votes || 0;
            document.getElementById("kpiGroth16Votes").textContent = tallyData.proof_types?.groth16 || 0;
            document.getElementById("kpiLatticeVotes").textContent = tallyData.proof_types?.lattice || 0;

            const total = tallyData.total_votes || 0;
            const gCount = tallyData.proof_types?.groth16 || 0;
            const lCount = tallyData.proof_types?.lattice || 0;
            const gPct = total > 0 ? Math.round((gCount / total) * 100) : 50;
            const lPct = total > 0 ? 100 - gPct : 50;

            document.getElementById("barGroth16").style.width = `${gPct}%`;
            document.getElementById("barGroth16").textContent = `Groth16 (${gPct}%)`;
            document.getElementById("barLattice").style.width = `${lPct}%`;
            document.getElementById("barLattice").textContent = `QRZ-KPA (${lPct}%)`;

            renderCandidateTally(tallyData.candidate_totals || {}, total);
        }
    } catch (e) {}

    // 2. Fetch Audit Log
    try {
        const auditRes = await fetch(`${TALLY_URL}/audit-log/${eid}`);
        const auditData = await auditRes.json();
        if (auditData.success) {
            renderAuditTable(auditData.audit_log || []);
        }
    } catch (e) {}

    // 3. Fetch Anomalies
    try {
        const anomalyRes = await fetch(`${ANOMALY_URL}/anomalies`);
        const anomalyData = await anomalyRes.json();
        if (anomalyData.anomalies) {
            document.getElementById("kpiAnomalyCount").textContent = anomalyData.anomalies.length;
            renderAnomalyFeed(anomalyData.anomalies);
        }
    } catch (e) {}
}

function renderCandidateTally(candidateTotals, totalVotes) {
    const container = document.getElementById("tallyContainer");
    const election = electionsMap[currentElectionId] || { candidates: ["Alice", "Bob", "Charlie", "Diana"] };
    const candidates = election.candidates || [];

    if (candidates.length === 0) {
        container.innerHTML = `<div class="empty-state">No candidates configured.</div>`;
        return;
    }

    container.innerHTML = candidates.map((name, idx) => {
        const count = candidateTotals[String(idx)] || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        return `
            <div class="tally-item">
                <div class="tally-label">
                    <span>${escapeHtml(name)}</span>
                    <span><strong>${count} votes</strong> (${pct}%)</span>
                </div>
                <div class="tally-bar-bg">
                    <div class="tally-bar-fill" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join("");
}

function renderAuditTable(logs) {
    const tbody = document.getElementById("auditTableBody");
    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No audit entries recorded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.slice(0, 15).map((log, idx) => `
        <tr>
            <td>#${logs.length - idx}</td>
            <td><code>${log.nullifier_hash.substring(0, 18)}...</code></td>
            <td><span class="badge badge-${log.proof_type === 'lattice' ? 'purple' : 'cyan'}">${log.proof_type.toUpperCase()}</span></td>
            <td><code>${log.tx_hash.substring(0, 16)}...</code></td>
            <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
        </tr>
    `).join("");
}

function renderAnomalyFeed(anomalies) {
    const feed = document.getElementById("anomalyFeed");
    if (!anomalies || anomalies.length === 0) return;

    feed.innerHTML = anomalies.slice(-5).reverse().map(item => `
        <div class="feed-item ${item.is_anomaly ? 'anomalous' : 'normal'}">
            <span class="feed-status">${item.is_anomaly ? '⚠️ ANOMALY' : '✓ NORMAL'}</span>
            <div class="feed-details">
                <code class="tx-hash">${item.tx_hash ? item.tx_hash.substring(0, 12) + '...' : '0x...'}</code>
                <span class="metric">Latency: ${item.features?.verification_latency_ms || 120}ms | Risk: ${item.anomaly_score ? item.anomaly_score.toFixed(3) : 0.05}</span>
            </div>
        </div>
    `).join("");
}

async function runElectionVerifierAudit() {
    const targetId = document.getElementById("verifierElectionSelect").value || currentElectionId;
    const btn = document.getElementById("btnRunVerifier");
    btn.disabled = true;
    btn.textContent = "⏳ Running Zero-Trust Verifier Audit...";

    try {
        const res = await fetch(`${TALLY_URL}/verify-election/${targetId}`);
        const data = await res.json();

        document.getElementById("verifierResults").classList.remove("hidden");
        const banner = document.getElementById("verifierStatusBanner");
        const title = document.getElementById("verifierStatusTitle");

        if (data.passed) {
            banner.className = "verifier-status-banner verified";
            title.textContent = "Election Integrity: VERIFIED ✓";
        } else {
            banner.className = "verifier-status-banner failed";
            title.textContent = "Election Integrity: FAILED ❌";
        }

        const tbody = document.getElementById("verifierTableBody");
        tbody.innerHTML = (data.audit_items || []).map(item => `
            <tr>
                <td><strong>${escapeHtml(item.item)}</strong></td>
                <td><span class="badge badge-${item.status === 'PASS' ? 'emerald' : 'danger'}">${item.status}</span></td>
                <td>${escapeHtml(item.details)}</td>
            </tr>
        `).join("");

        window.lastVerificationReport = data;
    } catch (err) {
        alert("Verifier execution error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "🔍 Run 6-Point Audit";
    }
}

function exportAuditReport() {
    if (!window.lastVerificationReport) return;
    const blob = new Blob([JSON.stringify(window.lastVerificationReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pq-zkvote-audit-report-election-${currentElectionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function simulateValidVote() {
    try {
        await fetch(`${ANOMALY_URL}/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verification_latency_ms: 110.0, gas_price_gwei: 20.0, submission_interval_s: 6.0 })
        });
        await refreshPublicData();
    } catch (e) {}
}

async function simulateAttackVote() {
    try {
        await fetch(`${ANOMALY_URL}/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verification_latency_ms: 4500.0, gas_price_gwei: 350.0, submission_interval_s: 0.05 })
        });
        await refreshPublicData();
    } catch (e) {}
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
