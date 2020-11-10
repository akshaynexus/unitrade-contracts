import { expect, use } from "chai"
import { Contract } from "ethers"
import { deployContract, deployMockContract,  MockProvider, solidity } from "ethereum-waffle"
import UniTradeStaker00 from "../build/UniTradeStaker00.json"
import IERC20 from "./IERC20.json"

use(solidity)

describe("UniTradeStaker", () => {
  const baseTimestamp = 1700000000
  const provider = new MockProvider({
    ganacheOptions: { time: new Date(baseTimestamp * 1000) }
  })
  const [wallet, wallet2] = provider.getWallets()
  let staker: Contract
  let newStaker: Contract
  const zeroAddress: string = "0x0000000000000000000000000000000000000000"

  beforeEach(async () => {
    staker = await deployContract(wallet, UniTradeStaker00)
    newStaker = await deployContract(wallet, UniTradeStaker00)
  })

  // deposit()

  describe("deposit some ether", () => {
    const value = 5000

    describe("with 0 amount", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.deposit()).to.be.revertedWith("Nothing to deposit")
      })
    })

    describe("with some amount", () => {
      it("checks new staker has no balance", async () => {
        expect(await provider.getBalance(newStaker.address)).to.equal(0)
      })

      it("should succeed", async () => {
        await expect(staker.deposit({ value: 5000 })).to.emit(staker, "Deposit").withArgs(wallet.address, value)
      })
    })
  })

  // transfer()

  describe("transfer ether to new staker", () => {
    let receipt: Promise<any>
    const value = 5000

    describe("to invalid contract", () => {
      it("should fail", async () => {
        const mockToken = await deployMockContract(wallet, IERC20.abi)
        await expect(staker.callStatic.transfer(mockToken.address)).to.be.revertedWith("")
      })
    })

    describe("when current staker has no balance", () => {
      it("should fail", async () => {
        await expect(staker.callStatic.transfer(newStaker.address)).to.be.revertedWith("Nothing to transfer")
      })
    })

    describe("when current staker has balance", () => {
      beforeEach(async () => {
        receipt = staker.deposit({ value })
        await receipt
      })

      describe("attempt transfer as non-owner", () => {
        it("should fail", async () => {
          await expect(staker.connect(wallet2).callStatic.transfer(newStaker.address)).to.be.revertedWith("Ownable: caller is not the owner")
        })
      })

      describe("transfer all deposits", () => {
        beforeEach(async () => {
          receipt = staker.transfer(newStaker.address)
          await receipt
        })

        it("emits an event", async () => {
          await expect(receipt).to.emit(staker, "Transfer").withArgs(newStaker.address, value)
        })

        it("leaves original staker empty", async () => {
          expect(await provider.getBalance(staker.address)).to.equal(0)
        })

        it("checks new staker has deposited balance", async () => {
          expect(await provider.getBalance(newStaker.address)).to.equal(5000)
        })

        it("checks ownership is renounced", async () => {
          expect(await staker.callStatic.owner()).to.equal(zeroAddress)
        })

        it("checks deposit is disabled", async () => {
          await expect(staker.callStatic.deposit({ value })).to.be.revertedWith("Staker is disabled")
        })
      })
    })
  })
})
