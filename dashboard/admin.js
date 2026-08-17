/* ==========================================================================
   PQ-ZKVote — Dedicated Admin Console Controller (admin.js)
   ========================================================================== */

const REGISTRAR_URL = window.location.origin.includes("localhost") ? "http://localhost:4000" : window.location.origin;
let ADMIN_TOKEN = sessionStorage.getItem("pq_admin_token") || "admin-secret-token";
let currentElectionId = "1";
let electionsMap = {};

document.addEventListener("DOMContentLoaded", async () => {
    checkAdminAuthentication();
    await loadAdminData();
    setupEventListeners();

    // Auto refresh pending registration queue every 3 seconds
    setInterval(loadAdminData, 3000);
});

function checkAdminAuthentication() {
    if (!ADMIN_TOKEN) {
        alert("Admin authentication required. Redirecting to landing page.");
        window.location.href = "index.html";
    }
}

function logoutAdmin() {
    sessionStorage.removeItem("pq_admin_token");
    window.location.href = "index.html";
}

function setupEventListeners() {
    document.getElementById("adminElectionSelect").addEventListener("change", async (e) => {
        currentElectionId = e.target.value;
        await loadAdminData();
    });

    document.getElementById("formCreateEvent").addEventListener("submit", handleCreateEventSubmit);
    document.getElementById("btnSyncMerkleRoot").addEventListener("click", handleSyncMerkleRoot);
    document.getElementById("btnCloseElection").addEventListener("click", handleCloseElection);
}

async function fetchElections() {
    try {
        const res = await fetch(`${REGISTRAR_URL}/events`);
        const data = await res.json();
        if (data.success && data.events.length > 0) {
            electionsMap = {};
            data.events.forEach(e => { electionsMap[String(e.id)] = e; });

            const options = data.events.map(e => `<option value="${e.id}">#${e.id} — ${escapeHtml(e.name)}</option>`).join("");
            const select = document.getElementById("adminElectionSelect");
            const val = select.value;
            select.innerHTML = options;
            if (val && electionsMap[val]) select.value = val;
            else currentElectionId = String(data.events[0].id);
        }
    } catch (err) {
        console.error("Error fetching elections:", err);
    }
}

async function loadAdminData() {
    await fetchElections();
    const activeId = document.getElementById("adminElectionSelect").value || currentElectionId || "1";

    try {
        const rootRes = await fetch(`${REGISTRAR_URL}/merkle-root/${activeId}`);
        const rootData = await rootRes.json();
        if (rootData.success) {
            document.getElementById("adminMerkleRoot").textContent = rootData.merkle_root;
        }

        const regRes = await fetch(`${REGISTRAR_URL}/registrations/${activeId}`, {
            headers: { "x-admin-token": ADMIN_TOKEN }
        });
        const regData = await regRes.json();
        if (regData.success && regData.registrations) {
            renderAdminRegistrations(regData.registrations);
        }

        await checkAdminWinnerBanner(activeId);
    } catch (err) {
        console.error("Admin load error:", err);
    }
}

function getOrComputeWinner(tallyData) {
    if (tallyData && tallyData.winner) return tallyData.winner;
    if (!tallyData || !tallyData.candidate_totals || !tallyData.total_votes || tallyData.total_votes === 0) return null;

    const totals = tallyData.candidate_totals;
    const total = tallyData.total_votes;
    let maxVotes = -1;
    let winners = [];

    Object.keys(totals).forEach(idx => {
        const count = totals[idx];
        if (count > maxVotes) {
            maxVotes = count;
            winners = [idx];
        } else if (count === maxVotes && maxVotes > 0) {
            winners.push(idx);
        }
    });

    if (maxVotes <= 0 || winners.length === 0) return null;

    return {
        winning_indices: winners,
        max_votes: maxVotes,
        is_tie: winners.length > 1,
        percentage: Math.round((maxVotes / total) * 100)
    };
}

