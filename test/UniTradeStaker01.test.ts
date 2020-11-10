import { expect, use } from "chai"
import { BigNumber, Contract } from "ethers"
import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"
import UniTradeStaker01 from "../build/UniTradeStaker01.json"
import IERC20 from "./IERC20.json"

use(solidity)

describe("UniTradeStaker01", () => {
  const baseTimestamp = 1700000000
  const defaultStakePeriod = 60 * 60 * 24 * 30 //30 days
  const provider = new MockProvider({
    ganacheOptions: { time: new Date(baseTimestamp * 1000) }
  })
  const [wallet, wallet2] = provider.getWallets()
  let staker: Contract
  let mockUnitrade: Contract

  beforeEach(async () => {
    mockUnitrade = await deployMockContract(wallet, IERC20.abi)
    staker = await deployContract(wallet, UniTradeStaker01, [mockUnitrade.address], { gasLimit: 6721975 })
  })

  // deposit()

  describe("deposit some ether", () => {
    describe("without any ether", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.deposit()).to.be.revertedWith("Nothing to deposit")
      })
    })

    describe("with some ether", () => {
      let receipt: Promise<any>
      const stakeAmount = 1
      const value = 5000

      describe("before any staking", () => {
        it("should fail", async () => {
          await expect(staker.callStatic.deposit({ value })).to.be.revertedWith("Nothing staked")
        })
      })

      describe("after there is at least one stake", () => {
        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
          receipt = staker.stake(stakeAmount)
          await receipt
          receipt = staker.deposit({ value })
          await receipt
        })

        it("emits an event", async () => {
          await expect(receipt).to.emit(staker, "Deposit").withArgs(wallet.address, value)
        })

        it("leaves total stake as expected", async () => {
          expect(await staker.callStatic.totalStake()).to.equal(1)
        })
      })

      describe("after stakes are  withdrawn", () => {
        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
          receipt = staker.stake(stakeAmount)
          await receipt
          receipt = staker.deposit({ value })
          await receipt
          await provider.send("evm_increaseTime", [defaultStakePeriod])
          await provider.send("evm_mine", [])
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount).returns(true)
          receipt = staker.withdraw()
          await receipt
        })

        it("should fail", async () => {
          await expect(staker.connect(wallet2).callStatic.deposit({ value })).to.be.revertedWith("Nothing staked")
        })
      })
    })
  })

  // stake()

  describe("stakes some unitrade", () => {
    describe("without any unitrade", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.stake(0)).to.be.revertedWith("Nothing to stake")
      })
    })

    describe("without transfer approval", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.stake(100)).to.be.revertedWith("TransferHelper: TRANSFER_FROM_FAILED")
      })
    })

    describe("with transfer approval", () => {
      let receipt: Promise<any>
      let currentTimestamp: number
      const stakeAmount = 100

      beforeEach(async () => {
        currentTimestamp = (await provider.getBlock(await provider.getBlockNumber())).timestamp
        await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
        receipt = staker.stake(stakeAmount)
        await receipt
      })

      it("emits an event", async () => {
        await expect(receipt).to.emit(staker, "Stake").withArgs(wallet.address, stakeAmount)
      })

      it("sets the stake timelock", async () => {
        const timelock: BigNumber = await staker.callStatic.timelock(wallet.address)
        expect(timelock.toNumber()).to.be.approximately(currentTimestamp + defaultStakePeriod, 2)
      })

      it("updates the total staked value", async () => {
        expect(await staker.callStatic.totalStake()).to.equal(stakeAmount)
      })

      describe("with additional stakes", () => {
        const extraStakeAmount = 400
        const stakeDelta = 60
        let previousTimelock: BigNumber

        beforeEach(async () => {
          previousTimelock = await staker.callStatic.timelock(wallet.address)
          await provider.send("evm_increaseTime", [stakeDelta])
          await provider.send("evm_mine", [])
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, extraStakeAmount).returns(true)
          await staker.stake(400)
        })

        it("updates the total staked value", async () => {
          expect(await staker.callStatic.totalStake()).to.equal(500)
        })

        it("sets a new stake timelock", async () => {
          expect((await staker.callStatic.timelock(wallet.address)).toNumber())
            .to.be.approximately(currentTimestamp + stakeDelta + defaultStakePeriod, 2).and
            .to.be.greaterThan(previousTimelock.toNumber())
        })
      })
    })
  })

  // withdraw()

  describe("withdraw unitrade", () => {
    describe("without any stake", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.withdraw()).to.be.revertedWith("Nothing staked")
      })
    })

    describe("when there have been no deposits", () => {
      let response: any
      let receipt: Promise<any>

      describe("with a single staker", () => {
        const stakeAmount = 100

        beforeEach(async () => {
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount).returns(true)
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
          receipt = staker.stake(stakeAmount)
          await receipt
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount);
            })

            it("should return no reward", () => {
              expect(response[1]).to.equal(0);
            })
          })

          describe("calling withdraw", () => {
            beforeEach(async () => {
              receipt = staker.withdraw()
              await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount, 0)
            })

            it("leaves the totalStake at 0", async () => {
              expect(await staker.callStatic.totalStake()).to.equal(0)
            })

            it("still results in contract balance being 0", async () => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet.address)).to.equal(0)
            })
          })
        })
      })

      describe("with multiple stakers", () => {
        const stakeAmount1 = 500
        const stakeAmount2 = 1000

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1).returns(true)
          receipt = staker.stake(stakeAmount1)
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount2).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount2)
          await receipt
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount1).returns(true)
          await mockUnitrade.mock.transfer.withArgs(wallet2.address, stakeAmount2).returns(true)
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw for staker 1", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
          describe("attempting to withdraw for staker 2", () => {
            it("should be reverted", async () => {
              await expect(staker.connect(wallet2).callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data for staker 1", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount1);
            })

            it("should return no reward", () => {
              expect(response[1]).to.equal(0);
            })
          })

          describe("getting readonly callstatic data for staker 2", () => {
            beforeEach(async () => {
              response = await staker.connect(wallet2).callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount2);
            })

            it("should return no reward", () => {
              expect(response[1]).to.equal(0);
            })
          })

          describe("calling withdraw for staker 1", () => {
            beforeEach(async () => {
              receipt = staker.withdraw()
              await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount1, 0)
            })

            it("should leave staking contract with staker 2 stake", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount2)
            })

            it("should leave staking contract empty of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet.address)).to.equal(0)
            })
          })

          describe("calling withdraw for staker 2", () => {
            beforeEach(async () => {
              receipt = staker.connect(wallet2).withdraw()
              await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet2.address, stakeAmount2, 0)
            })

            it("should leave staking contract without any remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount1)
            })

            it("should leave staking contract empty of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet2.address)).to.equal(0)
            })
          })

          describe("calling withdraw for all stakers", () => {
            beforeEach(async () => {
              receipt = staker.withdraw()
              await receipt
              receipt = staker.connect(wallet2).withdraw()
              await receipt
            })

            it("should leave staking contract without any remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(0)
            })

            it("should leave staking contract empty of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })
          })
        })
      })
    })

    describe("when there has been deposit after staking", () => {
      let response: any
      let receipt: Promise<any>
      const value = 10000

      describe("with a single staker", () => {
        const stakeAmount = 500
        let balanceBeforeWithdraw: BigNumber
        let balanceAfterWithdraw: BigNumber
        let gasUsed: BigNumber
        let ret: any

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
          receipt = staker.stake(stakeAmount)
          await receipt
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount).returns(true)
          receipt = staker.deposit({ value })
          await receipt
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount);
            })

            it("should return reward", () => {
              expect(response[1]).to.equal(value);
            })
          })

          describe("calling withdraw", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet.address)
              receipt = staker.withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount, value)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(value)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract without any stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(0)
            })

            it("should leave staking contract empty of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet.address)).to.equal(0)
            })
          })
        })
      })

      describe("with multiple stakers", () => {
        const stakeAmount1 = 500
        const stakeAmount2 = 1000
        const reward1 = 3333
        const reward2 = 6666
        let balanceBeforeWithdraw: BigNumber
        let balanceAfterWithdraw: BigNumber
        let gasUsed: BigNumber
        let ret: any

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1).returns(true)
          receipt = staker.stake(stakeAmount1)
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount2).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount2)
          await receipt
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount1).returns(true)
          await mockUnitrade.mock.transfer.withArgs(wallet2.address, stakeAmount2).returns(true)
          receipt = staker.deposit({ value })
          await receipt
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw for staker 1", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
          describe("attempting to withdraw for staker 2", () => {
            it("should be reverted", async () => {
              await expect(staker.connect(wallet2).callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data for staker 1", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount1);
            })

            it("should return 33% of deposits as reward", () => {
              expect(response[1]).to.equal(reward1);
            })
          })

          describe("getting readonly callstatic data for staker 2", () => {
            beforeEach(async () => {
              response = await staker.connect(wallet2).callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount2);
            })

            it("should return 66% of deposits as reward", () => {
              expect(response[1]).to.equal(reward2);
            })
          })

          describe("calling withdraw for staker 1", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet.address)
              receipt = staker.withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount1, reward1)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(reward1)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount2)
            })

            it("should leave staking contract with 66% of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value-reward1)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet.address)).to.equal(0)
            })
          })

          describe("calling withdraw for staker 2", () => {
            let ret: any
            let balanceBeforeWithdraw: BigNumber
            let balanceAfterWithdraw: BigNumber
            let gasUsed: BigNumber

            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet2.address)
              receipt = staker.connect(wallet2).withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet2.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet2.address, stakeAmount2, reward2)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(reward2)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount1)
            })

            it("should leave staking contract with 33% of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value-reward2)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet2.address)).to.equal(0)
            })
          })

          describe("calling withdraw for all stakers", () => {
            beforeEach(async () => {
              receipt = staker.withdraw()
              await receipt
              receipt = staker.connect(wallet2).withdraw()
              await receipt
            })

            it("should leave staking contract without any remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(0)
            })

            it("should leave staking contract empty of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })
          })
        })
      })
    })

    describe("when there has been deposit between staking", () => {
      let response: any
      let receipt: Promise<any>
      const value = 10000

      describe("with multiple stakers", () => {
        const stakeAmount1 = 500
        const stakeAmount2 = 1000
        let balanceBeforeWithdraw: BigNumber
        let balanceAfterWithdraw: BigNumber
        let gasUsed: BigNumber
        let ret: any

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1).returns(true)
          receipt = staker.stake(stakeAmount1)
          await receipt
          receipt = staker.deposit({ value })
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount2).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount2)
          await receipt
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount1).returns(true)
          await mockUnitrade.mock.transfer.withArgs(wallet2.address, stakeAmount2).returns(true)
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw for staker 1", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
          describe("attempting to withdraw for staker 2", () => {
            it("should be reverted", async () => {
              await expect(staker.connect(wallet2).callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data for staker 1", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount1);
            })

            it("should return all of reward", () => {
              expect(response[1]).to.equal(value);
            })
          })

          describe("getting readonly callstatic data for staker 2", () => {
            beforeEach(async () => {
              response = await staker.connect(wallet2).callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount2);
            })

            it("should return no reward", () => {
              expect(response[1]).to.equal(0);
            })
          })

          describe("calling withdraw for staker 1", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet.address)
              receipt = staker.withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount1, value)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(value)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount2)
            })

            it("should leave staking contract empty of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(0)
            })
          })

          describe("calling withdraw for staker 2", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet2.address)
              receipt = staker.connect(wallet2).withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet2.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet2.address, stakeAmount2, 0)
            })

            it("should transfer no reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(0)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount1)
            })

            it("should leave staking contract with all deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value)
            })
          })
        })
      })
    })

    describe("when there has been deposit after staking and first stake is added to", () => {
      let response: any
      let receipt: Promise<any>
      const value = 10000

      describe("with multiple stakers", () => {
        const stakeAmount1a = 500
        const stakeAmount1b = 500
        const stakeAmount2 = 1000
        const reward1 = 3333
        const reward2 = 6666
        let balanceBeforeWithdraw: BigNumber
        let balanceAfterWithdraw: BigNumber
        let gasUsed: BigNumber
        let ret: any

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1a).returns(true)
          receipt = staker.stake(stakeAmount1a)
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount2).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount2)
          await receipt
          receipt = staker.deposit({ value })
          await receipt
          await provider.send("evm_increaseTime", [3])
          await provider.send("evm_mine", [])
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1b).returns(true)
          receipt = staker.stake(stakeAmount1b)
          await receipt
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount1a + stakeAmount1b).returns(true)
          await mockUnitrade.mock.transfer.withArgs(wallet2.address, stakeAmount2).returns(true)
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw for staker 1", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
          describe("attempting to withdraw for staker 2", () => {
            it("should be reverted", async () => {
              await expect(staker.connect(wallet2).callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data for staker 1", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount1a + stakeAmount1b);
            })

            it("should return 33% of deposits as reward", () => {
              expect(response[1]).to.equal(reward1);
            })
          })

          describe("getting readonly callstatic data for staker 2", () => {
            beforeEach(async () => {
              response = await staker.connect(wallet2).callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount2);
            })

            it("should return 66% of deposits as reward", () => {
              expect(response[1]).to.equal(reward2);
            })
          })

          describe("calling withdraw for staker 1", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet.address)
              receipt = staker.withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount1a+stakeAmount1b, reward1)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(reward1)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount2)
            })

            it("should leave staking contract with 66% of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value - reward1)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet.address)).to.equal(0)
            })
          })

          describe("calling withdraw for staker 2", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet2.address)
              receipt = staker.connect(wallet2).withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet2.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet2.address, stakeAmount2, reward2)
            })

            it("should transfer no reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(reward2)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount1a + stakeAmount1b)
            })

            it("should leave staking contract with 33% of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value - reward2)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet2.address)).to.equal(0)
            })
          })
        })
      })
    })

    describe("when there has been deposit after staking with subsequent stakes and deposits", () => {
      let response: any
      let receipt: Promise<any>
      const value1 = 10000
      const value2 = 20000

      describe("with multiple stakers", () => {
        const stakeAmount1a = 500
        const stakeAmount1b = 500
        const stakeAmount2 = 1000
        const reward1 = 13333
        const reward2 = 16666
        let balanceBeforeWithdraw: BigNumber
        let balanceAfterWithdraw: BigNumber
        let gasUsed: BigNumber
        let ret: any

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1a).returns(true)
          receipt = staker.stake(stakeAmount1a)
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount2).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount2)
          await receipt
          receipt = staker.deposit({ value: value1 })
          await receipt
          await provider.send("evm_increaseTime", [3])
          await provider.send("evm_mine", [])
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1b).returns(true)
          receipt = staker.stake(stakeAmount1b)
          await receipt
          receipt = staker.deposit({ value: value2 })
          await receipt
          await mockUnitrade.mock.transfer.withArgs(wallet.address, stakeAmount1a + stakeAmount1b).returns(true)
          await mockUnitrade.mock.transfer.withArgs(wallet2.address, stakeAmount2).returns(true)
        })

        describe("before timelock expires", () => {
          describe("attempting to withdraw for staker 1", () => {
            it("should be reverted", async () => {
              await expect(staker.callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
          describe("attempting to withdraw for staker 2", () => {
            it("should be reverted", async () => {
              await expect(staker.connect(wallet2).callStatic.withdraw()).to.be.revertedWith("Stake is locked")
            })
          })
        })

        describe("after timelock expires", () => {
          beforeEach(async () => {
            await provider.send("evm_increaseTime", [defaultStakePeriod])
            await provider.send("evm_mine", [])
          })

          describe("getting readonly callstatic data for staker 1", () => {
            beforeEach(async () => {
              response = await staker.callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount1a + stakeAmount1b);
            })

            it("should return percentage of deposits as reward", () => {
              expect(response[1]).to.equal(reward1);
            })
          })

          describe("getting readonly callstatic data for staker 2", () => {
            beforeEach(async () => {
              response = await staker.connect(wallet2).callStatic.withdraw()
            })

            it("should return the stake amount", () => {
              expect(response[0]).to.equal(stakeAmount2);
            })

            it("should return percentage deposits as reward", () => {
              expect(response[1]).to.equal(reward2);
            })
          })

          describe("calling withdraw for staker 1", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet.address)
              receipt = staker.withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount1a+stakeAmount1b, reward1)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(reward1)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount2)
            })

            it("should leave staking contract with percentage of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value1+value2-reward1)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet.address)).to.equal(0)
            })
          })

          describe("calling withdraw for staker 2", () => {
            beforeEach(async () => {
              balanceBeforeWithdraw = await provider.getBalance(wallet2.address)
              receipt = staker.connect(wallet2).withdraw()
              ret = await receipt
              gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              balanceAfterWithdraw = await wallet2.getBalance()
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet2.address, stakeAmount2, reward2)
            })

            it("should transfer reward to staker wallet", async () => {
              expect(balanceBeforeWithdraw.sub(gasUsed.mul(ret.gasPrice)).add(reward2)).to.equal(balanceAfterWithdraw)
            })

            it("should leave staking contract with remaining stakes", async() => {
              expect(await staker.callStatic.totalStake()).to.equal(stakeAmount1a + stakeAmount1b)
            })

            it("should leave staking contract with percentage of deposits", async() => {
              expect(await provider.getBalance(staker.address)).to.equal(value1+value2-reward2)
            })

            it("should reset the stake timelock", async () => {
              expect(await staker.callStatic.timelock(wallet2.address)).to.equal(0)
            })
          })
        })
      })
    })
  })

  // payout()

  describe("payout rewards", () => {
    describe("without any stake", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.payout()).to.be.revertedWith("Nothing staked")
      })
    })

    describe("when there have been no deposits", () => {
      let receipt: Promise<any>
      let stakeAmount = 100000

      beforeEach(async () => {
        await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
        receipt = staker.stake(stakeAmount)
        await receipt
      })

      describe("with a single staker", () => {
        it("should fail", async () => {
          await expect(staker.callStatic.payout()).to.be.revertedWith("Nothing to pay out")
        })
      })

      describe("with multiple stakers", () => {
        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount)
          await receipt
        })

        it("should fail", async () => {
          await expect(staker.connect(wallet2).callStatic.payout()).to.be.revertedWith("Nothing to pay out")
        })
      })
    })

    describe("when there has been deposit between stakes", () => {
      let receipt: Promise<any>
      let stakeAmount = 100000
      let value = 200000

      describe("with multiple stakers", () => {
        let ret: any
        let balanceBeforePayout: BigNumber
        let balanceAfterPayout: BigNumber
        let gasUsed: BigNumber

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount).returns(true)
          receipt = staker.stake(stakeAmount)
          await receipt
          receipt = staker.deposit({ value })
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount)
          await receipt
        })

        describe("getting readonly callstatic data for staker 1", () => {
          it("should return the payout amount", async () => {
            expect(await staker.callStatic.payout()).to.equal(value);
          })
        })

        describe("calling payout for staker 1", () => {
          beforeEach(async () => {
            balanceBeforePayout = await provider.getBalance(wallet.address)
            receipt = staker.payout()
            ret = await receipt
            gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
            balanceAfterPayout = await wallet.getBalance()
          })

          it("emits a withdraw event", async () => {
            await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount, value)
          })

          it("emits a stake event", async () => {
            await expect(receipt).to.emit(staker, "Stake").withArgs(wallet.address, stakeAmount)
          })

          it("should transfer reward to staker wallet", async () => {
            expect(balanceBeforePayout.sub(gasUsed.mul(ret.gasPrice)).add(value)).to.equal(balanceAfterPayout)
          })

          it("should leave staking contract with remaining stakes", async() => {
            expect(await staker.callStatic.totalStake()).to.equal(stakeAmount*2)
          })

          it("should leave staking contract with no deposits", async() => {
            expect(await provider.getBalance(staker.address)).to.equal(0)
          })
        })

        describe("trying payout for staker 2 after deposit", () => {
          it("should fail", async () => {
            await expect(staker.connect(wallet2).callStatic.payout()).to.be.revertedWith("Nothing to pay out")
          })
        })
      })
    })

    describe("when there has been deposit after staking with subsequent stakes and deposits", () => {
      let receipt: Promise<any>
      const value1 = 10000
      const value2 = 20000

      describe("with multiple stakers", () => {
        const stakeAmount1a = 500
        const stakeAmount1b = 500
        const stakeAmount2 = 1000
        const reward1 = 13333
        const reward2 = 16666
        let totalStake = stakeAmount1a + stakeAmount1b + stakeAmount2
        let balanceBeforePayout: BigNumber
        let balanceAfterPayout: BigNumber
        let gasUsed: BigNumber
        let previousTimelock: BigNumber
        let ret: any

        beforeEach(async () => {
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1a).returns(true)
          receipt = staker.stake(stakeAmount1a)
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet2.address, staker.address, stakeAmount2).returns(true)
          receipt = staker.connect(wallet2).stake(stakeAmount2)
          await receipt
          receipt = staker.deposit({ value: value1 })
          await receipt
          await mockUnitrade.mock.transferFrom.withArgs(wallet.address, staker.address, stakeAmount1b).returns(true)
          receipt = staker.stake(stakeAmount1b)
          await receipt
          await provider.send("evm_increaseTime", [defaultStakePeriod/2])
          await provider.send("evm_mine", [])
          receipt = staker.deposit({ value: value2 })
          await receipt
        })

        describe("getting readonly callstatic data for staker 1", () => {
          it("should return the reward amount", async () => {
            expect(await staker.callStatic.payout()).to.equal(reward1);
          })
        })

        describe("getting readonly callstatic data for staker 2", () => {
          it("should return the stake amount", async () => {
            expect(await staker.connect(wallet2).callStatic.payout()).to.equal(reward2);
          })
        })

        describe("calling payout for staker 1", () => {
          beforeEach(async () => {
            previousTimelock = await staker.callStatic.timelock(wallet.address)
            balanceBeforePayout = await provider.getBalance(wallet.address)
            receipt = staker.payout()
            ret = await receipt
            gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
            balanceAfterPayout = await provider.getBalance(wallet.address)
          })

          it("emits a Withdraw event", async () => {
            await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet.address, stakeAmount1a+stakeAmount1b, reward1)
          })

          it("emits a Stake event", async () => {
            await expect(receipt).to.emit(staker, "Stake").withArgs(wallet.address, stakeAmount1a+stakeAmount1b)
          })

          it("should transfer reward to staker wallet", async () => {
            expect(balanceBeforePayout.sub(gasUsed.mul(ret.gasPrice)).add(reward1)).to.equal(balanceAfterPayout)
          })

          it("should leave stakes unchanged", async() => {
            expect(await staker.callStatic.totalStake()).to.equal(totalStake)
          })

          it("should leave staking contract with percentage of deposits", async() => {
            expect(await provider.getBalance(staker.address)).to.equal(value1+value2-reward1)
          })

          it("sets a new stake timelock", async () => {
            const blockTimestamp = (await provider.getBlock(await provider.getBlockNumber())).timestamp
            expect((await staker.callStatic.timelock(wallet.address)).toNumber())
              .to.be.approximately(blockTimestamp + defaultStakePeriod, 2).and
              .to.be.greaterThan(previousTimelock.toNumber())
          })

          describe("calling payout again after no subsequent deposit", () => {
            it("should be reverted", async () => {
              await expect(staker.payout()).to.be.revertedWith("Nothing to pay out")
            })
          })
        })

        describe("calling payout with restake for staker 2", () => {
          beforeEach(async () => {
            previousTimelock = await staker.callStatic.timelock(wallet2.address)
            balanceBeforePayout = await provider.getBalance(wallet2.address)
            receipt = staker.connect(wallet2).payout()
            ret = await receipt
            gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
            balanceAfterPayout = await provider.getBalance(wallet2.address)
          })

          it("emits a Withdraw event", async () => {
            await expect(receipt).to.emit(staker, "Withdraw").withArgs(wallet2.address, stakeAmount2, reward2)
          })

          it("emits a Stake event", async () => {
            await expect(receipt).to.emit(staker, "Stake").withArgs(wallet2.address, stakeAmount2)
          })

          it("should transfer reward to staker wallet", async () => {
            expect(balanceBeforePayout.sub(gasUsed.mul(ret.gasPrice)).add(reward2)).to.equal(balanceAfterPayout)
          })

          it("should leave stakes unchanged", async() => {
            expect(await staker.callStatic.totalStake()).to.equal(totalStake)
          })

          it("should leave staking contract with percentage of deposits", async() => {
            expect(await provider.getBalance(staker.address)).to.equal(value1+value2-reward2)
          })

          it("sets a new stake timelock", async () => {
            const blockTimestamp = (await provider.getBlock(await provider.getBlockNumber())).timestamp
            expect((await staker.callStatic.timelock(wallet2.address)).toNumber())
              .to.be.approximately(blockTimestamp + defaultStakePeriod, 2).and
              .to.be.greaterThan(previousTimelock.toNumber())
          })

          describe("calling payout again after no subsequent deposit", () => {
            it("should be reverted", async () => {
              await expect(staker.connect(wallet2).payout()).to.be.revertedWith("Nothing to pay out")
            })
          })
        })
      })
    })
  })
})
