const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
    console.log("=== Deploying PQ-ZKVote Smart Contracts ===");

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deployer address:", deployer.address);
    console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

    // 1. Deploy Groth16Verifier
    const VerifierFactory = await hre.ethers.getContractFactory("Groth16Verifier");
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log("Groth16Verifier deployed to:", verifierAddress);

    // 2. Initial Merkle Root & Election Parameters
    // Default initial Merkle root (or placeholder if empty tree)
    const initialMerkleRoot = process.env.INITIAL_MERKLE_ROOT || "0x0000000000000000000000000000000000000000000000000000000000000000";
    const electionId = process.env.ELECTION_ID || 1;

    // 3. Deploy VotingContract
    const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
    const votingContract = await VotingContractFactory.deploy(verifierAddress, initialMerkleRoot, electionId);
    await votingContract.waitForDeployment();
    const votingContractAddress = await votingContract.getAddress();
    console.log("VotingContract deployed to:", votingContractAddress);
    console.log("Election ID:", electionId);
    console.log("Initial Merkle Root:", initialMerkleRoot);

    // 4. Export deployment addresses to JSON artifact
    const buildDir = path.join(__dirname, "../../build");
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }

    const deploymentData = {
        network: hre.network.name,
        chainId: hre.network.config.chainId || 31337,
        verifierAddress,
        votingContractAddress,
        electionId,
        merkleRoot: initialMerkleRoot,
        deployedAt: new Date().toISOString()
    };

    const outputPath = path.join(buildDir, "deployed_addresses.json");
    fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
    console.log(`Deployment info saved to: ${outputPath}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
