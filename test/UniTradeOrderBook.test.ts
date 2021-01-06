import { expect, use } from "chai"
import { BigNumber, Contract } from "ethers"
import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"
import UniTradeOrderBook from "../build/UniTradeOrderBook.json"
import { getUniswapPairAddress } from "./helpers"
import IUniswapV2Factory from "../build/IUniswapV2Factory.json"
import IUniswapV2Router from "../build/IUniswapV2Router02.json"
import TestERC20 from "../build/TestERC20.json"
import TestERC20WithTransferFee from "../build/TestERC20WithTransferFee.json"

use(solidity)

describe("UniTradeOrderBook", () => {
  const provider = new MockProvider({
    ganacheOptions: { time: new Date(1700000000 * 1000), gasLimit: 12500000 }
  })
  const [wallet, wallet2] = provider.getWallets()
  let mockUniswapV2Factory: Contract
  let mockUniswapV2Router: Contract
  let testWeth: Contract
  let tokenA: Contract
  let tokenB: Contract
  let tokenC: Contract
  let orderBook: Contract
  const zeroAddress: string = "0x0000000000000000000000000000000000000000"
  const orderType = { TokensForTokens: 0, EthForTokens: 1, TokensForEth: 2, Invalid: 3 }

  beforeEach(async () => {
    mockUniswapV2Factory = await deployMockContract(wallet, IUniswapV2Factory.abi)
    mockUniswapV2Router = await deployMockContract(wallet, IUniswapV2Router.abi)
    testWeth = await deployContract(wallet, TestERC20, ["WETH", "WETH"])
    tokenA = await deployContract(wallet, TestERC20, ["TokenA", "TKA"])
    await tokenA.mint(wallet.address, 100000000000)
    tokenB = await deployContract(wallet, TestERC20, ["TokenB", "TKB"])
    await tokenB.mint(wallet.address, 100000000000)
    tokenC = await deployContract(wallet, TestERC20WithTransferFee, ["TokenC", "TKC"])
    await tokenC.mint(wallet.address, 100000000000)
    await mockUniswapV2Router.mock.factory.returns(mockUniswapV2Factory.address)
    await mockUniswapV2Router.mock.WETH.returns(testWeth.address)
    orderBook = await deployContract(
      wallet,
      UniTradeOrderBook,
      [mockUniswapV2Router.address, 1, 100, 6, 10, zeroAddress],
      { gasLimit: 6721975 }
    )
  })

  // ownership test
  describe("renounce ownership", () => {
    it("has owner", async () => {
      expect(await orderBook.callStatic.owner()).to.equal(wallet.address)
    })

    it("without ownership", async () => {
      await expect(orderBook.connect(wallet2).callStatic.renounceOwnership()).to.be.revertedWith("Ownable: caller is not the owner");
    })

    it("renounced ownership", async () => {
      await orderBook.renounceOwnership()
      expect(await orderBook.callStatic.owner()).to.equal(zeroAddress)
    })
  })

  // getOrder() tests

  describe("get order data", () => {
    let response: any
    let params: any[]

    describe("for invalid order", () => {
      it("should be reverted", async () => {
        await expect(orderBook.callStatic.getOrder(0)).to.be.revertedWith("Order not found");
      })
    })

    describe("for valid order", () => {
      beforeEach(async () => {
        params = [orderType.TokensForTokens, tokenA.address, tokenB.address, 1000, 200, 5000]
        const pairAddress = getUniswapPairAddress(params[1], params[2])
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], testWeth.address).returns(getUniswapPairAddress(params[1], testWeth.address))
        await tokenA.approve(orderBook.address, params[3])
        await orderBook.placeOrder(...params, { value: params[5] })
        response = await orderBook.callStatic.getOrder(0)
      })

      it("has expected order structure", async () => {
        expect(response.orderType).to.equal(params[0]);
        expect(response.maker).to.equal(wallet.address)
        expect(response.tokenIn).to.equal(params[1])
        expect(response.tokenOut).to.equal(params[2])
        expect(response.amountInOffered.toNumber()).to.equal(params[3])
        expect(response.amountOutExpected.toNumber()).to.equal(params[4])
        expect(response.executorFee.toNumber()).to.equal(params[5])
        expect(response.totalEthDeposited.toNumber()).to.equal(params[5])
        expect(response.orderState).to.equal(0)
        expect(response.deflationary).to.be.false
      })
    })
  })

  // fee values tests

  describe("updates the fee", () => {
    it("without ownership", async () => {
      await expect(orderBook.connect(wallet2).callStatic.updateFee(1, 500)).to.be.revertedWith("Ownable: caller is not the owner")
    })

    it("with ownership", async () => {
      expect(await orderBook.callStatic.updateFee(1, 500)).to.be.empty
    })

    it("with renounced ownership", async () => {
      await orderBook.renounceOwnership()
      await expect(orderBook.callStatic.updateFee(1, 500)).to.be.revertedWith("Ownable: caller is not the owner")
    })
  })

  describe("updates the burn/stake split", () => {
    it("without ownership", async () => {
      await expect(orderBook.connect(wallet2).callStatic.updateSplit(1, 2)).to.be.revertedWith("Ownable: caller is not the owner")
    })

    it("with ownership", async () => {
      expect(await orderBook.callStatic.updateSplit(1, 2)).to.be.empty
    })

    it("with renounced ownership", async () => {
      await orderBook.renounceOwnership()
      await expect(orderBook.callStatic.updateSplit(1, 2)).to.be.revertedWith("Ownable: caller is not the owner")
    })
  })
})
