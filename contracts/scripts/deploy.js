const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Official G$ token on Celo mainnet (GoodDollar docs).
const GD_CELO_MAINNET = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set DEPLOYER_PRIVATE_KEY in contracts/.env");

  const verifier = process.env.VERIFIER_ADDRESS;
  if (!verifier || !ethers.isAddress(verifier)) throw new Error("Set VERIFIER_ADDRESS in contracts/.env");

  const isMainnet = network.name === "celo";
  // 100 G$ per round (G$ trades near $0.0001, so this is about one cent).
  const entryFee = ethers.parseEther(process.env.ENTRY_FEE_GD || "100");
  const treasuryBps = Number(process.env.TREASURY_BPS || "500"); // 5%

  console.log(`Network: ${network.name}  Deployer: ${deployer.address}`);

  let gdAddress;
  if (isMainnet) {
    gdAddress = GD_CELO_MAINNET;
    console.log("Using real G$ at", gdAddress);
  } else {
    const Mock = await ethers.getContractFactory("MockGoodDollar");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    gdAddress = await mock.getAddress();
    console.log("MockGoodDollar (testnet only):", gdAddress);
  }

  const Game = await ethers.getContractFactory("TapRush");
  const game = await Game.deploy(gdAddress, verifier, entryFee, treasuryBps, deployer.address);
  await game.waitForDeployment();
  const gameAddress = await game.getAddress();
  console.log("TapRush:", gameAddress);

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    gd: gdAddress,
    game: gameAddress,
    verifier,
    entryFee: entryFee.toString(),
    treasuryBps,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log("Saved deployments/" + network.name + ".json");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
