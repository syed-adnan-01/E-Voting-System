#!/usr/bin/env bash
set -e

echo "=== 1. Compiling Circom Circuit ==="
mkdir -p build
PATH="$HOME/.local/bin:$PATH"

if [ -f "./bin/circom" ]; then
    CIRCOM_BIN="./bin/circom"
else
    CIRCOM_BIN="circom"
fi

$CIRCOM_BIN -l circuits/node_modules circuits/vote.circom --r1cs --wasm --sym -o build/

echo "=== 2. Powers of Tau Setup ==="
if [ ! -f "build/pot13_final.ptau" ]; then
    echo "Generating local Powers of Tau (2^13)..."
    npx snarkjs powersoftau new bn128 13 build/pot13_0000.ptau -v
    npx snarkjs powersoftau contribute build/pot13_0000.ptau build/pot13_0001.ptau --name="PQZKVote setup" -v -e="entropy_$(date +%s)"
    npx snarkjs powersoftau prepare phase2 build/pot13_0001.ptau build/pot13_final.ptau -v
fi

echo "=== 3. Groth16 Circuit Setup & ZKey Generation ==="
npx snarkjs groth16 setup build/vote.r1cs build/pot13_final.ptau build/vote_0000.zkey
npx snarkjs zkey contribute build/vote_0000.zkey build/vote_final.zkey --name="PQZKVote contributor" -v -e="entropy_$(date +%s)"
npx snarkjs zkey export verificationkey build/vote_final.zkey build/verification_key.json

echo "=== 4. Exporting Solidity Verifier ==="
mkdir -p contracts/contracts
npx snarkjs zkey export solidityverifier build/vote_final.zkey contracts/contracts/Verifier.sol
cp contracts/contracts/Verifier.sol contracts/Verifier.sol

echo "=== Circuit Compile & Setup Complete ==="
