// Point an already-deployed TapRush at a new verifier address (owner only).
// Usage: npx hardhat run scripts/setVerifier.js --network celoSepolia
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const GAME = ethers.getAddress("0x83F425d92eC3b2d628fe5211Dad9C89f6988C4B2".toLowerCase());
const NEW_VERIFIER = ethers.getAddress("0x6dF355b84feC25D974E933BCe7aE9C34CA581D88".toLowerCase());
const EXPECTED_OWNER = ethers.getAddress("0xb7dD2dAaC0d4CF20ACDad1e89785A01e81b9D8BA".toLowerCase());

async function main() {
  if (network.name !== "celoSepolia") throw new Error("This script is for celoSepolia only");

  const [signer] = await ethers.getSigners();
  const game = await ethers.getContractAt("TapRush", GAME, signer);

  const ownerBefore = await game.owner();
  console.log("Sender:          ", signer.address);
  console.log("Contract owner:  ", ownerBefore);
  if (ownerBefore !== signer.address) throw new Error("Sender is not the owner; nothing sent");
  console.log("Current verifier:", await game.verifier());

  const tx = await game.setVerifier(NEW_VERIFIER);
  console.log("Tx sent:         ", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block", receipt.blockNumber, "status", receipt.status === 1 ? "success" : "FAILED");

  // Public RPC nodes can lag a block behind, so retry the readback briefly.
  let v;
  for (let i = 1; i <= 5; i++) {
    v = await game.verifier();
    if (v === NEW_VERIFIER) break;
    console.log(`Readback ${i}/5 still shows ${v}; retrying in 3s...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const o = await game.owner();
  console.log("verifier():      ", v, v === NEW_VERIFIER ? "(matches)" : "(MISMATCH)");
  console.log("owner():         ", o, o === EXPECTED_OWNER ? "(unchanged)" : "(MISMATCH)");
  if (v !== NEW_VERIFIER || o !== EXPECTED_OWNER) throw new Error("Readback check failed; JSON not updated");

  const file = path.join(__dirname, "..", "deployments", "celoSepolia.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (ethers.getAddress(d.game.toLowerCase()) !== GAME) throw new Error("JSON game address mismatch; JSON not updated");
  d.verifier = NEW_VERIFIER;
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  console.log("Updated deployments/celoSepolia.json");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
