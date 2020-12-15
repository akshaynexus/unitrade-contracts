import { expect, use } from "chai"
import { BigNumber, Contract, ethers } from "ethers"
import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"
import UniTradeOrderBook from "../build/UniTradeOrderBook.json"
import UniTradeMarketOrders from "../build/UniTradeMarketOrders.json"
import UniTradeIncinerator from "../build/UniTradeIncinerator.json"
import IUniTradeStaker from "../build/IUniTradeStaker.json"
import { getUniswapPairAddress } from "./helpers"
import IUniswapV2Factory from "../build/IUniswapV2Factory.json"
import IUniswapV2Router from "../build/IUniswapV2Router02.json"
import TestERC20 from "../build/TestERC20.json"
import TestERC20WithTransferFee from "../build/TestERC20WithTransferFee.json"

use(solidity)

describe("UniTradeMarketOrders", () => {
  const provider = new MockProvider({
    ganacheOptions: {
      time: new Date(1700000000 * 1000),
      gasLimit: 12500000,
    },
  })
  const [wallet] = provider.getWallets()
  let mockUniswapV2Factory: Contract
  let mockUniswapV2Router: Contract
  let mockIncinerator: Contract
  let mockStaker: Contract
  let weth: Contract
  let standardTokenA: Contract
  let standardTokenB: Contract
  let withFeeToken: Contract
  let orderBook: Contract
  let marketOrders: Contract
  const orderType = {
    TokensForTokens: 0,
    EthForTokens: 1,
    TokensForEth: 2,
    Invalid: 3,
  }
  const deadline = ethers.constants.MaxUint256

  beforeEach("setup contracts", async () => {
    weth = await deployContract(wallet, TestERC20, ["WETH", "WETH"])

    standardTokenA = await deployContract(wallet, TestERC20, ["TokenA", "TKA"])
    await standardTokenA.mint(wallet.address, 100000000000)

    standardTokenB = await deployContract(wallet, TestERC20, ["TokenB", "TKB"])
    await standardTokenB.mint(wallet.address, 100000000000)

    withFeeToken = await deployContract(wallet, TestERC20WithTransferFee, ["TokenC", "TKC"])
    await withFeeToken.mint(wallet.address, 100000000000)

    mockUniswapV2Factory = await deployMockContract(wallet, IUniswapV2Factory.abi)

    mockUniswapV2Router = await deployMockContract(wallet, IUniswapV2Router.abi)
    await mockUniswapV2Router.mock.factory.returns(mockUniswapV2Factory.address)
    await mockUniswapV2Router.mock.WETH.returns(weth.address)

    mockIncinerator = await deployMockContract(wallet, UniTradeIncinerator.abi)
    await mockIncinerator.mock.burn.returns(true)

    mockStaker = await deployMockContract(wallet, IUniTradeStaker.abi)
    await mockStaker.mock.deposit.returns()

    orderBook = await deployContract(
      wallet,
      UniTradeOrderBook,
      [mockUniswapV2Router.address, mockIncinerator.address, mockStaker.address, 1, 100, 6, 10],
      { gasLimit: 6721975 }
    )

    marketOrders = await deployContract(wallet, UniTradeMarketOrders, [orderBook.address])
  })

  describe("ETH->TOKEN - standard token", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.EthForTokens, weth.address, standardTokenA.address, 1000, 200]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, tokenOut)

      await mockUniswapV2Factory.mock.getPair.withArgs(tokenIn, tokenOut).returns(pairAddress)

      await mockUniswapV2Router.mock.swapExactETHForTokensSupportingFeeOnTransferTokens
        .withArgs(amountOutExpected, [tokenIn, tokenOut], wallet.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams, { value: orderParams[3] })
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead of 200 because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 200 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams, { value: amountInOffered })

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead of 200 because mock contract doesn't transfer funds
        .withArgs(wallet.address, tokenIn, tokenOut, [990, 0 /* 200 */], 10)

      expect(await provider.getBalance(mockIncinerator.address)).to.equal(6)
      expect(await provider.getBalance(mockStaker.address)).to.equal(4)
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("ETH->TOKEN - token with fee", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.EthForTokens, weth.address, withFeeToken.address, 1000, 200]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, tokenOut)

      await mockUniswapV2Factory.mock.getPair.withArgs(tokenIn, tokenOut).returns(pairAddress)

      await mockUniswapV2Router.mock.swapExactETHForTokensSupportingFeeOnTransferTokens
        .withArgs(amountOutExpected, [tokenIn, tokenOut], wallet.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams, { value: orderParams[3] })
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead of 200 because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 198 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams, { value: amountInOffered })

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead of 200 because mock contract doesn't transfer funds
        .withArgs(wallet.address, tokenIn, tokenOut, [990, 0 /* 198 */], 10)

      expect(await provider.getBalance(mockIncinerator.address)).to.equal(6)
      expect(await provider.getBalance(mockStaker.address)).to.equal(4)
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->ETH - standard token", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForEth, standardTokenA.address, weth.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, tokenOut)
      await mockUniswapV2Factory.mock.getPair.withArgs(tokenIn, tokenOut).returns(pairAddress)

      await standardTokenA.approve(marketOrders.address, amountInOffered)

      await mockUniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(amountInOffered, amountOutExpected, [tokenIn, tokenOut], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(1000)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(wallet.address, tokenIn, tokenOut, [1000, 0 /* 2000 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->ETH - token with fee", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForEth, withFeeToken.address, weth.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, tokenOut)
      await mockUniswapV2Factory.mock.getPair.withArgs(tokenIn, tokenOut).returns(pairAddress)

      await withFeeToken.approve(marketOrders.address, amountInOffered)

      await mockUniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(990, amountOutExpected, [tokenIn, tokenOut], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(wallet.address, tokenIn, tokenOut, [990, 0 /* 2000 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->TOKEN - standard token", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForTokens, standardTokenA.address, standardTokenB.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, weth.address)
      await mockUniswapV2Factory.mock.getPair.withArgs(tokenIn, weth.address).returns(pairAddress)

      await standardTokenA.approve(marketOrders.address, amountInOffered)

      await mockUniswapV2Router.mock.swapExactTokensForTokensSupportingFeeOnTransferTokens
        .withArgs(990, amountOutExpected, [tokenIn, tokenOut], wallet.address, deadline)
        .returns()

      await mockUniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(10, 0, [tokenIn, weth.address], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(wallet.address, tokenIn, tokenOut, [990, 0 /* 200 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->TOKEN - token with fee", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForTokens, withFeeToken.address, standardTokenB.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, weth.address)
      await mockUniswapV2Factory.mock.getPair.withArgs(tokenIn, weth.address).returns(pairAddress)

      await withFeeToken.approve(marketOrders.address, amountInOffered)

      await mockUniswapV2Router.mock.swapExactTokensForTokensSupportingFeeOnTransferTokens
        .withArgs(981, amountOutExpected, [tokenIn, tokenOut], wallet.address, deadline)
        .returns()

      await mockUniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(9, 0, [tokenIn, weth.address], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(981)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(wallet.address, tokenIn, tokenOut, [981, 0 /* 200 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })
})
