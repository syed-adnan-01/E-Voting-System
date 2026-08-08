const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");

async function verifyVote({
    proofPath = path.join(__dirname, "../build/proof.json"),
    publicPath = path.join(__dirname, "../build/public.json"),
    vkeyPath = path.join(__dirname, "../build/verification_key.json"),
    proofObj = null,
    publicObj = null
} = {}) {
    const vKey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    const proof = proofObj || JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const publicSignals = publicObj || JSON.parse(fs.readFileSync(publicPath, "utf8"));

    const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    return isValid;
}

// Allow CLI execution directly
if (require.main === module) {
    verifyVote()
        .then(isValid => {
            if (isValid) {
                console.log("=== Verification SUCCESS: Proof is VALID ===");
                process.exit(0);
            } else {
                console.error("=== Verification FAILED: Proof is INVALID ===");
                process.exit(1);
            }
        })
        .catch(err => {
            console.error("Verification Error:", err.message);
            process.exit(1);
        });
}

module.exports = { verifyVote };
