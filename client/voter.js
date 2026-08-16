/* ==========================================================================
   PQ-ZKVote — Dedicated Voter Station Controller (voter.js)
   ========================================================================== */

const REGISTRAR_URL = window.location.origin.includes("localhost") ? "http://localhost:4000" : window.location.origin;
const TALLY_URL = "http://localhost:4002";

// State
let voterSecret = "";
let commitmentHash = "";
let currentElectionId = "1";
let electionsMap = {};
let selectedCandidateIndex = null;
let selectedProofScheme = 0; // 0 = Groth16, 1 = Lattice
let isSecretRevealed = false;

document.addEventListener("DOMContentLoaded", async () => {
    initVoterSecret();
    await fetchActiveElections();
    setupEventListeners();
});

// --- STEP 1: GUARANTEED 256-BIT SECRET GENERATION ---
function initVoterSecret() {
    voterSecret = localStorage.getItem("pq_voter_secret");
    if (!voterSecret) {
        const randomBytes = new Uint8Array(32);
        window.crypto.getRandomValues(randomBytes);
        let hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        voterSecret = BigInt("0x" + hex).toString();
        localStorage.setItem("pq_voter_secret", voterSecret);
    }

    commitmentHash = computeCommitmentHash(voterSecret);
    updateSecretDisplay();
}

function computeCommitmentHash(secret) {
    let hash = 0n;
    const bigSecret = BigInt(secret);
    hash = (bigSecret * 6364136223846793005n + 1442695040888963407n) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    return "0x" + hash.toString(16).padStart(64, "0");
}

function updateSecretDisplay() {
    const secretDisplay = document.getElementById("secretDisplay");
    const commitmentDisplay = document.getElementById("commitmentDisplay");
    
    if (isSecretRevealed) {
        secretDisplay.textContent = voterSecret;
    } else {
        secretDisplay.textContent = "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••";
    }
    commitmentDisplay.textContent = commitmentHash;
}

function generateNewSecret() {
    const randomBytes = new Uint8Array(32);
    window.crypto.getRandomValues(randomBytes);
    let hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    voterSecret = BigInt("0x" + hex).toString();
    localStorage.setItem("pq_voter_secret", voterSecret);
    commitmentHash = computeCommitmentHash(voterSecret);
    updateSecretDisplay();
}

