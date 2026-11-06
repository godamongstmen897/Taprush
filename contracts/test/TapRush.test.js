const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const FEE = ethers.parseEther("100");
const WEEK = 7 * 24 * 3600;

async function fixture() {
  const [owner, verifier, a, b, c, d, stranger] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockGoodDollar");
  const gd = await Token.deploy();
  const Game = await ethers.getContractFactory("TapRush");
  const game = await Game.deploy(await gd.getAddress(), verifier.address, FEE, 500, owner.address);
  for (const p of [a, b, c, d, stranger]) {
    await gd.connect(p).faucet();
    await gd.connect(p).approve(await game.getAddress(), ethers.MaxUint256);
  }
  return { owner, verifier, a, b, c, d, stranger, gd, game };
}

async function sign(game, verifier, roundId, player, score) {
  const { chainId } = await ethers.provider.getNetwork();
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256", "address", "uint32"],
      [chainId, await game.getAddress(), roundId, player.address, score]
    )
  );
  return verifier.signMessage(ethers.getBytes(inner));
}

async function play(game, verifier, player, score) {
  await game.connect(player).startRound();
  const id = (await game.nextRoundId()) - 1n;
  const sig = await sign(game, verifier, id, player, score);
  return { id, tx: game.connect(player).submitScore(id, score, sig) };
}

