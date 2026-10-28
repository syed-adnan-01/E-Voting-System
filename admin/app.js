const API_BASE = window.location.origin.includes("localhost") 
    ? "http://localhost:4000" 
    : window.location.origin;

let adminToken = localStorage.getItem("pq_admin_token") || "";
let tempAdminToken = ""; // Holds token between Step 1 and Step 2 of login
let currentElections = [];

// DOM Elements — Auth
const authSection = document.getElementById("authSection");
const dashboardSection = document.getElementById("dashboardSection");
const tokenStep = document.getElementById("tokenStep");
const faceVerifyStep = document.getElementById("faceVerifyStep");
const faceEnrollStep = document.getElementById("faceEnrollStep");

const tokenInput = document.getElementById("tokenInput");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authText = document.getElementById("authText");
const faceAuthTag = document.getElementById("faceAuthTag");

// Face Verification Elements
const adminVerifyCam = document.getElementById("adminVerifyCam");
const verifyCameraBox = document.getElementById("verifyCameraBox");
const faceVerifyFeedback = document.getElementById("faceVerifyFeedback");
const btnScanFace = document.getElementById("btnScanFace");
const btnBackToToken = document.getElementById("btnBackToToken");

// Face Enrollment Elements
const adminEnrollCam = document.getElementById("adminEnrollCam");
const enrollCameraBox = document.getElementById("enrollCameraBox");
const faceEnrollFeedback = document.getElementById("faceEnrollFeedback");
const enrollProgressBar = document.getElementById("enrollProgressBar");
const enrollProgressText = document.getElementById("enrollProgressText");
const btnStartEnroll = document.getElementById("btnStartEnroll");
const btnEnrollBackToToken = document.getElementById("btnEnrollBackToToken");

// Biometric Security Card in Dashboard
const faceProfileBadge = document.getElementById("faceProfileBadge");
const btnReEnrollFace = document.getElementById("btnReEnrollFace");
const btnResetFaceProfile = document.getElementById("btnResetFaceProfile");

// Dashboard Elements
const createEventForm = document.getElementById("createEventForm");
const eventNameInput = document.getElementById("eventName");
const candidatesInput = document.getElementById("candidatesInput");
const electionsList = document.getElementById("electionsList");
const refreshEventsBtn = document.getElementById("refreshEventsBtn");

const registrationQueue = document.getElementById("registrationQueue");
const pendingCountBadge = document.getElementById("pendingCount");
const electionFilterSelect = document.getElementById("electionFilterSelect");

// ---------------------------------------------------------------------------
// Multi-Factor Admin Authentication
// ---------------------------------------------------------------------------