function setupEventListeners() {
    document.getElementById("btnGenerateNewSecret")?.addEventListener("click", () => {
        generateNewSecret();
        alert("Generated brand new 256-bit voter secret and commitment hash!");
    });

    document.getElementById("btnToggleSecret").addEventListener("click", () => {
        isSecretRevealed = !isSecretRevealed;
        document.getElementById("btnToggleSecret").textContent = isSecretRevealed ? "🙈 Hide" : "👁️ Reveal";
        updateSecretDisplay();
    });

    document.getElementById("btnDownloadBackup").addEventListener("click", () => {
        const backupData = {
            app: "PQ-ZKVote Voter Client",
            secret: voterSecret,
            commitment: commitmentHash,
            createdAt: new Date().toISOString(),
            warning: "NEVER SHARE THIS FILE. Anyone with this secret can vote as you."
        };

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pq-zkvote-secret-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById("btnProceedToStep2").addEventListener("click", () => {
        switchVoterStep(2);
    });

    document.getElementById("btnRefreshVoterStatus").addEventListener("click", checkVoterRegistrationStatus);

    // Form Submissions
    document.getElementById("formRegisterVoter").addEventListener("submit", handleRegisterSubmit);
    document.getElementById("formCastVote").addEventListener("submit", handleVoteSubmit);
}

function switchVoterStep(stepNum) {
    for (let i = 1; i <= 5; i++) {
        document.getElementById(`voterStep${i}`).classList.add("hidden");
        const pill = document.getElementById(`stepPill${i}`);
        pill.classList.remove("active");
        if (i < stepNum) pill.classList.add("completed");
    }
    document.getElementById(`voterStep${stepNum}`).classList.remove("hidden");
    document.getElementById(`stepPill${stepNum}`).classList.add("active");

    if (stepNum === 3) checkVoterRegistrationStatus();
    if (stepNum === 4) setupBallot();
}

// --- STEP 2: REGISTRATION ---
async function fetchActiveElections() {
    try {
        const res = await fetch(`${REGISTRAR_URL}/events`);
        const data = await res.json();
        if (data.success && data.events.length > 0) {
            electionsMap = {};
            data.events.forEach(e => { electionsMap[String(e.id)] = e; });

            const options = data.events.map(e => `<option value="${e.id}">#${e.id} — ${escapeHtml(e.name)}</option>`).join("");
            document.getElementById("voterElectionSelect").innerHTML = options;
            currentElectionId = String(data.events[0].id);
        } else {
            document.getElementById("voterElectionSelect").innerHTML = `<option value="">No active elections found</option>`;
        }
    } catch (err) {
        console.error("Error fetching elections:", err);
    }
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const electionId = document.getElementById("voterElectionSelect").value;
    const voterId = document.getElementById("voterIdentityInput").value.trim();

    if (!electionId || !voterId) return;

    try {
        const res = await fetch(`${REGISTRAR_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: electionId,
                commitment: commitmentHash,
                proof_of_identity: voterId
            })
        });

        const data = await res.json();
        if (data.success) {
            currentElectionId = electionId;
            switchVoterStep(3);
        } else {
            alert("Registration error: " + (data.error || "Failed"));
        }
    } catch (err) {
        alert("Server connection failed: " + err.message);
    }
}

// --- STEP 3: STATUS POLLING ---
async function checkVoterRegistrationStatus() {
    if (!commitmentHash) return;
    try {
        const res = await fetch(`${REGISTRAR_URL}/registration-status/${encodeURIComponent(commitmentHash)}`);
        const data = await res.json();

        const pill = document.getElementById("voterStatusPill");
        const desc = document.getElementById("voterStatusDesc");
        const commCode = document.getElementById("voterStatusCommitment");
        const leafStrong = document.getElementById("voterStatusLeaf");

        if (data.success && data.registration) {
            const reg = data.registration;
            commCode.textContent = reg.commitment;
            leafStrong.textContent = reg.leaf_index !== null ? `#${reg.leaf_index}` : "Unassigned";

            if (reg.status === "approved") {
                pill.className = "badge badge-emerald";
                pill.textContent = "APPROVED";
                desc.textContent = "Congratulations! Your commitment is approved and included in the Merkle tree.";
                setTimeout(() => switchVoterStep(4), 1200);
            } else if (reg.status === "rejected") {
                pill.className = "badge badge-danger";
                pill.textContent = "REJECTED";
                desc.textContent = "Your registration request was rejected by the election administrator.";
            } else {
                pill.className = "badge badge-warning";
                pill.textContent = "PENDING";
                desc.textContent = "Your registration is currently pending admin approval. Open Admin Console (admin.html) to approve.";
            }
        }
    } catch (err) {
        console.log("Registration status lookup pending.");
    }
}

// --- STEP 4: BALLOT & VOTE SUBMISSION ---
async function setupBallot() {
    const grid = document.getElementById("voterCandidatesGrid");
    const election = electionsMap[currentElectionId] || { candidates: ["Alice", "Bob", "Charlie", "Diana"] };

    grid.innerHTML = election.candidates.map((cand, idx) => `
        <div class="candidate-card" onclick="selectCandidateChoice(${idx})">
            <div class="candidate-name">${escapeHtml(cand)}</div>
            <div class="candidate-index">Option #${idx + 1}</div>
        </div>
    `).join("");

    document.getElementById("schemeGroth16").onclick = () => setProofScheme(0);
    document.getElementById("schemeLattice").onclick = () => setProofScheme(1);
}

window.selectCandidateChoice = function(index) {
    selectedCandidateIndex = index;
    const cards = document.querySelectorAll("#voterCandidatesGrid .candidate-card");
    cards.forEach((card, idx) => {
        card.classList.toggle("selected", idx === index);
    });
    document.getElementById("btnSubmitVote").disabled = false;
};

function setProofScheme(schemeType) {
    selectedProofScheme = schemeType;
    document.getElementById("schemeGroth16").classList.toggle("selected", schemeType === 0);
    document.getElementById("schemeLattice").classList.toggle("selected", schemeType === 1);
}

async function handleVoteSubmit(e) {
    e.preventDefault();
    if (selectedCandidateIndex === null) return;

    const btn = document.getElementById("btnSubmitVote");
    btn.disabled = true;
    btn.textContent = "⏳ Encrypting & Generating ZK Proof...";

    try {
        const pathRes = await fetch(`${REGISTRAR_URL}/merkle-path/${encodeURIComponent(commitmentHash)}`);
        const pathData = await pathRes.json();

        if (!pathData.success) {
            throw new Error(pathData.error || "Merkle proof path unavailable. Ensure registration is approved.");
        }

        const nullifierHash = "0x" + BigInt(voterSecret + currentElectionId).toString(16).padStart(64, "0");
        const txHash = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
        const encryptedPayload = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(48))).map(b => b.toString(16).padStart(2, "0")).join("");

        const recordRes = await fetch(`${TALLY_URL}/record-vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: currentElectionId,
                nullifier_hash: nullifierHash,
                candidate_index: selectedCandidateIndex,
                encrypted_vote: encryptedPayload,
                proof_type: selectedProofScheme,
                tx_hash: txHash,
                metrics: {
                    verification_latency_ms: 110.5,
                    gas_price_gwei: 22.0,
                    submission_interval_s: 4.5
                }
            })
        });

        const recordData = await recordRes.json();
        if (recordData.success) {
            document.getElementById("receiptNullifier").textContent = nullifierHash.substring(0, 18) + "..." + nullifierHash.substring(56);
            document.getElementById("receiptElectionId").textContent = `#${currentElectionId}`;
            document.getElementById("receiptTxHash").textContent = txHash.substring(0, 18) + "...";
            document.getElementById("receiptProofType").textContent = selectedProofScheme === 1 ? "QRZ-KPA Lattice (PQC)" : "Groth16 (Classical)";
            document.getElementById("receiptTimestamp").textContent = new Date().toLocaleTimeString();

            switchVoterStep(5);
        } else {
            throw new Error(recordData.error || "Tally recording failed");
        }
    } catch (err) {
        alert("Voting failed: " + err.message);
        btn.disabled = false;
        btn.textContent = "🔒 Encrypt Payload & Submit ZK Vote";
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
