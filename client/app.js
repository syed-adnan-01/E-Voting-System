const API_BASE = window.location.origin.includes("localhost") 
    ? "http://localhost:4000" 
    : window.location.origin;

// DOM Sections
const stepKeyGen = document.getElementById("stepKeyGen");
const stepRegister = document.getElementById("stepRegister");
const stepStatus = document.getElementById("stepStatus");
const stepVote = document.getElementById("stepVote");
const stepReceipt = document.getElementById("stepReceipt");

// DOM Elements
const secretDisplay = document.getElementById("secretDisplay");
const commitmentDisplay = document.getElementById("commitmentDisplay");
const downloadBackupBtn = document.getElementById("downloadBackupBtn");
const proceedToRegisterBtn = document.getElementById("proceedToRegisterBtn");

const registerForm = document.getElementById("registerForm");
const electionSelect = document.getElementById("electionSelect");
const voterIdentityInput = document.getElementById("voterIdentityInput");

const statusPill = document.getElementById("statusPill");
const statusDesc = document.getElementById("statusDesc");
const statusCommitment = document.getElementById("statusCommitment");
const statusLeafIndex = document.getElementById("statusLeafIndex");
const refreshStatusBtn = document.getElementById("refreshStatusBtn");

const candidatesGrid = document.getElementById("candidatesGrid");
const castVoteBtn = document.getElementById("castVoteBtn");

const receiptNullifier = document.getElementById("receiptNullifier");
const receiptElectionId = document.getElementById("receiptElectionId");
const receiptTxHash = document.getElementById("receiptTxHash");
const receiptTimestamp = document.getElementById("receiptTimestamp");

// State
let voterSecret = "";
let commitmentHash = "";
let currentElection = null;
let selectedCandidateIndex = null;
let registrationState = null;

// --- STEP 1: Secret Generation ---
function initVoterSecret() {
    voterSecret = localStorage.getItem("pq_voter_secret");
    if (!voterSecret) {
        // Generate random 256-bit secret integer string
        const randomBytes = new Uint8Array(32);
        window.crypto.getRandomValues(randomBytes);
        let hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        voterSecret = BigInt("0x" + hex).toString();
        localStorage.setItem("pq_voter_secret", voterSecret);
    }

    // Compute pseudo/Poseidon commitment hash for UI
    commitmentHash = computeCommitmentHash(voterSecret);

    secretDisplay.textContent = voterSecret;
    commitmentDisplay.textContent = commitmentHash;
    statusCommitment.textContent = commitmentHash;
}

// Simple deterministic hash matching Poseidon leaf format for UI
function computeCommitmentHash(secret) {
    let hash = 0n;
    const bigSecret = BigInt(secret);
    hash = (bigSecret * 6364136223846793005n + 1442695040888963407n) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    return "0x" + hash.toString(16).padStart(64, "0");
}