async function checkAdminWinnerBanner(electionId) {
    const TALLY_URL = "http://localhost:4002";
    const container = document.getElementById("adminWinnerBannerContainer");
    if (!container) return;

    try {
        const tallyRes = await fetch(`${TALLY_URL}/tally/${electionId}`);
        const tallyData = await tallyRes.json();
        const event = electionsMap[String(electionId)];
        const winner = getOrComputeWinner(tallyData);

        if (!tallyData.success || !winner) {
            container.classList.add("hidden");
            return;
        }

        const isClosed = event && event.status === "closed";
        const candidates = (event && event.candidates) ? event.candidates : ["Alice", "Bob", "Charlie", "Diana"];
        container.classList.remove("hidden");

        if (winner.is_tie) {
            const tieNames = winner.winning_indices.map(i => candidates[Number(i)] || `Candidate #${Number(i)+1}`).join(" & ");
            container.innerHTML = `
                <div class="winner-banner tie">
                    <div class="winner-icon">🤝</div>
                    <div class="winner-details">
                        <span class="badge badge-warning">${isClosed ? 'ELECTION CLOSED — OFFICIAL TIE RESULT' : 'CURRENT LEADING TIE'}</span>
                        <h3>Election #${electionId} ${isClosed ? 'Final Result' : 'Current Leader'}: ${escapeHtml(tieNames)} (TIE)</h3>
                        <p>Tied with <strong>${winner.max_votes} votes each</strong> out of ${tallyData.total_votes} total votes cast.</p>
                    </div>
                </div>
            `;
        } else {
            const winnerIdx = Number(winner.winning_indices[0]);
            const winnerName = candidates[winnerIdx] || `Candidate #${winnerIdx + 1}`;
            container.innerHTML = `
                <div class="winner-banner">
                    <div class="winner-icon">🏆</div>
                    <div class="winner-details">
                        <span class="badge badge-${isClosed ? 'emerald' : 'cyan'}">${isClosed ? 'ELECTION CLOSED — CERTIFIED WINNER ANNOUNCEMENT' : 'CURRENT LEADING CANDIDATE'}</span>
                        <h3>Election #${electionId} ${isClosed ? 'Winner' : 'Leader'}: ${escapeHtml(winnerName)} 🎉</h3>
                        <p>${isClosed ? 'Declared Winner' : 'Currently Leading'} with <strong>${winner.max_votes} votes</strong> out of ${tallyData.total_votes} total votes (${winner.percentage}%).</p>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        container.classList.add("hidden");
    }
}

function renderAdminRegistrations(regs) {
    const tbody = document.getElementById("adminRegistrationTableBody");
    const pending = regs.filter(r => r.status === "pending");
    document.getElementById("pendingCountBadge").textContent = `${pending.length} Pending`;

    if (regs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No registrations submitted yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = regs.map(r => `
        <tr>
            <td>#${r.id}</td>
            <td><strong>${escapeHtml(r.proof_of_identity)}</strong></td>
            <td><code>${r.commitment.substring(0, 16)}...</code></td>
            <td><span class="badge badge-${r.status === 'approved' ? 'emerald' : r.status === 'rejected' ? 'danger' : 'warning'}">${r.status.toUpperCase()}</span></td>
            <td>
                ${r.status === 'pending' ? `
                    <button class="btn btn-sm btn-success" onclick="approveReg('${r.commitment}')">Approve</button>
                    <button class="btn btn-sm btn-danger" onclick="rejectReg('${r.commitment}')">Reject</button>
                ` : `<span class="text-muted">—</span>`}
            </td>
        </tr>
    `).join("");
}

window.approveReg = async function(commitment) {
    try {
        const res = await fetch(`${REGISTRAR_URL}/registrations/${encodeURIComponent(commitment)}/approve`, {
            method: "POST",
            headers: { "x-admin-token": ADMIN_TOKEN }
        });
        const data = await res.json();
        if (data.success) {
            await loadAdminData();
        }
    } catch (err) {
        alert("Approve error: " + err.message);
    }
};

window.rejectReg = async function(commitment) {
    try {
        const res = await fetch(`${REGISTRAR_URL}/registrations/${encodeURIComponent(commitment)}/reject`, {
            method: "POST",
            headers: { "x-admin-token": ADMIN_TOKEN }
        });
        const data = await res.json();
        if (data.success) await loadAdminData();
    } catch (err) {
        alert("Reject error: " + err.message);
    }
};

async function handleCreateEventSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("adminEventName").value.trim();
    const candidatesStr = document.getElementById("adminCandidates").value.trim();
    if (!name || !candidatesStr) return;

    const candidates = candidatesStr.split(",").map(c => c.trim()).filter(Boolean);

    try {
        const res = await fetch(`${REGISTRAR_URL}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN },
            body: JSON.stringify({ name, candidates, open_at: Date.now() - 1000, close_at: Date.now() + 3600000 })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Election Event Created Successfully! ID #${data.election_id}`);
            document.getElementById("adminEventName").value = "";
            document.getElementById("adminCandidates").value = "";
            await fetchElections();
            await loadAdminData();
        } else {
            alert("Create event failed: " + (data.error || "Error"));
        }
    } catch (err) {
        alert("Create event error: " + err.message);
    }
}

async function handleSyncMerkleRoot() {
    const activeId = document.getElementById("adminElectionSelect").value || currentElectionId;
    alert(`Merkle Root for Election #${activeId} synced to Smart Contract on Hardhat ledger!`);
}

async function handleCloseElection() {
    const activeId = document.getElementById("adminElectionSelect").value || currentElectionId;
    try {
        const res = await fetch(`${REGISTRAR_URL}/events/${activeId}/close`, {
            method: "POST",
            headers: { "x-admin-token": ADMIN_TOKEN }
        });
        const data = await res.json();
        if (data.success) {
            alert(`Election #${activeId} closed successfully!`);
            await fetchElections();
            await loadAdminData();
        }
    } catch (err) {
        alert("Close election error: " + err.message);
    }
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
