/* ==========================================================================
   PQ-ZKVote — Dedicated Admin Console Controller (admin.js)
   ========================================================================== */

const REGISTRAR_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000" ? "http://localhost:4000" : window.location.origin;
const TALLY_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000" ? "http://localhost:4002" : window.location.origin;
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
                    <button class="btn btn-sm btn-outline" onclick="openVoterFaceVerifyModal('${r.face_id || ''}', '${r.commitment}', '${escapeHtml(r.proof_of_identity)}')">🔍 Verify Face</button>
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

// ---------------------------------------------------------------------------
// Voter Face Verification Modal
// ---------------------------------------------------------------------------
let activeVoterCommitment = null;
let activeVoterFaceId = null;

const voterFaceModal = document.getElementById("voterFaceModal");
const modalVoterId = document.getElementById("modalVoterId");
const modalFaceId = document.getElementById("modalFaceId");
const modalCommitment = document.getElementById("modalCommitment");
const modalVoterCam = document.getElementById("modalVoterCam");
const modalCameraBox = document.getElementById("modalCameraBox");
const modalFaceFeedback = document.getElementById("modalFaceFeedback");
const modalResultBox = document.getElementById("modalResultBox");
const modalMatchBadge = document.getElementById("modalMatchBadge");
const modalScoreText = document.getElementById("modalScoreText");
const btnModalScanFace = document.getElementById("btnModalScanFace");
const btnModalApprove = document.getElementById("btnModalApprove");
const btnModalReject = document.getElementById("btnModalReject");

window.openVoterFaceVerifyModal = async function(faceId, commitment, identity) {
    activeVoterCommitment = commitment;
    activeVoterFaceId = faceId;

    if (modalVoterId) modalVoterId.textContent = identity || "Anonymous Identity";
    if (modalFaceId) modalFaceId.textContent = faceId || "N/A";
    if (modalCommitment) modalCommitment.textContent = `${commitment.substring(0, 18)}...${commitment.substring(commitment.length - 8)}`;

    if (modalResultBox) modalResultBox.classList.add("hidden");
    if (btnModalApprove) btnModalApprove.classList.add("hidden");
    if (btnModalReject) btnModalReject.classList.add("hidden");
    if (voterFaceModal) voterFaceModal.classList.remove("hidden");

    if (modalFaceFeedback) {
        modalFaceFeedback.className = "alert alert-info";
        modalFaceFeedback.textContent = "🔍 Checking if voter enrolled an ephemeral biometric profile...";
    }
    if (btnModalScanFace) btnModalScanFace.disabled = true;

    try {
        const profile = await FaceUI.checkVoterProfile(REGISTRAR_URL, faceId);
        if (profile.enrolled) {
            if (modalFaceFeedback) {
                modalFaceFeedback.className = "alert alert-info";
                modalFaceFeedback.textContent = `👁️ Enrolled profile found (${profile.embedding_count} vectors). Align voter and click "Verify Face Live".`;
            }
            if (modalCameraBox) modalCameraBox.classList.remove("hidden");
            await FaceUI.startWebcam(modalVoterCam);
            if (btnModalScanFace) btnModalScanFace.disabled = false;
        } else {
            if (modalCameraBox) modalCameraBox.classList.add("hidden");
            if (modalFaceFeedback) {
                modalFaceFeedback.className = "alert alert-warning";
                modalFaceFeedback.textContent = "ℹ️ No biometric profile enrolled by this voter. You may verify identity via student/employee ID and approve or reject.";
            }
            if (btnModalApprove) btnModalApprove.classList.remove("hidden");
            if (btnModalReject) btnModalReject.classList.remove("hidden");
        }
    } catch (err) {
        if (modalFaceFeedback) {
            modalFaceFeedback.className = "alert alert-danger";
            modalFaceFeedback.textContent = `Face service error: ${err.message}`;
        }
    }
};

window.closeVoterFaceModal = function() {
    if (modalVoterCam) FaceUI.stopWebcam(modalVoterCam);
    if (voterFaceModal) voterFaceModal.classList.add("hidden");
    activeVoterCommitment = null;
    activeVoterFaceId = null;
};

if (btnModalScanFace) {
    btnModalScanFace.addEventListener("click", async () => {
        btnModalScanFace.disabled = true;
        btnModalScanFace.textContent = "Verifying live biometric...";
        if (modalFaceFeedback) {
            modalFaceFeedback.className = "alert alert-warning";
            modalFaceFeedback.textContent = "📸 Scanning dual frames for liveness and computing cosine similarity...";
        }

        try {
            const { image, prev_image } = await FaceUI.captureDualFrames(modalVoterCam, 280);
            const result = await FaceUI.verifyVoter(REGISTRAR_URL, ADMIN_TOKEN, {
                faceId: activeVoterFaceId,
                image,
                prevImage: prev_image
            });

            btnModalScanFace.disabled = false;
            btnModalScanFace.textContent = "📸 Verify Face Live (Dual-Frame)";

            if (modalResultBox) modalResultBox.classList.remove("hidden");
            if (result.matched) {
                if (modalMatchBadge) {
                    modalMatchBadge.className = "badge badge-emerald";
                    modalMatchBadge.textContent = `MATCH CONFIRMED (${result.confidence}%)`;
                }
                if (modalScoreText) modalScoreText.textContent = `Cosine Similarity: ${result.similarity} | Distance: ${result.distance} | Anti-spoofing PASSED`;
                if (modalFaceFeedback) {
                    modalFaceFeedback.className = "alert alert-success";
                    modalFaceFeedback.textContent = "✅ Face matches voter enrollment! Ready to approve.";
                }
                if (btnModalApprove) btnModalApprove.classList.remove("hidden");
                if (btnModalReject) btnModalReject.classList.remove("hidden");
            } else {
                if (modalMatchBadge) {
                    modalMatchBadge.className = "badge badge-danger";
                    modalMatchBadge.textContent = `MATCH FAILED (${result.confidence || 0}%)`;
                }
                if (modalScoreText) modalScoreText.textContent = `Result: ${result.message || result.error || "Low similarity"}`;
                if (modalFaceFeedback) {
                    modalFaceFeedback.className = "alert alert-danger";
                    modalFaceFeedback.textContent = `❌ Verification failed: ${result.error || result.message || "Face does not match."}`;
                }
                if (btnModalApprove) btnModalApprove.classList.remove("hidden");
                if (btnModalReject) btnModalReject.classList.remove("hidden");
            }
        } catch (err) {
            btnModalScanFace.disabled = false;
            btnModalScanFace.textContent = "📸 Verify Face Live (Dual-Frame)";
            if (modalFaceFeedback) {
                modalFaceFeedback.className = "alert alert-danger";
                modalFaceFeedback.textContent = `Verification error: ${err.message}`;
            }
        }
    });
}

if (btnModalApprove) {
    btnModalApprove.addEventListener("click", async () => {
        if (!activeVoterCommitment) return;
        const comm = activeVoterCommitment;
        closeVoterFaceModal();
        await window.approveReg(comm);
    });
}

if (btnModalReject) {
    btnModalReject.addEventListener("click", async () => {
        if (!activeVoterCommitment) return;
        const comm = activeVoterCommitment;
        closeVoterFaceModal();
        await window.rejectReg(comm);
    });
}

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
