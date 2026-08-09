const API_BASE = window.location.origin.includes("localhost") 
    ? "http://localhost:4000" 
    : window.location.origin;

let adminToken = localStorage.getItem("pq_admin_token") || "admin-secret-token";
let currentElections = [];

// DOM Elements
const authSection = document.getElementById("authSection");
const dashboardSection = document.getElementById("dashboardSection");
const tokenInput = document.getElementById("tokenInput");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authText = document.getElementById("authText");

const createEventForm = document.getElementById("createEventForm");
const eventNameInput = document.getElementById("eventName");
const candidatesInput = document.getElementById("candidatesInput");
const electionsList = document.getElementById("electionsList");
const refreshEventsBtn = document.getElementById("refreshEventsBtn");

const registrationQueue = document.getElementById("registrationQueue");
const pendingCountBadge = document.getElementById("pendingCount");
const electionFilterSelect = document.getElementById("electionFilterSelect");

// --- Auth Handling ---
loginBtn.addEventListener("click", async () => {
    const inputToken = tokenInput.value.trim();
    if (!inputToken) {
        alert("Please enter an admin token");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: inputToken })
        });
        const data = await res.json();
        if (data.success) {
            adminToken = inputToken;
            localStorage.setItem("pq_admin_token", adminToken);
            showDashboard();
        } else {
            alert("Authentication failed: " + (data.error || "Invalid token"));
        }
    } catch (err) {
        alert("Server connection error: " + err.message);
    }
});

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("pq_admin_token");
    adminToken = "";
    showAuth();
});

function showAuth() {
    authSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
    authText.textContent = "Not Authenticated";
}

function showDashboard() {
    authSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    authText.textContent = "Authenticated";
    loadDashboardData();
}

// --- Data Loading ---
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

// --- Create Election ---
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

// --- Close Election ---
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

// --- Registrations Queue ---
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
                    <button class="btn btn-success btn-sm" onclick="approveReg('${escapeHtml(reg.commitment)}')">Approve Voter</button>
                    <button class="btn btn-danger btn-sm" onclick="rejectReg('${escapeHtml(reg.commitment)}')">Reject Voter</button>
                </div>
            ` : ''}
        </div>
    `).join("");
}

// --- Approve / Reject Actions ---
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

// Auto-check auth on load
if (adminToken) {
    showDashboard();
} else {
    showAuth();
}