// Step 1: Token verification -> check face profile -> route to Step 2
loginBtn.addEventListener("click", async () => {
    const inputToken = tokenInput.value.trim();
    if (!inputToken) {
        alert("Please enter the administrator security token.");
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Verifying token...";

    try {
        const res = await fetch(`${API_BASE}/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: inputToken })
        });
        const data = await res.json();

        if (!data.success) {
            alert("Authentication failed: " + (data.error || "Invalid token"));
            loginBtn.disabled = false;
            loginBtn.textContent = "Continue to Face Verification →";
            return;
        }

        // Token is valid! Hold in temporary session
        tempAdminToken = inputToken;

        // Query face service for admin enrollment status
        const profileData = await FaceUI.checkProfile(API_BASE);

        if (profileData.enrolled) {
            // Already enrolled -> Proceed to Face Verification
            showFaceVerifyStep();
        } else {
            // Not enrolled -> Proceed to One-Time Face Enrollment
            showFaceEnrollStep();
        }
    } catch (err) {
        alert("Server connection error: " + err.message);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "Continue to Face Verification →";
    }
});

// Show Step 2: Verification
async function showFaceVerifyStep() {
    tokenStep.classList.add("hidden");
    faceEnrollStep.classList.add("hidden");
    faceVerifyStep.classList.remove("hidden");

    setFeedback(faceVerifyFeedback, "info", "👁️ Align your face in the reticle and blink naturally.");
    btnScanFace.disabled = false;
    btnScanFace.textContent = "Scan Face & Log In";
    verifyCameraBox.classList.remove("scanning");

    try {
        await FaceUI.startWebcam(adminVerifyCam);
        verifyCameraBox.classList.add("active");
    } catch (err) {
        setFeedback(faceVerifyFeedback, "error", "⚠️ " + err.message);
        btnScanFace.disabled = true;
    }
}

// Show Step 2: Enrollment
async function showFaceEnrollStep() {
    tokenStep.classList.add("hidden");
    faceVerifyStep.classList.add("hidden");
    faceEnrollStep.classList.remove("hidden");

    enrollProgressBar.style.width = "0%";
    enrollProgressText.textContent = "Ready to capture 5 face samples";
    setFeedback(faceEnrollFeedback, "info", "💡 Ensure good lighting and look straight at the camera.");
    btnStartEnroll.disabled = false;
    btnStartEnroll.textContent = "Start Face Capture (5 photos)";

    try {
        await FaceUI.startWebcam(adminEnrollCam);
        enrollCameraBox.classList.add("active");
    } catch (err) {
        setFeedback(faceEnrollFeedback, "error", "⚠️ " + err.message);
        btnStartEnroll.disabled = true;
    }
}

// Back to Step 1: Token
function backToTokenStep() {
    FaceUI.stopWebcam(adminVerifyCam);
    FaceUI.stopWebcam(adminEnrollCam);
    verifyCameraBox.classList.remove("active", "scanning");
    enrollCameraBox.classList.remove("active");

    faceVerifyStep.classList.add("hidden");
    faceEnrollStep.classList.add("hidden");
    tokenStep.classList.remove("hidden");
}

btnBackToToken.addEventListener("click", backToTokenStep);
btnEnrollBackToToken.addEventListener("click", backToTokenStep);

// Execute Face Verification
btnScanFace.addEventListener("click", async () => {
    btnScanFace.disabled = true;
    btnScanFace.textContent = "Verifying biometric liveness...";
    verifyCameraBox.classList.add("scanning");
    setFeedback(faceVerifyFeedback, "warning", "📸 Scanning dual frames (~280ms apart) for eye blink liveness...");

    try {
        // Dual frame capture for eye blink anti-spoofing
        const { image, prev_image } = await FaceUI.captureDualFrames(adminVerifyCam, 280);

        const result = await FaceUI.verifyAdmin(API_BASE, {
            token: tempAdminToken,
            image,
            prev_image
        });

        if (result.matched) {
            setFeedback(faceVerifyFeedback, "success", `✅ Face verified (${result.confidence}% match). Access granted!`);
            verifyCameraBox.classList.remove("scanning");
            
            // Persist admin credentials and verification flag
            adminToken = tempAdminToken;
            localStorage.setItem("pq_admin_token", adminToken);
            sessionStorage.setItem("pq_admin_face_verified", "true");

            setTimeout(() => {
                FaceUI.stopWebcam(adminVerifyCam);
                showDashboard();
            }, 800);
        } else {
            verifyCameraBox.classList.remove("scanning");
            btnScanFace.disabled = false;
            btnScanFace.textContent = "Scan Face & Log In";
            const errMsg = result.error || result.message || "Face not recognized. Please face camera directly and blink.";
            setFeedback(faceVerifyFeedback, "error", `❌ ${errMsg}`);
        }
    } catch (err) {
        verifyCameraBox.classList.remove("scanning");
        btnScanFace.disabled = false;
        btnScanFace.textContent = "Scan Face & Log In";
        setFeedback(faceVerifyFeedback, "error", `⚠️ Verification error: ${err.message}`);
    }
});

// Execute Face Enrollment
btnStartEnroll.addEventListener("click", async () => {
    btnStartEnroll.disabled = true;
    btnStartEnroll.textContent = "Capturing face frames...";
    setFeedback(faceEnrollFeedback, "warning", "📸 Capturing 5 biometric frames... Please look at camera.");

    try {
        const images = await FaceUI.captureEnrollmentBurst(
            adminEnrollCam,
            5,
            700,
            (current, total) => {
                const pct = Math.round((current / total) * 100);
                enrollProgressBar.style.width = `${pct}%`;
                enrollProgressText.textContent = `Captured sample ${current} of ${total}`;
            }
        );

        setFeedback(faceEnrollFeedback, "info", "⚙️ Computing 512-dim face embeddings and encrypting biometric store...");

        const result = await FaceUI.enrollAdmin(API_BASE, tempAdminToken, images);

        if (result.success) {
            setFeedback(faceEnrollFeedback, "success", "✅ Enrollment complete! Switching to face verification...");
            FaceUI.stopWebcam(adminEnrollCam);

            setTimeout(() => {
                showFaceVerifyStep();
            }, 1200);
        } else {
            btnStartEnroll.disabled = false;
            btnStartEnroll.textContent = "Start Face Capture (5 photos)";
            enrollProgressBar.style.width = "0%";
            setFeedback(faceEnrollFeedback, "error", `❌ Enrollment rejected: ${result.error || "Quality/Anti-spoofing criteria not met."}`);
        }
    } catch (err) {
        btnStartEnroll.disabled = false;
        btnStartEnroll.textContent = "Start Face Capture (5 photos)";
        enrollProgressBar.style.width = "0%";
        setFeedback(faceEnrollFeedback, "error", `⚠️ Enrollment error: ${err.message}`);
    }
});

// Helper for status feedback boxes
function setFeedback(element, type, message) {
    element.className = `status-feedback ${type}`;
    element.innerHTML = `<span>${escapeHtml(message)}</span>`;
}

// Logout
logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("pq_admin_token");
    sessionStorage.removeItem("pq_admin_face_verified");
    adminToken = "";
    tempAdminToken = "";
    FaceUI.stopWebcam(adminVerifyCam);
    FaceUI.stopWebcam(adminEnrollCam);
    showAuth();
});

function showAuth() {
    authSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
    authText.textContent = "Not Authenticated";
    faceAuthTag.classList.add("hidden");

    tokenStep.classList.remove("hidden");
    faceVerifyStep.classList.add("hidden");
    faceEnrollStep.classList.add("hidden");
}

function showDashboard() {
    authSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    authText.textContent = "Authenticated";
    faceAuthTag.classList.remove("hidden");

    loadDashboardData();
    checkBiometricStatus();
}

// Check biometric profile status for dashboard card
async function checkBiometricStatus() {
    if (!faceProfileBadge) return;
    try {
        const data = await FaceUI.checkProfile(API_BASE);
        if (data.enrolled) {
            faceProfileBadge.textContent = `Enrolled (${data.embedding_count} vectors)`;
            faceProfileBadge.style.color = "var(--success)";
            faceProfileBadge.style.background = "#d1fae5";
        } else {
            faceProfileBadge.textContent = "Not Enrolled";
            faceProfileBadge.style.color = "var(--danger)";
            faceProfileBadge.style.background = "#fee2e2";
        }
    } catch (err) {
        faceProfileBadge.textContent = "Service Offline";
    }
}

// Biometric management actions from Dashboard
if (btnReEnrollFace) {
    btnReEnrollFace.addEventListener("click", () => {
        if (!confirm("Re-enrolling your face will replace existing biometric vectors. Proceed?")) return;
        tempAdminToken = adminToken;
        dashboardSection.classList.add("hidden");
        authSection.classList.remove("hidden");
        showFaceEnrollStep();
    });
}

if (btnResetFaceProfile) {
    btnResetFaceProfile.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to delete the admin biometric profile? The next login will require one-time enrollment.")) return;
        try {
            const res = await FaceUI.resetProfile(API_BASE, adminToken);
            if (res.success) {
                alert("Face biometric profile deleted successfully.");
                checkBiometricStatus();
            } else {
                alert("Failed to delete profile: " + res.error);
            }
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
}

// ---------------------------------------------------------------------------
// Dashboard Data Loading & Election Management
// ---------------------------------------------------------------------------

async function loadDashboardData() {
    await fetchEvents();
    await fetchRegistrations();
}

refreshEventsBtn.addEventListener("click", loadDashboardData);
electionFilterSelect.addEventListener("change", fetchRegistrations);

async function fetchEvents() {
    try {
        const res = await fetch(`${API_BASE}/events`);
        const data = await res.json();
        if (data.success) {
            currentElections = data.events;
            renderElections(currentElections);
            renderElectionFilterOptions(currentElections);
        }
    } catch (err) {
        console.error("Error fetching events:", err);
    }
}

function renderElections(events) {
    if (!events || events.length === 0) {
        electionsList.innerHTML = `<p class="empty-state">No elections created yet.</p>`;
        return;
    }

    electionsList.innerHTML = events.map(event => `
        <div class="item-card">
            <div class="item-title">
                <span>#${event.id} — ${escapeHtml(event.name)}</span>
                <span class="status-pill ${event.status}">${event.status}</span>
            </div>
            <div class="item-sub">
                Candidates: ${event.candidates.map(c => `<strong>${escapeHtml(c)}</strong>`).join(", ")}
            </div>
            <div class="item-sub">
                Merkle Root: <span class="mono-hash">${event.merkle_root.substring(0, 18)}...${event.merkle_root.substring(event.merkle_root.length - 8)}</span>
            </div>
            ${event.status === "active" ? `
                <button class="btn btn-danger btn-sm" onclick="closeElection('${event.id}')">Close Election</button>
            ` : ''}
        </div>
    `).join("");
}

function renderElectionFilterOptions(events) {
    const currentVal = electionFilterSelect.value;
    electionFilterSelect.innerHTML = `<option value="">All Elections</option>` +
        events.map(e => `<option value="${e.id}">#${e.id} — ${escapeHtml(e.name)}</option>`).join("");
    electionFilterSelect.value = currentVal;
}

// Create Election Form
createEventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = eventNameInput.value.trim();
    const candidatesStr = candidatesInput.value.trim();

    if (!name || !candidatesStr) return;

    const candidates = candidatesStr.split(",").map(c => c.trim()).filter(c => c.length > 0);

    try {
        const res = await fetch(`${API_BASE}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Token": adminToken
            },
            body: JSON.stringify({ name, candidates })
        });

        const data = await res.json();
        if (data.success) {
            eventNameInput.value = "";
            candidatesInput.value = "";
            await loadDashboardData();
        } else {
            alert("Failed to create election: " + data.error);
        }
    } catch (err) {
        alert("Error creating election: " + err.message);
    }
});

// Close Election
window.closeElection = async function(electionId) {
    if (!confirm(`Are you sure you want to close election #${electionId}?`)) return;

    try {
        const res = await fetch(`${API_BASE}/events/${electionId}/close`, {
            method: "POST",
            headers: { "X-Admin-Token": adminToken }
        });
        const data = await res.json();
        if (data.success) {
            await loadDashboardData();
        } else {
            alert("Failed to close election: " + data.error);
        }
    } catch (err) {
        alert("Error closing election: " + err.message);
    }
};

// Registrations Queue
async function fetchRegistrations() {
    const selectedElectionId = electionFilterSelect.value;
    const url = selectedElectionId 
        ? `${API_BASE}/registrations/${selectedElectionId}`
        : `${API_BASE}/registrations/1`; // default fallback

    try {
        const res = await fetch(url, {
            headers: { "X-Admin-Token": adminToken }
        });
        const data = await res.json();
        if (data.success) {
            renderRegistrations(data.registrations);
        }
    } catch (err) {
        console.error("Error fetching registrations:", err);
    }
}

function renderRegistrations(registrations) {
    if (!registrations || registrations.length === 0) {
        registrationQueue.innerHTML = `<p class="empty-state">No voter registrations found.</p>`;
        pendingCountBadge.textContent = "0 Pending";
        return;
    }

    const pendingCount = registrations.filter(r => r.status === "pending").length;
    pendingCountBadge.textContent = `${pendingCount} Pending`;

    registrationQueue.innerHTML = registrations.map(reg => `
        <div class="item-card">
            <div class="item-title">
                <span>Voter Reg #${reg.id} (Election #${reg.election_id})</span>
                <span class="status-pill ${reg.status}">${reg.status}</span>
            </div>
            <div class="item-sub">
                Commitment: <span class="mono-hash">${escapeHtml(reg.commitment)}</span>
            </div>
            <div class="item-sub">
                Identity Proof: <code>${escapeHtml(reg.proof_of_identity || "Verified")}</code>
                ${reg.leaf_index !== null ? ` | Leaf Index: <strong>${reg.leaf_index}</strong>` : ''}
            </div>
            ${reg.status === "pending" ? `
                <div class="item-actions">
                    <button class="btn btn-info btn-sm" onclick="openVoterFaceVerifyModal('${escapeHtml(reg.face_id || '')}', '${escapeHtml(reg.commitment)}', '${escapeHtml(reg.proof_of_identity || '')}')">🔍 Verify Face</button>
                    <button class="btn btn-success btn-sm" onclick="approveReg('${escapeHtml(reg.commitment)}')">Approve Voter</button>
                    <button class="btn btn-danger btn-sm" onclick="rejectReg('${escapeHtml(reg.commitment)}')">Reject Voter</button>
                </div>
            ` : ''}
        </div>
    `).join("");
}

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

    modalVoterId.textContent = identity || "Anonymous Identity";
    modalFaceId.textContent = faceId || "N/A";
    modalCommitment.textContent = `${commitment.substring(0, 18)}...${commitment.substring(commitment.length - 8)}`;

    modalResultBox.classList.add("hidden");
    btnModalApprove.classList.add("hidden");
    btnModalReject.classList.add("hidden");
    modalCameraBox.classList.remove("scanning");
    voterFaceModal.classList.remove("hidden");

    setFeedback(modalFaceFeedback, "info", "🔍 Checking if voter enrolled a biometric profile...");
    btnModalScanFace.disabled = true;

    try {
        const profile = await FaceUI.checkVoterProfile(API_BASE, faceId);
        if (profile.enrolled) {
            setFeedback(modalFaceFeedback, "info", `👁️ Enrolled profile found (${profile.embedding_count} vectors). Align voter and click "Verify Face Live".`);
            modalCameraBox.classList.remove("hidden");
            await FaceUI.startWebcam(modalVoterCam);
            btnModalScanFace.disabled = false;
        } else {
            modalCameraBox.classList.add("hidden");
            setFeedback(modalFaceFeedback, "warning", "ℹ️ No biometric profile enrolled by this voter. You may verify identity via student/employee ID and approve or reject.");
            btnModalApprove.classList.remove("hidden");
            btnModalReject.classList.remove("hidden");
        }
    } catch (err) {
        setFeedback(modalFaceFeedback, "error", `Face service error: ${err.message}`);
    }
};

window.closeVoterFaceModal = function() {
    FaceUI.stopWebcam(modalVoterCam);
    modalCameraBox.classList.remove("scanning");
    voterFaceModal.classList.add("hidden");
    activeVoterCommitment = null;
    activeVoterFaceId = null;
};

if (btnModalScanFace) {
    btnModalScanFace.addEventListener("click", async () => {
        btnModalScanFace.disabled = true;
        btnModalScanFace.textContent = "Verifying live biometric...";
        modalCameraBox.classList.add("scanning");
        setFeedback(modalFaceFeedback, "warning", "📸 Scanning dual frames for liveness and computing cosine similarity...");

        try {
            const { image, prev_image } = await FaceUI.captureDualFrames(modalVoterCam, 280);
            const result = await FaceUI.verifyVoter(API_BASE, adminToken, {
                faceId: activeVoterFaceId,
                image,
                prevImage: prev_image
            });

            modalCameraBox.classList.remove("scanning");
            btnModalScanFace.disabled = false;
            btnModalScanFace.textContent = "📸 Verify Face Live (Dual-Frame)";

            modalResultBox.classList.remove("hidden");
            if (result.matched) {
                modalMatchBadge.className = "status-pill approved";
                modalMatchBadge.textContent = `MATCH CONFIRMED (${result.confidence}%)`;
                modalScoreText.textContent = `Cosine Similarity: ${result.similarity} | Distance: ${result.distance} | Anti-spoofing PASSED`;
                setFeedback(modalFaceFeedback, "success", "✅ Face matches voter enrollment! Ready to approve.");
                btnModalApprove.classList.remove("hidden");
                btnModalReject.classList.remove("hidden");
            } else {
                modalMatchBadge.className = "status-pill rejected";
                modalMatchBadge.textContent = `MATCH FAILED (${result.confidence || 0}%)`;
                modalScoreText.textContent = `Result: ${result.message || result.error || "Low similarity"}`;
                setFeedback(modalFaceFeedback, "error", `❌ Verification failed: ${result.error || result.message || "Face does not match."}`);
                btnModalApprove.classList.remove("hidden");
                btnModalReject.classList.remove("hidden");
            }
        } catch (err) {
            modalCameraBox.classList.remove("scanning");
            btnModalScanFace.disabled = false;
            btnModalScanFace.textContent = "📸 Verify Face Live (Dual-Frame)";
            setFeedback(modalFaceFeedback, "error", `Verification error: ${err.message}`);
        }
    });
}

if (btnModalApprove) {
    btnModalApprove.addEventListener("click", async () => {
        if (!activeVoterCommitment) return;
        const commitment = activeVoterCommitment;
        closeVoterFaceModal();
        await window.approveReg(commitment);
    });
}

if (btnModalReject) {
    btnModalReject.addEventListener("click", async () => {
        if (!activeVoterCommitment) return;
        const commitment = activeVoterCommitment;
        closeVoterFaceModal();
        await window.rejectReg(commitment);
    });
}

// Approve / Reject Actions
window.approveReg = async function(commitment) {
    try {
        const res = await fetch(`${API_BASE}/registrations/${encodeURIComponent(commitment)}/approve`, {
            method: "POST",
            headers: { "X-Admin-Token": adminToken }
        });
        const data = await res.json();
        if (data.success) {
            await loadDashboardData();
        } else {
            alert("Approval failed: " + data.error);
        }
    } catch (err) {
        alert("Error approving voter: " + err.message);
    }
};

window.rejectReg = async function(commitment) {
    try {
        const res = await fetch(`${API_BASE}/registrations/${encodeURIComponent(commitment)}/reject`, {
            method: "POST",
            headers: { "X-Admin-Token": adminToken }
        });
        const data = await res.json();
        if (data.success) {
            await loadDashboardData();
        } else {
            alert("Rejection failed: " + data.error);
        }
    } catch (err) {
        alert("Error rejecting voter: " + err.message);
    }
};

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Check session on load
// Require both token AND face verification for direct dashboard access
const isFaceVerified = sessionStorage.getItem("pq_admin_face_verified") === "true";
if (adminToken && isFaceVerified) {
    showDashboard();
} else {
    showAuth();
}
