/**
 * scripts/start_all.js
 * =====================
 * Spawns all core PQ-ZKVote backend and frontend services in a single terminal:
 *   - Registrar Service:    http://localhost:4000
 *   - Tallying Service:     http://localhost:4002
 *   - Unified Web Portal:   http://localhost:5000
 * Gracefully shuts down all child processes on SIGINT (Ctrl+C).
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const services = [
    { name: "REGISTRAR", script: "registrar/server.js", port: 4000, color: "\x1b[34m" },
    { name: "TALLY    ", script: "tally/server.js",     port: 4002, color: "\x1b[32m" },
    { name: "DASHBOARD", script: "dashboard/server.js", port: 5000, color: "\x1b[35m" }
];

const processes = [];
const RESET = "\x1b[0m";

console.log("==========================================================================");
console.log("             PQ-ZKVOTE: LAUNCHING ALL CORE SERVICES                        ");
console.log("==========================================================================");

for (const svc of services) {
    const fullPath = path.join(__dirname, "..", svc.script);
    const child = spawn(process.execPath, [fullPath], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: svc.port },
        stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
            console.log(`${svc.color}[${svc.name}]${RESET} ${line}`);
        }
    });

    child.stderr.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
            console.error(`${svc.color}[${svc.name} ERR]${RESET} ${line}`);
        }
    });

    child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
            console.log(`${svc.color}[${svc.name}]${RESET} Exited with code ${code}`);
        }
    });

    processes.push(child);
}

// Optionally attempt to spawn Anomaly Service if Python is available
try {
    const anomalyPath = path.join(__dirname, "../anomaly/server.py");
    const pyChild = spawn("python", [anomalyPath], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: 8000 },
        stdio: ["ignore", "pipe", "pipe"]
    });

    pyChild.stdout.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
            console.log(`\x1b[33m[ANOMALY  ]${RESET} ${line}`);
        }
    });

    pyChild.stderr.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
            // Ignore minor uvicorn startup logs on stderr
            if (!line.includes("ModuleNotFoundError")) {
                console.log(`\x1b[33m[ANOMALY  ]${RESET} ${line}`);
            }
        }
    });

    pyChild.on("error", () => {
        // Python or dependencies not installed, continue cleanly
    });

    processes.push(pyChild);
} catch (e) {
    // Non-fatal
}

// Optionally attempt to spawn Face Recognition Service if available
try {
    const faceServiceDir = path.join(__dirname, "../face-service");
    const facePath = path.join(faceServiceDir, "main.py");
    const venvPyWin = path.join(faceServiceDir, "venv/Scripts/python.exe");
    const venvPyUnix = path.join(faceServiceDir, "venv/bin/python");
    let pyBin = "python";
    if (fs.existsSync(venvPyWin)) {
        pyBin = venvPyWin;
    } else if (fs.existsSync(venvPyUnix)) {
        pyBin = venvPyUnix;
    }

    const faceChild = spawn(pyBin, [facePath], {
        cwd: faceServiceDir,
        env: { ...process.env, PORT: 8000, HOST: "0.0.0.0" },
        stdio: ["ignore", "pipe", "pipe"]
    });

    faceChild.stdout.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
            console.log(`\x1b[36m[FACE-SVC ]${RESET} ${line}`);
        }
    });

    faceChild.stderr.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
            if (!line.includes("ModuleNotFoundError")) {
                console.log(`\x1b[36m[FACE-SVC ]${RESET} ${line}`);
            }
        }
    });

    faceChild.on("error", () => {
        // Python or dependencies not installed, continue cleanly
    });

    processes.push(faceChild);
} catch (e) {
    // Non-fatal
}

setTimeout(() => {
    console.log("\n--------------------------------------------------------------------------");
    console.log("  ALL SERVICES ARE RUNNING! Open your browser to:");
    console.log("--------------------------------------------------------------------------");
    console.log("  • Live Election Dashboard:  \x1b[36mhttp://localhost:5000\x1b[0m");
    console.log("  • Voter Portal:             \x1b[36mhttp://localhost:5000/voter\x1b[0m");
    console.log("  • Admin Management:         \x1b[36mhttp://localhost:5000/admin\x1b[0m");
    console.log("  • Public Audit Log:         \x1b[36mhttp://localhost:5000/public\x1b[0m");
    console.log("  • Registrar REST API:       \x1b[36mhttp://localhost:4000\x1b[0m");
    console.log("  • Tallying REST API:        \x1b[36mhttp://localhost:4002\x1b[0m");
    console.log("  • Face Recognition API:     \x1b[36mhttp://localhost:8000\x1b[0m");
    console.log("--------------------------------------------------------------------------");
    console.log("  Press Ctrl + C to stop all services.\n");
}, 1500);

function cleanup() {
    console.log("\n[Shutdown] Stopping all services...");
    for (const p of processes) {
        try {
            p.kill();
        } catch (e) {}
    }
    process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