describe("TapRush", () => {
  it("takes the G$ fee, splits treasury/pot, counts stats", async () => {
    const { game, gd, a } = await loadFixture(fixture);
    await expect(game.connect(a).startRound()).to.changeTokenBalances(
      gd,
      [a, await game.getAddress()],
      [-FEE, FEE]
    );
    expect(await game.treasuryBalance()).to.equal((FEE * 500n) / 10000n);
    expect(await game.pot(0)).to.equal(FEE - (FEE * 500n) / 10000n);
    expect(await game.uniquePlayers()).to.equal(1n);
    expect(await game.totalRounds()).to.equal(1n);
  });

  it("accepts a verifier-signed score and rejects forged / replayed / foreign ones", async () => {
    const { game, verifier, a, b, stranger } = await loadFixture(fixture);
    await game.connect(a).startRound();
    const good = await sign(game, verifier, 1n, a, 250);
    const forged = await sign(game, stranger, 1n, a, 120); // signed by wrong key

    await expect(game.connect(a).submitScore(1, 120, forged)).to.be.revertedWithCustomError(game, "BadSignature");
    await expect(game.connect(a).submitScore(1, 251, good)).to.be.revertedWithCustomError(game, "BadSignature"); // score tampered
    await expect(game.connect(b).submitScore(1, 250, good)).to.be.revertedWithCustomError(game, "NotRoundPlayer");
    await expect(game.connect(a).submitScore(1, 250, good)).to.emit(game, "ScoreSubmitted");
    await expect(game.connect(a).submitScore(1, 250, good)).to.be.revertedWithCustomError(game, "AlreadySubmitted");
    await expect(game.connect(a).submitScore(99, 250, good)).to.be.revertedWithCustomError(game, "UnknownRound");
  });

  it("rejects out-of-range scores even if signed", async () => {
    const { game, verifier, a } = await loadFixture(fixture);
    await game.connect(a).startRound();
    const sig = await sign(game, verifier, 1n, a, 50);
    await expect(game.connect(a).submitScore(1, 50, sig)).to.be.revertedWithCustomError(game, "BadScore");
  });

  it("keeps a sorted top list, one slot per player, improving only on better scores", async () => {
    const { game, verifier, a, b, c } = await loadFixture(fixture);
    await (await play(game, verifier, a, 300)).tx;
    await (await play(game, verifier, b, 200)).tx;
    await (await play(game, verifier, c, 250)).tx;
    let [players, scores] = await game.getTop(0);
    expect(players).to.deep.equal([b.address, c.address, a.address]);
    expect(scores.map(Number)).to.deep.equal([200, 250, 300]);

    await (await play(game, verifier, a, 150)).tx; // a improves -> rank 1, still one slot
    [players, scores] = await game.getTop(0);
    expect(players).to.deep.equal([a.address, b.address, c.address]);
    expect(scores.map(Number)).to.deep.equal([150, 200, 250]);

    await (await play(game, verifier, a, 400)).tx; // worse -> ignored
    expect((await game.bestScore(0, a.address))).to.equal(150n);
    expect((await game.getTop(0))[0].length).to.equal(3);
  });

  it("caps the board at 10 and drops the slowest", async () => {
    const { game, verifier } = await loadFixture(fixture);
    const wallets = [];
    for (let i = 0; i < 11; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      wallets.push(w);
    }
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractAt("MockGoodDollar", await game.gd());
    for (let i = 0; i < 11; i++) {
      await owner.sendTransaction({ to: wallets[i].address, value: ethers.parseEther("1") });
      await Token.connect(wallets[i]).faucet();
      await Token.connect(wallets[i]).approve(await game.getAddress(), ethers.MaxUint256);
      await (await play(game, verifier, wallets[i], 200 + i * 10)).tx;
    }
    const [players, scores] = await game.getTop(0);
    expect(players.length).to.equal(10);
    expect(scores.map(Number)).to.deep.equal([200, 210, 220, 230, 240, 250, 260, 270, 280, 290]);
    expect(players).to.not.include(wallets[10].address);
  });

  it("finalizes in order, pays 50/30/20 via claims, blocks double-claim and non-winners", async () => {
    const { game, gd, verifier, a, b, c, d } = await loadFixture(fixture);
    await (await play(game, verifier, a, 210)).tx; // 1st
    await (await play(game, verifier, b, 220)).tx; // 2nd
    await (await play(game, verifier, c, 230)).tx; // 3rd
    await (await play(game, verifier, d, 400)).tx; // 4th, no prize
    const pot = await game.pot(0);

    await expect(game.finalizeWeek(0)).to.be.revertedWithCustomError(game, "WeekNotOver");
    await time.increase(WEEK + 1);
    await expect(game.finalizeWeek(1)).to.be.revertedWithCustomError(game, "WeekNotOver");
    await game.finalizeWeek(0);
    await expect(game.finalizeWeek(0)).to.be.revertedWithCustomError(game, "AlreadyFinalized");

    await expect(game.connect(a).claimPrize(0)).to.changeTokenBalance(gd, a, (pot * 50n) / 100n);
    await expect(game.connect(b).claimPrize(0)).to.changeTokenBalance(gd, b, (pot * 30n) / 100n);
    await expect(game.connect(c).claimPrize(0)).to.changeTokenBalance(gd, c, (pot * 20n) / 100n);
    await expect(game.connect(a).claimPrize(0)).to.be.revertedWithCustomError(game, "AlreadyClaimed");
    await expect(game.connect(d).claimPrize(0)).to.be.revertedWithCustomError(game, "NothingToClaim");
  });

  it("rolls unallocated prize into next week when fewer than 3 winners; cannot skip weeks", async () => {
    const { game, verifier, a } = await loadFixture(fixture);
    await (await play(game, verifier, a, 210)).tx;
    const pot0 = await game.pot(0);
    await time.increase(2 * WEEK + 1); // weeks 0 and 1 both over
    await expect(game.finalizeWeek(1)).to.be.revertedWithCustomError(game, "PreviousWeekOpen");
    await game.finalizeWeek(0);
    const paid = (pot0 * 50n) / 100n;
    expect(await game.pot(1)).to.equal(pot0 - paid);
  });

  it("a round paid in a week cannot be scored after that week is finalized", async () => {
    const { game, verifier, a } = await loadFixture(fixture);
    await game.connect(a).startRound();
    await time.increase(WEEK + 1);
    await game.finalizeWeek(0);
    const sig = await sign(game, verifier, 1n, a, 220);
    await expect(game.connect(a).submitScore(1, 220, sig)).to.be.revertedWithCustomError(game, "AlreadyFinalized");
  });

  it("owner controls: fee, treasury cap, pause, withdraw, 2-step ownership", async () => {
    const { game, gd, owner, a, stranger } = await loadFixture(fixture);
    await expect(game.connect(stranger).setEntryFee(1)).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
    await expect(game.setTreasuryBps(1001)).to.be.revertedWithCustomError(game, "BadBps");
    await game.pause();
    await expect(game.connect(a).startRound()).to.be.revertedWithCustomError(game, "EnforcedPause");
    await game.unpause();
    await game.connect(a).startRound();
    const t = await game.treasuryBalance();
    await expect(game.withdrawTreasury(owner.address, t)).to.changeTokenBalance(gd, owner, t);
    await expect(game.withdrawTreasury(owner.address, 1)).to.be.reverted; // nothing left
    await game.transferOwnership(a.address);
    expect(await game.owner()).to.equal(owner.address); // not yet
    await game.connect(a).acceptOwnership();
    expect(await game.owner()).to.equal(a.address);
  });

  it("seedPot lets sponsors add G$ to the current prize pool", async () => {
    const { game, a } = await loadFixture(fixture);
    await game.connect(a).seedPot(ethers.parseEther("1000"));
    expect(await game.pot(0)).to.equal(ethers.parseEther("1000"));
  });
});
