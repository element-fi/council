import "module-alias/register";

import { expect } from "chai";
import { ethers, network, waffle } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumberish, BigNumber } from "ethers";
import { CompoundVault } from "typechain/CompoundVault";
import { MockERC20 } from "typechain/MockERC20";
import { MockCToken } from "typechain/MockCToken";
import { MockComptroller } from "typechain/MockComptroller";
import { createSnapshot, restoreSnapshot } from "./helpers/snapshots";

const { provider } = waffle;

describe("Compound Vault", function () {
  let vault: CompoundVault;
  let underlying: MockERC20;
  let cToken: MockCToken;
  let comptroller: MockComptroller;
  const [wallet] = provider.getWallets();
  let signers: SignerWithAddress[];
  const one = ethers.utils.parseEther("1");
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  // margin of error for checking retur values
  // set to 0.1% to allow for minor rounding differences in TWAR Multiplier
  const MARGIN_OF_ERROR = 1000;
  // 1 cToken is worth 0.5 underlying
  const cTokenToUnderlyingRate = 0.5;
  const underlyingToCTokenRate = 2;
  const TWAR_MULTIPLIER = "twarMultiplier";
  const BORROW_RATE_PER_BLOCK = 44388081445;
  const SECONDS_PER_DAY = 86400;
  const MAX_TWAR_SNAPSHOTS_LENGTH = 30;
  const BLOCKS_PER_YEAR = 2252857;

  const calcVotePowerFromUnderlying = (
    underlyingAmount: BigNumber,
    multiplier = "0.9"
  ) => {
    const twarMultiplier = ethers.utils.parseEther(multiplier);
    return underlyingAmount.mul(twarMultiplier).div(one);
  };

  const assertBigNumberWithinRange = (
    actualVal: BigNumber,
    expectedVal: BigNumber,
    moe = MARGIN_OF_ERROR
  ) => {
    const upperBound: BigNumber = expectedVal.add(expectedVal.div(moe));
    const lowerBound: BigNumber = expectedVal.sub(expectedVal.div(moe));
    expect(actualVal).to.be.lte(upperBound);
    expect(actualVal).to.be.gte(lowerBound);
  };

  // Mimics Storage.sol and allows us to find the storage slot of a storage variable
  const calculateStorageSlot = (type: string, name: string) => {
    const typeHash: string = ethers.utils.solidityKeccak256(["string"], [type]);
    return ethers.utils.solidityKeccak256(
      ["bytes", "string"],
      [typeHash, name]
    );
  };

  interface Scenario {
    borrowRate: BigNumber; // borrow rate in annual terms, scaled by 10^18 (so 0.05 would be 0.05 * 10 ^18)
    timestamp: number;
  }

  interface TwarSnapshot {
    cumulativeRate: BigNumber;
    timestamp: number;
  }

  const simulateAndCalculateTwarMultiplier = (
    scenarios: Scenario[]
  ): BigNumber => {
    // We assume only one deposit has happened, and thus we start with the dummy snapshot
    let prevSnapshot: TwarSnapshot = {
      cumulativeRate: BigNumber.from(BORROW_RATE_PER_BLOCK * SECONDS_PER_DAY),
      timestamp: 0 + SECONDS_PER_DAY,
    };

    const snapshots: TwarSnapshot[] = [];
    snapshots.push(prevSnapshot);

    for (const scenario of scenarios) {
      const elapsedTime = scenario.timestamp - prevSnapshot.timestamp;
      const newCumulativeRate = prevSnapshot.cumulativeRate.add(
        scenario.borrowRate.mul(elapsedTime)
      );
      prevSnapshot = {
        cumulativeRate: newCumulativeRate,
        timestamp: scenario.timestamp,
      };
      snapshots.push(prevSnapshot);
    }

    // Ok now let's find the weightedBorrowRate
    const subtractIndex: number = Math.max(
      scenarios.length - MAX_TWAR_SNAPSHOTS_LENGTH,
      0
    );
    const subtractSnapshot: TwarSnapshot = snapshots[subtractIndex];
    const mostRecentSnapshot: TwarSnapshot = snapshots[snapshots.length - 1];

    const weightedAnnualBorrowRate: BigNumber =
      mostRecentSnapshot.cumulativeRate
        .sub(subtractSnapshot.cumulativeRate)
        .div(mostRecentSnapshot.timestamp - subtractSnapshot.timestamp)
        .mul(BLOCKS_PER_YEAR);

    const multiplier = one.sub(weightedAnnualBorrowRate);
    return multiplier;
  };

  before(async function () {
    // Create a before snapshot
    await createSnapshot(provider);
    signers = await ethers.getSigners();
    // deploy the underlying token;
    const erc20Deployer = await ethers.getContractFactory(
      "MockERC20",
      signers[0]
    );
    underlying = await erc20Deployer.deploy(
      "Ele test",
      "Ele",
      signers[0].address
    );

    // deploy the cToken token;
    const cTokenDeployer = await ethers.getContractFactory(
      "MockCToken",
      signers[0]
    );
    cToken = await cTokenDeployer.deploy(
      "cEle",
      "cEle test",
      signers[0].address,
      underlying.address
    );

    // deploy a comptroller
    const comptrollerDeployer = await ethers.getContractFactory(
      "MockComptroller",
      signers[0]
    );
    comptroller = await comptrollerDeployer.deploy();

    // deploy the contract
    const deployer = await ethers.getContractFactory(
      "CompoundVault",
      signers[0]
    );
    vault = await deployer.deploy(
      underlying.address,
      cToken.address,
      comptroller.address,
      SECONDS_PER_DAY,
      199350,
      MAX_TWAR_SNAPSHOTS_LENGTH
    );

    // Give users some balance and set their allowance
    for (const signer of signers) {
      await underlying.setBalance(
        signer.address,
        ethers.utils.parseEther("100000")
      );
      await underlying.setAllowance(
        signer.address,
        vault.address,
        ethers.constants.MaxUint256
      );
    }
  });

  // After we reset our state in the fork
  after(async () => {
    await restoreSnapshot(provider);
  });
  // Before each we snapshot
  beforeEach(async () => {
    await createSnapshot(provider);
  });
  // After we reset our state in the fork
  afterEach(async () => {
    await restoreSnapshot(provider);
  });

  describe("Deposit Sequence", async () => {
    beforeEach(async () => {
      await createSnapshot(provider);
    });
    // After we reset our state in the fork
    afterEach(async () => {
      await restoreSnapshot(provider);
    });

    // Test the deposit by user for user
    it("Allows a user's first deposit to set gov power", async () => {
      // Before each we snapshot
      // Deposit by calling from address 0 and delegating to address 1
      const tx = await (
        await vault.deposit(signers[0].address, one, signers[1].address)
      ).wait();
      const votingPower = await vault.callStatic.queryVotePowerView(
        signers[1].address,
        tx.blockNumber
      );
      const expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);
      // expect user 0 to have a deposits
      let userData = await vault.deposits(signers[0].address);
      expect(userData[0]).to.be.eq(signers[1].address);
      expect(userData[1]).to.be.eq(one.mul(underlyingToCTokenRate));
      // expect address 1/2 to have zero deposit
      userData = await vault.deposits(signers[1].address);
      expect(userData[0]).to.be.eq(zeroAddress);
      expect(userData[1]).to.be.eq(0);
      userData = await vault.deposits(signers[2].address);
      expect(userData[0]).to.be.eq(zeroAddress);
      expect(userData[1]).to.be.eq(0);
    });

    it("Allows a user's first deposit to set their own power", async () => {
      // Deposit by calling from address 0 and delegating to address 1
      const tx = await (
        await vault.deposit(signers[0].address, one, signers[0].address)
      ).wait();
      const votingPower = await vault.callStatic.queryVotePowerView(
        signers[0].address,
        tx.blockNumber
      );
      const expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);
    });

    // Test the deposit by user not for user
    it("Allows someone else to add voting power on behalf of user", async () => {
      // Deposit by calling from address 2 to fund address 0 and delegate to address 1
      const tx = await (
        await vault
          .connect(signers[2])
          .deposit(signers[0].address, one, signers[1].address)
      ).wait();
      // expect address 1 to have voting power
      const votingPower = await vault.callStatic.queryVotePowerView(
        signers[1].address,
        tx.blockNumber
      );
      const expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);
      // expect address 0 to have a deposit
      let userData = await vault.deposits(signers[0].address);
      expect(userData[0]).to.be.eq(signers[1].address);
      expect(userData[1]).to.be.eq(one.mul(underlyingToCTokenRate));
      // expect address 1/2 to have zero deposit
      userData = await vault.deposits(signers[1].address);
      expect(userData[0]).to.be.eq(zeroAddress);
      expect(userData[1]).to.be.eq(0);
      userData = await vault.deposits(signers[2].address);
      expect(userData[0]).to.be.eq(zeroAddress);
      expect(userData[1]).to.be.eq(0);
    });

    // Test deposit after user has already deposited once
    it("Does not let second deposit change the delegation", async () => {
      await vault.deposit(signers[0].address, one, signers[0].address);
      const tx = await (
        await vault
          .connect(signers[1])
          .deposit(signers[0].address, one, signers[1].address)
      ).wait();
      // expect address 1 to have voting power
      const votingPower = await vault.callStatic.queryVotePowerView(
        signers[0].address,
        tx.blockNumber
      );
      const expectedVotingPower = calcVotePowerFromUnderlying(one.mul(2));
      assertBigNumberWithinRange(votingPower, expectedVotingPower);
      // expect address 0 to have a deposit
      let userData = await vault.deposits(signers[0].address);
      expect(userData[0]).to.be.eq(signers[0].address);
      expect(userData[1]).to.be.eq(one.mul(2).mul(underlyingToCTokenRate));
      // expect address 1/2 to have zero deposit
      userData = await vault.deposits(signers[1].address);
      expect(userData[0]).to.be.eq(zeroAddress);
      expect(userData[1]).to.be.eq(0);
      userData = await vault.deposits(signers[2].address);
      expect(userData[0]).to.be.eq(zeroAddress);
      expect(userData[1]).to.be.eq(0);
    });
  });

  it("Changes delegates properly", async () => {
    // First we setup the user and give accounts some voting power
    await vault.deposit(signers[0].address, one, signers[0].address);
    await vault
      .connect(signers[1])
      .deposit(signers[1].address, one.div(2), signers[0].address);
    await vault
      .connect(signers[2])
      .deposit(signers[2].address, one.mul(2), signers[2].address);
    // singer 0 has deposit 1 voting power 1.5, singer 1 has deposit 0.5 voting power 0, singer 2 has
    // deposit 2 voting power 2
    // we now change delegates
    const tx = await (await vault.changeDelegation(signers[2].address)).wait();
    // Check on all the deposits and delegations
    let userData = await vault.deposits(signers[0].address);
    expect(userData[0]).to.be.eq(signers[2].address);
    expect(userData[1]).to.be.eq(one.mul(underlyingToCTokenRate));

    userData = await vault.deposits(signers[1].address);
    expect(userData[0]).to.be.eq(signers[0].address);
    expect(userData[1]).to.be.eq(one.div(2).mul(underlyingToCTokenRate));

    userData = await vault.deposits(signers[2].address);
    expect(userData[0]).to.be.eq(signers[2].address);
    expect(userData[1]).to.be.eq(one.mul(2).mul(underlyingToCTokenRate));

    // check the voting power
    const block = tx.blockNumber;
    let votingPower = await vault.callStatic.queryVotePowerView(
      signers[0].address,
      block
    );
    let expectedVotingPower = calcVotePowerFromUnderlying(one.div(2));
    assertBigNumberWithinRange(votingPower, expectedVotingPower);
    // The call to this query voting power method will fail on a length 0 array
    await expect(
      vault.queryVotePowerView(signers[1].address, block)
    ).to.be.revertedWith("uninitialized");
    votingPower = await vault.callStatic.queryVotePowerView(
      signers[2].address,
      block
    );
    expectedVotingPower = calcVotePowerFromUnderlying(one.mul(3));
    assertBigNumberWithinRange(votingPower, expectedVotingPower);
  });

  it("Withdraws properly", async () => {
    // First we setup the user and give accounts some voting power
    await vault.deposit(signers[0].address, one, signers[2].address);
    await vault
      .connect(signers[1])
      .deposit(signers[1].address, one.div(2), signers[0].address);
    await vault
      .connect(signers[2])
      .deposit(signers[2].address, one.mul(2), signers[2].address);
    // We withdraw from user one and check the accounts
    const balanceBefore = await underlying.balanceOf(signers[0].address);
    const tx = await (
      await vault.withdraw(one.div(2).mul(underlyingToCTokenRate))
    ).wait();
    // We check that the user has increased balance
    const balanceAfter = await underlying.balanceOf(signers[0].address);
    expect(balanceAfter.sub(balanceBefore)).to.be.eq(one.div(2));
    // We now check all of the user vault and voting power
    // Check on all the deposits and delegations
    let userData = await vault.deposits(signers[0].address);
    expect(userData[0]).to.be.eq(signers[2].address);
    expect(userData[1]).to.be.eq(one.div(2).mul(underlyingToCTokenRate));

    userData = await vault.deposits(signers[1].address);
    expect(userData[0]).to.be.eq(signers[0].address);
    expect(userData[1]).to.be.eq(one.div(2).mul(underlyingToCTokenRate));

    userData = await vault.deposits(signers[2].address);
    expect(userData[0]).to.be.eq(signers[2].address);
    expect(userData[1]).to.be.eq(one.mul(2).mul(underlyingToCTokenRate));

    // check the voting power
    const block = tx.blockNumber;
    let votingPower = await vault.callStatic.queryVotePowerView(
      signers[0].address,
      block
    );
    let expectedVotingPower = calcVotePowerFromUnderlying(one.div(2));
    assertBigNumberWithinRange(votingPower, expectedVotingPower);
    const queryTx = await (
      await vault.queryVotePower(signers[0].address, block, "0x")
    ).wait();
    // The call to this query voting power method will fail on a length 0 array
    await expect(
      vault.queryVotePowerView(signers[1].address, block)
    ).to.be.revertedWith("uninitialized");
    votingPower = await vault.callStatic.queryVotePowerView(
      signers[2].address,
      block
    );
    expectedVotingPower = calcVotePowerFromUnderlying(
      one.mul(2).add(one.div(2))
    );
    assertBigNumberWithinRange(votingPower, expectedVotingPower);
  });

  describe("TWAR updates", async () => {
    beforeEach(async () => {
      await createSnapshot(provider);
    });
    // After we reset our state in the fork
    afterEach(async () => {
      await restoreSnapshot(provider);
    });

    it("Calculates TWAR correctly if borrow remains same & updated in equi-distant timestamps", async () => {
      // Deposit by calling from address 0 and delegating to address 0
      const tx = await (
        await vault.deposit(signers[0].address, one, signers[0].address)
      ).wait();
      let votingPower = await vault.callStatic.queryVotePowerView(
        signers[0].address,
        tx.blockNumber
      );
      let expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);

      // Let's try increasing the timestamp by 24 hours (86400 seconds) 30 times
      for (let i = 0; i < 30; i++) {
        await network.provider.send("evm_increaseTime", [86400]);
        // Deposit of 0, dummy tx to just trigger an update of the TWAR
        const tx = await (
          await vault.deposit(signers[0].address, 0, signers[0].address)
        ).wait();
      }

      const block = await network.provider.send("eth_blockNumber");
      votingPower = await vault.callStatic.queryVotePowerView(
        signers[0].address,
        block
      );
      expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);
    });

    it("TWAR Multiplier updates correctly when less than MAX_LENGTH updates", async () => {
      // Deposit by calling from address 0 and delegating to address 0
      const firstTx = await (
        await vault.deposit(signers[0].address, one, signers[0].address)
      ).wait();
      const votingPower = await vault.callStatic.queryVotePowerView(
        signers[0].address,
        firstTx.blockNumber
      );
      const expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);

      // Let's generate 20 random scenarios
      const scenarios: Scenario[] = [];
      // Borrow rate is 0.1 (10%) annually.
      const hundredBasisPoints = BigNumber.from(BORROW_RATE_PER_BLOCK).div(10);
      let currTime = SECONDS_PER_DAY;
      let timeStampOfPreviousBlockWithTx = (
        await ethers.provider.getBlock(firstTx.blockNumber)
      ).timestamp;

      for (let i = 0; i < MAX_TWAR_SNAPSHOTS_LENGTH - 10; i++) {
        // Let's set the borrow rate for this scenario from 0.01 - 0.1
        const borrowRate = hundredBasisPoints.mul(
          Math.floor(Math.random() * 10)
        );
        currTime += SECONDS_PER_DAY;
        const newScenario: Scenario = {
          borrowRate: borrowRate,
          timestamp: currTime,
        };
        scenarios.push(newScenario);

        // Let's simulate the generated scenarios in our actual vault
        // First, set the borrow rate
        await cToken.setBorrowRate(newScenario.borrowRate);
        // Let's warp time ahead
        await network.provider.send("evm_setNextBlockTimestamp", [
          timeStampOfPreviousBlockWithTx + SECONDS_PER_DAY,
        ]);

        // Deposit of 0, dummy tx to just trigger an update of the TWAR
        const tx = await (
          await vault.deposit(signers[0].address, 0, signers[0].address)
        ).wait();

        const lastBlock = await ethers.provider.getBlock(tx.blockNumber);
        timeStampOfPreviousBlockWithTx = lastBlock.timestamp;
        // const twoBlocksAgo = await ethers.provider.getBlock(tx.blockNumber - 1);
        // const lastBlock = await ethers.provider.getBlock(tx.blockNumber);
        // console.log(twoBlocksAgo.timestamp, lastBlock.timestamp)
      }

      // Let's see what we expect the multiplier to be now
      const expectedTwarMultiplier: BigNumber =
        simulateAndCalculateTwarMultiplier(scenarios);

      const twarMultiplierStorageSlot = calculateStorageSlot(
        "uint256",
        TWAR_MULTIPLIER
      );
      const twarMultiplierValue: string = await network.provider.send(
        "eth_getStorageAt",
        [vault.address, twarMultiplierStorageSlot, "latest"]
      );
      assertBigNumberWithinRange(
        BigNumber.from(twarMultiplierValue),
        expectedTwarMultiplier
      );
    });

    it("TWAR Multiplier updates correctly when more than MAX_LENGTH updates", async () => {
      // Deposit by calling from address 0 and delegating to address 0
      const firstTx = await (
        await vault.deposit(signers[0].address, one, signers[0].address)
      ).wait();
      const votingPower = await vault.callStatic.queryVotePowerView(
        signers[0].address,
        firstTx.blockNumber
      );
      const expectedVotingPower = calcVotePowerFromUnderlying(one);
      assertBigNumberWithinRange(votingPower, expectedVotingPower);

      // Let's generate 20 random scenarios
      const scenarios: Scenario[] = [];
      // Borrow rate is 0.1 (10%) annually.
      const hundredBasisPoints = BigNumber.from(BORROW_RATE_PER_BLOCK).div(10);
      let currTime = SECONDS_PER_DAY;
      let timeStampOfPreviousBlockWithTx = (
        await ethers.provider.getBlock(firstTx.blockNumber)
      ).timestamp;

      for (let i = 0; i < 2 * MAX_TWAR_SNAPSHOTS_LENGTH + 10; i++) {
        // Let's set the borrow rate for this scenario from 0.01 - 0.1
        const borrowRate = hundredBasisPoints.mul(
          Math.floor(Math.random() * 10)
        );
        currTime += SECONDS_PER_DAY;
        const newScenario: Scenario = {
          borrowRate: borrowRate,
          timestamp: currTime,
        };
        scenarios.push(newScenario);

        // Let's simulate the generated scenarios in our actual vault
        // First, set the borrow rate
        await cToken.setBorrowRate(newScenario.borrowRate);
        // Let's warp time ahead
        await network.provider.send("evm_setNextBlockTimestamp", [
          timeStampOfPreviousBlockWithTx + SECONDS_PER_DAY,
        ]);

        // Deposit of 0, dummy tx to just trigger an update of the TWAR
        const tx = await (
          await vault.deposit(signers[0].address, 0, signers[0].address)
        ).wait();

        const lastBlock = await ethers.provider.getBlock(tx.blockNumber);
        timeStampOfPreviousBlockWithTx = lastBlock.timestamp;
        // const twoBlocksAgo = await ethers.provider.getBlock(tx.blockNumber - 1);
        // const lastBlock = await ethers.provider.getBlock(tx.blockNumber);
        // console.log(twoBlocksAgo.timestamp, lastBlock.timestamp)
      }

      // Let's see what we expect the multiplier to be now
      const expectedTwarMultiplier: BigNumber =
        simulateAndCalculateTwarMultiplier(scenarios);

      const twarMultiplierStorageSlot = calculateStorageSlot(
        "uint256",
        TWAR_MULTIPLIER
      );
      const twarMultiplierValue: string = await network.provider.send(
        "eth_getStorageAt",
        [vault.address, twarMultiplierStorageSlot, "latest"]
      );
      // More data points, so JS & Solidity can diverge a bit more
      assertBigNumberWithinRange(
        BigNumber.from(twarMultiplierValue),
        expectedTwarMultiplier,
        MARGIN_OF_ERROR / 25
      );
    });
  });
});
