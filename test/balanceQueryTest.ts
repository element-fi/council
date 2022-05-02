import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { createSnapshot, restoreSnapshot } from "./helpers/snapshots";
import {
  BalanceQuery,
  LockingVault,
  TestVestingVault,
  MockERC20,
} from "typechain";

const { provider } = waffle;

describe("Balance Query", function () {
  let balanceQuery: BalanceQuery;
  let signers: SignerWithAddress[];
  let lockingVault: LockingVault;
  let vestingVault: TestVestingVault;
  let token: MockERC20;
  const one = ethers.utils.parseEther("1");
  const amount: BigNumber = ethers.utils.parseEther("10");

  before(async () => {
    // Create a before snapshot
    await createSnapshot(provider);
    signers = await ethers.getSigners();

    // deploy the token;
    const erc20Deployer = await ethers.getContractFactory(
      "MockERC20",
      signers[0]
    );
    token = await erc20Deployer.deploy("Ele", "test ele", signers[0].address);
    // set token amount
    await token.setBalance(signers[0].address, amount);

    // deploy the locking vault
    const lockingVaultDeployer = await ethers.getContractFactory(
      "LockingVault",
      signers[0]
    );
    lockingVault = await lockingVaultDeployer.deploy(token.address, 199350);

    // deploy the vesting vault
    const vestingVaultDeployer = await ethers.getContractFactory(
      "TestVestingVault",
      signers[0]
    );
    vestingVault = await vestingVaultDeployer.deploy(token.address, 199350);
    // set approval and deposit some tokens
    await token.connect(signers[0]).approve(vestingVault.address, amount);
    await vestingVault.connect(signers[0]).deposit(amount);

    // deploy the contract
    const deployer = await ethers.getContractFactory(
      "BalanceQuery",
      signers[0]
    );
    balanceQuery = await deployer.deploy(signers[0].address, [
      lockingVault.address,
      vestingVault.address,
    ]);

    // Give users some balance and set their allowance
    for (const signer of signers) {
      await token.setBalance(signer.address, ethers.utils.parseEther("100000"));
      await token.setAllowance(
        signer.address,
        lockingVault.address,
        ethers.constants.MaxUint256
      );
    }
  });
  // After we reset our state in the fork
  after(async () => {
    await restoreSnapshot(provider);
  });
  // describe("Add vault", async () => {
  //   it("fails to add already added vault", async () => {
  //     const mockVestingVaultAddress =
  //       "0x814C447a9F58A2b823504Fe2775bA48c843925B6";
  //     // successfully add vault once
  //     await balanceQuery.addVault(mockVestingVaultAddress);
  //     // second add should fail with the same address
  //     const tx = balanceQuery.addVault(mockVestingVaultAddress);
  //     await expect(tx).to.be.revertedWith("vault already added");
  //   });
  // });
  // describe("Remove vault", async () => {
  //   it("fails to remove nonexistent vault", async () => {
  //     const mockLockingVaultAddress =
  //       "0x5a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c";
  //     const tx = balanceQuery.removeVault(mockLockingVaultAddress);
  //     await expect(tx).to.be.revertedWith(
  //       "vault already removed or does not exist"
  //     );
  //   });
  //   it("fails to remove vault that has already been removed", async () => {
  //     const mockVestingVaultAddress =
  //       "0x814C447a9F58A2b823504Fe2775bA48c843925B6";
  //     // successfully removes vault once
  //     await balanceQuery.removeVault(mockVestingVaultAddress);
  //     // second removal should fail
  //     const tx = balanceQuery.removeVault(mockVestingVaultAddress);
  //     await expect(tx).to.be.revertedWith(
  //       "vault already removed or does not exist"
  //     );
  //   });
  // });
  //   describe("Check balance of vault", async () => {
  //     // Before each we snapshot
  //     beforeEach(async () => {
  //         await createSnapshot(provider);
  //       });
  //       // After we reset our state in the fork
  //       afterEach(async () => {
  //         await restoreSnapshot(provider);
  //       });
  //     // Deposit by calling from address 0 and delegating to address 1
  //     const tx = await vault.deposit(signers[0].address, one, signers[1].address);
  //     const calldatas = "0x12345678ffffffff";
  //     const votingPower = await balanceQuery.balanceOfVault(signers[1].address, calldatas, vault.address)
  //     expect(votingPower).to.be.eq(one);

  //   });
});
