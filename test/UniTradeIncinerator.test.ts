import { expect, use } from "chai"
import { Contract } from "ethers"
import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"
import UniTradeIncinerator from "../build/UniTradeIncinerator.json"
import IUniswapV2Router from "../build/IUniswapV2Router02.json"
import IERC20 from "./IERC20.json"
import { ChainId, WETH } from "@uniswap/sdk"

use(solidity)

describe("UniTradeIncinerator", () => {
  const chainId = ChainId.ROPSTEN
  const baseTimestamp = 1700000000
  const provider = new MockProvider({
    ganacheOptions: { time: new Date(baseTimestamp * 1000) }
  })
  const [wallet] = provider.getWallets()
  let mockUniswapV2Router: Contract
  let mockUnitradeToken: Contract
  let incinerator: Contract
  let wethAddress: string
  const deadline = "115792089237316195423570985008687907853269984665640564039457584007913129639935"

  beforeEach(async () => {
    wethAddress = WETH[chainId].address;
    mockUniswapV2Router = await deployMockContract(wallet, IUniswapV2Router.abi)
    mockUnitradeToken = await deployMockContract(wallet, IERC20.abi)
    await mockUniswapV2Router.mock.WETH.returns(wethAddress)
    incinerator = await deployContract(wallet, UniTradeIncinerator, [mockUniswapV2Router.address, mockUnitradeToken.address])
  })

  describe("burn unitrade tokens", () => {
    describe("with no value", () => {
      it("should fail", async () => {
        await expect(incinerator.callStatic.burn()).to.be.revertedWith("Nothing to burn")
      })
    })

    describe("before 1 day has passed", () => {
      it("check UniTradeToBurn event emitted", async () => {
        await expect(incinerator.burn({ value: 100 })).to.emit(incinerator, "UniTradeToBurn").withArgs(100)
      })
    })

    describe("after 2 days have passed since previous burn", () => {
      let receipt: Promise<any>

      beforeEach(async () => {
        await mockUniswapV2Router.mock.swapExactETHForTokens
          .withArgs(0, [wethAddress, mockUnitradeToken.address], incinerator.address, deadline)
          .returns([1000, 12345])
        const twoDays = 60 * 60 * 24 * 2
        await provider.send("evm_increaseTime", [twoDays])
        await provider.send("evm_mine", [])
        receipt = incinerator.burn({ value: 1000 })
        await receipt
      })

      it("swaps eth for unitrade tokens and emit event", async () => {
        await expect(receipt).to.emit(incinerator, "UniTradeToBurn").withArgs(1000)
      })

      it("swaps eth for unitrade tokens and emit event", async () => {
        await expect(receipt).to.emit(incinerator, "UniTradeBurned").withArgs(1000, 12345)
      })
    })
  })
})