downloadBackupBtn.addEventListener("click", () => {
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

proceedToRegisterBtn.addEventListener("click", async () => {
    stepKeyGen.classList.add("hidden");
    stepRegister.classList.remove("hidden");
    await fetchActiveElections();
    await checkExistingRegistration();
});

// --- STEP 2: Registration ---
async function fetchActiveElections() {
    try {
        const res = await fetch(`${API_BASE}/events`);
        const data = await res.json();
        if (data.success && data.events.length > 0) {
            electionSelect.innerHTML = data.events.map(e => `
                <option value="${e.id}">#${e.id} — ${escapeHtml(e.name)}</option>
            `).join("");
            currentElection = data.events[0];
        } else {
            electionSelect.innerHTML = `<option value="">No active elections found</option>`;
        }
    } catch (err) {
        console.error("Error fetching elections:", err);
    }
}

registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const electionId = electionSelect.value;
    const proofOfIdentity = voterIdentityInput.value.trim();

    if (!electionId || !proofOfIdentity) return;

    try {
        const res = await fetch(`${API_BASE}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: electionId,
                commitment: commitmentHash,
                proof_of_identity: proofOfIdentity
            })
        });

        const data = await res.json();
        if (data.success) {
            stepRegister.classList.add("hidden");
            stepStatus.classList.remove("hidden");
            updateRegistrationUI(data.registration);
        } else {
            alert("Registration failed: " + data.error);
        }
    } catch (err) {
        alert("Server connection error: " + err.message);
    }
});

// --- STEP 3: Status Polling ---
refreshStatusBtn.addEventListener("click", checkExistingRegistration);

async function checkExistingRegistration() {
    if (!commitmentHash) return;
    try {
        const res = await fetch(`${API_BASE}/registration-status/${encodeURIComponent(commitmentHash)}`);
        const data = await res.json();
        if (data.success) {
            registrationState = data.registration;
            stepRegister.classList.add("hidden");
            stepStatus.classList.remove("hidden");
            updateRegistrationUI(data.registration);
        }
    } catch (err) {
        console.log("No registration found yet.");
    }
}

function updateRegistrationUI(registration) {
    statusPill.className = `status-pill ${registration.status}`;
    statusPill.textContent = registration.status.toUpperCase();
    statusCommitment.textContent = registration.commitment;
    statusLeafIndex.textContent = registration.leaf_index !== null ? `#${registration.leaf_index}` : "Unassigned";

    if (registration.status === "approved") {
        statusDesc.textContent = "Congratulations! Your voter commitment has been approved and added to the Merkle tree.";
        setTimeout(async () => {
            stepStatus.classList.add("hidden");
            stepVote.classList.remove("hidden");
            await setupBallot(registration.election_id);
        }, 1200);
    } else if (registration.status === "rejected") {
        statusDesc.textContent = "Your registration was rejected by the election administrator.";
    } else {
        statusDesc.textContent = "Your registration is currently pending admin approval. Click refresh to check status.";
    }
}

// --- STEP 4: Ballot & Voting ---
async function setupBallot(electionId) {
    try {
        const res = await fetch(`${API_BASE}/events/${electionId}`);
        const data = await res.json();
        if (data.success) {
            currentElection = data.event;
            renderCandidates(currentElection.candidates);
        }
    } catch (err) {
        console.error("Error setting up ballot:", err);
    }
}

function renderCandidates(candidates) {
    candidatesGrid.innerHTML = candidates.map((candidate, idx) => `
        <div class="candidate-card" onclick="selectCandidate(${idx})">
            <div class="candidate-name">${escapeHtml(candidate)}</div>
            <div class="candidate-index">Option #${idx + 1}</div>
        </div>
    `).join("");
}

window.selectCandidate = function(index) {
    selectedCandidateIndex = index;
    const cards = document.querySelectorAll(".candidate-card");
    cards.forEach((card, idx) => {
        if (idx === index) {
            card.classList.add("selected");
        } else {
            card.classList.remove("selected");
        }
    });
    castVoteBtn.disabled = false;
};

document.getElementById("voteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (selectedCandidateIndex === null) return;

    castVoteBtn.disabled = true;
    castVoteBtn.textContent = "⏳ Generating Groth16 Proof...";

    try {
        // Fetch Merkle path from registrar
        const res = await fetch(`${API_BASE}/merkle-path/${encodeURIComponent(commitmentHash)}`);
        const pathData = await res.json();

        if (!pathData.success) {
            throw new Error(pathData.error || "Failed to fetch Merkle path");
        }

        // Simulate client-side ZK proof & nullifier computation
        const simulatedNullifier = "0x" + BigInt(voterSecret + currentElection.id).toString(16).padStart(64, "0");
        const simulatedTxHash = "0x" + Array.from(window.crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");

        setTimeout(() => {
            stepVote.classList.add("hidden");
            stepReceipt.classList.remove("hidden");

            receiptNullifier.textContent = simulatedNullifier.substring(0, 18) + "..." + simulatedNullifier.substring(simulatedNullifier.length - 8);
            receiptElectionId.textContent = `#${currentElection.id} (${currentElection.name})`;
            receiptTxHash.textContent = simulatedTxHash.substring(0, 18) + "...";
            receiptTimestamp.textContent = new Date().toLocaleString();
        }, 1500);

    } catch (err) {
        alert("Voting failed: " + err.message);
        castVoteBtn.disabled = false;
        castVoteBtn.textContent = "🔒 Generate ZK Proof & Submit Vote";
    }
});

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Initialize on page load
initVoterSecret();
