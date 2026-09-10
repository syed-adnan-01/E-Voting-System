const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
    console.log("=== Deploying PQ-ZKVote Smart Contracts ===");

    const signers = await hre.ethers.getSigners();
    if (!signers || signers.length === 0) {
        console.error("\n❌ Error: No deployer account configured!");
        console.error("Please add your PRIVATE_KEY to contracts/.env or the project root .env file.");
        console.error("Example format: PRIVATE_KEY=\"0xabcdef...\"\n");
        process.exit(1);
    }
    const deployer = signers[0];
    console.log("Deployer address:              ", deployer.address);
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Account balance:               ", hre.ethers.formatEther(balance), "ETH");

    if (balance === 0n && hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
        console.error("\n❌ Error: Deployer wallet has 0 ETH on " + hre.network.name + "!");
        console.error("Please claim free Sepolia testnet ETH from one of the following faucets:");
        console.error("  1. Google Cloud Web3 Faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia");
        console.error("  2. Alchemy Sepolia Faucet:    https://sepoliafaucet.com/");
        console.error("  3. QuickNode Faucet:          https://faucet.quicknode.com/ethereum/sepolia\n");
        process.exit(1);
    }

    // 1. Deploy Groth16Verifier
    const VerifierFactory = await hre.ethers.getContractFactory("Groth16Verifier");
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log("Groth16Verifier deployed to:   ", verifierAddress);

    // 2. Deploy LatticeVerifier
    const LatticeVerifierFactory = await hre.ethers.getContractFactory("LatticeVerifier");
    const latticeVerifier = await LatticeVerifierFactory.deploy();
    await latticeVerifier.waitForDeployment();
    const latticeVerifierAddress = await latticeVerifier.getAddress();
    console.log("LatticeVerifier deployed to:  ", latticeVerifierAddress);

    // 3. Initial Merkle Root & Election Parameters
    const initialMerkleRoot = process.env.INITIAL_MERKLE_ROOT || ("0x" + "0".repeat(64));
    const electionId = process.env.ELECTION_ID || 1;

    // 4. Deploy VotingContract
    const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
    const votingContract = await VotingContractFactory.deploy(
        verifierAddress,
        latticeVerifierAddress,
        initialMerkleRoot,
        electionId
    );
    await votingContract.waitForDeployment();
    const votingContractAddress = await votingContract.getAddress();
    console.log("VotingContract deployed to:    ", votingContractAddress);
    console.log("Election ID:                   ", electionId);
    console.log("Initial Merkle Root:           ", initialMerkleRoot);

    // 5. Export deployment addresses to JSON artifact
    const buildDir = path.join(__dirname, "../../build");
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }

    const deploymentData = {
        network: hre.network.name,
        chainId: hre.network.config.chainId || 31337,
        verifierAddress,
        latticeVerifierAddress,
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
