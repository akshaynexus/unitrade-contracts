import { expect, use } from "chai"
import { Contract } from "ethers"
import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"
import UniTradeOrderBook from "../build/UniTradeOrderBook.json"
import UniTradeIncinerator from "../build/UniTradeIncinerator.json"
import IUniTradeStaker from "../build/IUniTradeStaker.json"
import { getUniswapPairAddress } from "./helpers"
import IUniswapV2Factory from "../build/IUniswapV2Factory.json"
import IUniswapV2Router from "../build/IUniswapV2Router02.json"
import IERC20 from "./IERC20.json"
import { ChainId, WETH } from "@uniswap/sdk"

use(solidity)

describe("UniTradeOrderBook", () => {
  const provider = new MockProvider({
    ganacheOptions: { time: new Date(1700000000 * 1000), gasLimit: 12500000 }
  })
  const [wallet, wallet2] = provider.getWallets()
  let mockUniswapV2Factory: Contract
  let mockUniswapV2Router: Contract
  let mockIncinerator: Contract
  let mockStaker: Contract
  let tokenA: Contract
  let tokenB: Contract
  let orderBook: Contract
  let wethAddress: string
  const zeroAddress: string = "0x0000000000000000000000000000000000000000"
  const orderType = { TokensForTokens: 0, EthForTokens: 1, TokensForEth: 2, Invalid: 3 }
  const deadline = "115792089237316195423570985008687907853269984665640564039457584007913129639935"

  beforeEach(async () => {
    const chainId = ChainId.ROPSTEN;
    wethAddress = WETH[chainId].address;
    mockUniswapV2Factory = await deployMockContract(wallet, IUniswapV2Factory.abi)
    mockUniswapV2Router = await deployMockContract(wallet, IUniswapV2Router.abi)
    mockIncinerator = await deployMockContract(wallet, UniTradeIncinerator.abi)
    mockStaker = await deployMockContract(wallet, IUniTradeStaker.abi)
    tokenA = await deployMockContract(wallet, IERC20.abi)
    tokenB = await deployMockContract(wallet, IERC20.abi)
    await mockUniswapV2Router.mock.factory.returns(mockUniswapV2Factory.address)
    await mockUniswapV2Router.mock.WETH.returns(wethAddress)
    orderBook = await deployContract(
      wallet,
      UniTradeOrderBook,
      [mockUniswapV2Router.address, mockIncinerator.address, mockStaker.address, 1, 100, 6, 10],
      { gasLimit: 6721975 }
    )
  })

  // placeOrder() tests

  describe("places a token order for tokens", () => {
    describe("without an executor fee", () => {
      it("should fail", async () => {
        const params1: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Transaction value must match executor fee")
      })
    })

    describe("with an executor fee that is not equal to committed eth", () => {
      it("should fail", async () => {
        const params1: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1001 }]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Transaction value must match executor fee")
      })
    })

    describe("with an output token that has no eth pool", () => {
      it("should fail", async () => {
        const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(zeroAddress)
        await expect(orderBook.callStatic.placeOrder(...params)).to.be.revertedWith("Unavailable pair address")
      })
    })

    describe("sender places and should succeed", () => {
      it("check return is expected Order ID and getters match", async () => {
        const params1: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
        const params2: any[] = [orderType.TokensForTokens, tokenB.address, tokenA.address, 150, 15, 2000, { value: 2000 }]

        const pairAddress1 = getUniswapPairAddress(params1[0], params1[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(pairAddress1)
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], wethAddress).returns(getUniswapPairAddress(params1[0], wethAddress))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)

        const orderId1 = await orderBook.callStatic.placeOrder(...params1)
        expect(orderId1).to.equal(0)
        await orderBook.placeOrder(...params1)
        expect(await provider.getBalance(orderBook.address)).to.equal(1000)

        const pairAddress2 = getUniswapPairAddress(params2[0], params2[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], params2[2]).returns(pairAddress2)
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], wethAddress).returns(getUniswapPairAddress(params2[0], wethAddress))
        await tokenB.mock.transferFrom.withArgs(wallet.address, orderBook.address, 150).returns(true)

        const orderId2 = await orderBook.callStatic.placeOrder(...params2)
        expect(orderId2).to.equal(1)
        await orderBook.placeOrder(...params2);
        expect(await provider.getBalance(orderBook.address)).to.equal(3000)

        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(2)
        expect(await orderBook.callStatic.getOrdersForAddressLength(wallet.address)).to.equal(2)
        expect(await orderBook.callStatic.getOrderIdForAddress(wallet.address, 0)).to.eql(orderId1)
        expect(await orderBook.callStatic.getOrderIdForAddress(wallet.address, 1)).to.eql(orderId2)
        expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress1)).to.equal(1)
        expect(await orderBook.callStatic.getOrderIdForAddress(pairAddress1, 0)).to.eql(orderId1)
        expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress2)).to.equal(1)
        expect(await orderBook.callStatic.getOrderIdForAddress(pairAddress2, 0)).to.eql(orderId2)

        const getOrder1 = await orderBook.getOrder(orderId1)
        expect(getOrder1.orderType).to.equal(0);
        expect(getOrder1.maker).to.equal(wallet.address)
        expect(getOrder1.tokenIn).to.equal(tokenA.address)
        expect(getOrder1.tokenOut).to.equal(tokenB.address)
        expect(getOrder1.amountInOffered.toNumber()).to.equal(100)
        expect(getOrder1.amountOutExpected.toNumber()).to.equal(10)
        expect(getOrder1.executorFee.toNumber()).to.equal(1000)
        expect(getOrder1.totalEthDeposited.toNumber()).to.equal(1000)
        expect(getOrder1.orderState).to.equal(0)

        const getOrder2 = await orderBook.getOrder(orderId2)
        expect(getOrder2.orderType).to.equal(0);
        expect(getOrder2.maker).to.equal(wallet.address)
        expect(getOrder2.tokenIn).to.equal(tokenB.address)
        expect(getOrder2.tokenOut).to.equal(tokenA.address)
        expect(getOrder2.amountInOffered.toNumber()).to.equal(150)
        expect(getOrder2.amountOutExpected.toNumber()).to.equal(15)
        expect(getOrder2.executorFee.toNumber()).to.equal(2000)
        expect(getOrder2.totalEthDeposited.toNumber()).to.equal(2000)
        expect(getOrder2.orderState).to.equal(0)
      })

      it("check OrderPlaced event emitted", async () => {
        const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000]
        const callParams = [...params, { value: 1000 }]
        const pairAddress = getUniswapPairAddress(params[0], params[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await expect(orderBook.placeOrder(...callParams)).to.emit(orderBook, "OrderPlaced")
          .withArgs(0, 0, wallet.address, tokenA.address, tokenB.address, 100, 10, 1000, 1000)
      })
    })
  })

  describe("places an order of tokens for Eth", () => {
    describe("without an executor fee", () => {
      it("should fail", async () => {
        const params1: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 1000, 100, 1111]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Transaction value must match executor fee")
      })
    })

    describe("without an valid Weth", () => {
      it("should fail", async () => {
        const params1: any[] = [orderType.TokensForEth, tokenA.address, zeroAddress, 1000, 100, 1111, { value: 1111 }]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Token out must be WETH")
      })
    })

    describe("sender places and should succeed", () => {
      it("check return is expected Order ID and getters match", async () => {
        const params1: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 1000, 10, 1111, { value: 1111 }]
        const params2: any[] = [orderType.TokensForEth, tokenB.address, wethAddress, 1000, 15, 2222, { value: 2222 }]

        const pairAddress1 = getUniswapPairAddress(params1[1], params1[2])
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(pairAddress1)
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 1000).returns(true)
        const orderId1 = await orderBook.callStatic.placeOrder(...params1)
        expect(orderId1).to.equal(0)
        await orderBook.placeOrder(...params1)
        expect(await provider.getBalance(orderBook.address)).to.equal(1111)

        const pairAddress2 = getUniswapPairAddress(params2[1], params2[2])
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], params2[2]).returns(pairAddress2)
        await tokenB.mock.transferFrom.withArgs(wallet.address, orderBook.address, 1000).returns(true)
        const orderId2 = await orderBook.callStatic.placeOrder(...params2)
        expect(orderId2).to.equal(1)
        await orderBook.placeOrder(...params2)
        expect(await provider.getBalance(orderBook.address)).to.equal(3333)

        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(2)

        const getOrder1 = await orderBook.getOrder(orderId1)
        expect(getOrder1.orderType).to.equal(2)
        expect(getOrder1.maker).to.equal(wallet.address)
        expect(getOrder1.tokenIn).to.equal(tokenA.address)
        expect(getOrder1.tokenOut).to.equal(wethAddress)
        expect(getOrder1.amountInOffered.toNumber()).to.equal(1000)
        expect(getOrder1.amountOutExpected.toNumber()).to.equal(10)
        expect(getOrder1.executorFee.toNumber()).to.equal(1111)
        expect(getOrder1.totalEthDeposited.toNumber()).to.equal(1111)
        expect(getOrder1.orderState).to.equal(0)

        const getOrder2 = await orderBook.getOrder(orderId2)
        expect(getOrder2.orderType).to.equal(2)
        expect(getOrder2.maker).to.equal(wallet.address)
        expect(getOrder2.tokenIn).to.equal(tokenB.address)
        expect(getOrder2.tokenOut).to.equal(wethAddress)
        expect(getOrder2.amountInOffered.toNumber()).to.equal(1000)
        expect(getOrder2.amountOutExpected.toNumber()).to.equal(15)
        expect(getOrder2.executorFee.toNumber()).to.equal(2222)
        expect(getOrder2.totalEthDeposited.toNumber()).to.equal(2222)
        expect(getOrder2.orderState).to.equal(0)
      })

      it("check OrderPlaced event emitted", async () => {
        const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 1000, 10, 1111]
        const callParams = [...params, { value: 1111 }]
        const pairAddress = getUniswapPairAddress(params[0], params[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 1000).returns(true)
        await expect(orderBook.placeOrder(...callParams)).to.emit(orderBook, "OrderPlaced")
          .withArgs(0, 2, wallet.address, tokenA.address, wethAddress, 1000, 10, 1111, 1111)
      })
    })
  })

  describe("places an Eth order for tokens", () => {
    describe("without a sufficient eth amount", () => {
      it("should fail with no value", async () => {
        const params1: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 1000, 10, 1111]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Transaction value must match offer and fee")
      })
      it("should fail with not enough value", async () => {
        const params1: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 10, 1000, 1111, { value: 1111 }]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Transaction value must match offer and fee")
      })
    })

    describe("without an valid Weth", () => {
      it("should fail", async () => {
        const params1: any[] = [orderType.EthForTokens, zeroAddress, tokenA.address, 1000, 100, 1111]
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Token in must be WETH")
      })
    })

    describe("sender places and should succeed", () => {
      it("check return is expected Order ID and getters match", async () => {
        const params1: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 1000, 10, 1111, { value: 2111 }]
        const params2: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 1000, 15, 2222, { value: 3222 }]

        const pairAddress1 = getUniswapPairAddress(params1[1], params1[2]);
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(pairAddress1)
        const orderId1 = await orderBook.callStatic.placeOrder(...params1)
        expect(orderId1).to.equal(0)
        await orderBook.placeOrder(...params1)
        expect(await provider.getBalance(orderBook.address)).to.equal(2111)

        const pairAddress2 = getUniswapPairAddress(params2[1], params2[2]);
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], params2[2]).returns(pairAddress2)
        const orderId2 = await orderBook.callStatic.placeOrder(...params2)
        expect(orderId2).to.equal(1)
        await orderBook.placeOrder(...params2)
        expect(await provider.getBalance(orderBook.address)).to.equal(5333)

        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(2)

        const getOrder1 = await orderBook.getOrder(orderId1)
        expect(getOrder1.orderType).to.equal(1)
        expect(getOrder1.maker).to.equal(wallet.address)
        expect(getOrder1.tokenIn).to.equal(wethAddress)
        expect(getOrder1.tokenOut).to.equal(tokenB.address)
        expect(getOrder1.amountInOffered.toNumber()).to.equal(1000)
        expect(getOrder1.amountOutExpected.toNumber()).to.equal(10)
        expect(getOrder1.executorFee.toNumber()).to.equal(1111)
        expect(getOrder1.totalEthDeposited.toNumber()).to.equal(2111)
        expect(getOrder1.orderState).to.equal(0)

        const getOrder2 = await orderBook.getOrder(orderId2)
        expect(getOrder2.orderType).to.equal(1)
        expect(getOrder2.maker).to.equal(wallet.address)
        expect(getOrder2.tokenIn).to.equal(wethAddress)
        expect(getOrder2.tokenOut).to.equal(tokenA.address)
        expect(getOrder2.amountInOffered.toNumber()).to.equal(1000)
        expect(getOrder2.amountOutExpected.toNumber()).to.equal(15)
        expect(getOrder2.executorFee.toNumber()).to.equal(2222)
        expect(getOrder2.totalEthDeposited.toNumber()).to.equal(3222)
        expect(getOrder2.orderState).to.equal(0)
      })

      it("check OrderPlaced event emitted", async () => {
        const params: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 1111, 10, 1111]
        const callParams = [...params, { value: 2222 }]
        const pairAddress = getUniswapPairAddress(params[1], params[2]);
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await expect(orderBook.placeOrder(...callParams)).to.emit(orderBook, "OrderPlaced")
          .withArgs(0, 1, wallet.address, wethAddress, tokenB.address, 1111, 10, 1111, 2222)
      })
    })
  })

  // executeOrder() tests

  describe("executes a token for tokens order with normal value", () => {
    it("checks order is executed", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 20000, 10000, 1000, { value: 1000 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      const pairAddressWeth = getUniswapPairAddress(params[0], wethAddress)
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(pairAddressWeth)
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 20000).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      await tokenA.mock.approve.withArgs(mockUniswapV2Router.address, 20000).returns(true)
      await mockUniswapV2Router.mock.swapExactTokensForTokens
        .withArgs(19800, 10000, [params[1], params[2]], wallet.address, deadline)
        .returns([19800, 10000])
      await mockUniswapV2Router.mock.swapExactTokensForETH
        .withArgs(200, 0, [params[1], wethAddress], orderBook.address, deadline)
        .returns([200, 100])
      await wallet.sendTransaction({ to: orderBook.address, value: 100 }) //simulate uniswap Eth return
      await mockIncinerator.mock.burn.returns(true) // @todo check Eth value burned
      await mockStaker.mock.deposit.returns()
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [19800, 10000], 100)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(40)
      const getOrder = await orderBook.callStatic.getOrder(0)
      expect(getOrder.orderState).to.equal(2)
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
    })
  })

  describe("executes a token for tokens order with low value", () => {
    it("checks order is executed with no burn", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 200, 100, 1000, { value: 1000 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      const pairAddressWeth = getUniswapPairAddress(params[0], wethAddress)
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(pairAddressWeth)
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 200).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      await tokenA.mock.approve.withArgs(mockUniswapV2Router.address, 200).returns(true)
      await mockUniswapV2Router.mock.swapExactTokensForTokens
        .withArgs(198, 100, [params[1], params[2]], wallet.address, deadline)
        .returns([198, 100])
      await mockUniswapV2Router.mock.swapExactTokensForETH
        .withArgs(2, 0, [params[1], wethAddress], orderBook.address, deadline)
        .returns([2, 1])
      await wallet.sendTransaction({ to: orderBook.address, value: 1 }) //simulate uniswap Eth return
      await mockStaker.mock.deposit.returns()
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [198, 100], 1)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(1)
      const getOrder = await orderBook.callStatic.getOrder(0)
      expect(getOrder.orderState).to.equal(2)
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
    })
  })

  describe("executes a tokens for tokens order with very low value", () => {
    it("should succeed but with 0 fee", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 10, 5, 1000]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      const pairAddressWeth = getUniswapPairAddress(params[0], wethAddress)
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(pairAddressWeth)
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 10).returns(true)
      await orderBook.placeOrder(...params, { value: 1000 })
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      await tokenA.mock.approve.withArgs(mockUniswapV2Router.address, 10).returns(true)
      await mockUniswapV2Router.mock.swapExactTokensForTokens
        .withArgs(10, 5, [params[1], params[2]], wallet.address, deadline)
        .returns([10, 5])
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [10, 5], 0)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(0)
    })
  })

  describe("executes a token for Eth order with normal value", () => {
    it("checks order is executed", async () => {
      const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 20000, 10000, 1000, { value: 1000 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 20000).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      await tokenA.mock.approve.withArgs(mockUniswapV2Router.address, 20000).returns(true)
      await mockUniswapV2Router.mock.swapExactTokensForETH
        .withArgs(20000, 10000, [params[1], params[2]], orderBook.address, deadline)
        .returns([20000, 10000])
      await wallet.sendTransaction({ to: orderBook.address, value: 10000 }) //simulate uniswap Eth return
      await mockIncinerator.mock.burn.returns(true) // @todo check Eth value burned
      await mockStaker.mock.deposit.returns()
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [20000, 10000], 100)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(40)
      const getOrder = await orderBook.callStatic.getOrder(0)
      expect(getOrder.orderState).to.equal(2)
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
    })
  })

  describe("executes a token for Eth order with low value", () => {
    it("checks order is executed with no burn", async () => {
      const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 200, 100, 1000, { value: 1000 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 200).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      await tokenA.mock.approve.withArgs(mockUniswapV2Router.address, 200).returns(true)
      await mockUniswapV2Router.mock.swapExactTokensForETH
        .withArgs(200, 100, [params[1], params[2]], orderBook.address, deadline)
        .returns([200, 100])
      await wallet.sendTransaction({ to: orderBook.address, value: 100 }) //simulate uniswap Eth return
      await mockStaker.mock.deposit.returns()
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [200, 100], 1)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(1)
      const getOrder = await orderBook.callStatic.getOrder(0)
      expect(getOrder.orderState).to.equal(2)
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
    })
  })

  describe("executes a token for Eth order with very low value", () => {
    it("should succeed but with 0 fee", async () => {
      const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 5, 1000]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params, { value: 1000 })
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      await tokenA.mock.approve.withArgs(mockUniswapV2Router.address, 100).returns(true)
      await mockUniswapV2Router.mock.swapExactTokensForETH
        .withArgs(100, 5, [params[1], params[2]], orderBook.address, deadline)
        .returns([100, 5])
      await wallet.sendTransaction({ to: orderBook.address, value: 5 }) //simulate uniswap Eth return
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [100, 5], 0)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(0)
    })
  })

  describe("executes an Eth for tokens order with normal value", () => {
    it("checks order is executed", async () => {
      const params: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 10000, 20000, 1000, { value: 11000 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(11000)

      await mockUniswapV2Router.mock.swapExactETHForTokens
        .withArgs(20000, [params[1], params[2]], wallet.address, deadline)
        .returns([9900, 20000])
      await mockIncinerator.mock.burn.returns(true) // @todo check Eth value burned
      await mockStaker.mock.deposit.returns()
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [9900, 20000], 100)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(40)
      const getOrder = await orderBook.callStatic.getOrder(0)
      expect(getOrder.orderState).to.equal(2)
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
    })
  })

  describe("executes an Eth for tokens order with low value", () => {
    it("checks order is executed with no burn", async () => {
      const params: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 100, 200, 1000, { value: 1100 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1100)

      await mockUniswapV2Router.mock.swapExactETHForTokens
        .withArgs(200, [params[1], params[2]], wallet.address, deadline)
        .returns([99, 200])
      await mockStaker.mock.deposit.returns()
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [99, 200], 1)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(1)
      const getOrder = await orderBook.callStatic.getOrder(0)
      expect(getOrder.orderState).to.equal(2)
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
    })
  })

  describe("executes an Eth for tokens order with very low value", () => {
    it("checks order is executed", async () => {
      const params: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 60, 200, 1000, { value: 1060 }]
      const pairAddress = getUniswapPairAddress(params[0], params[1])
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1060)

      await mockUniswapV2Router.mock.swapExactETHForTokens
        .withArgs(200, [params[1], params[2]], wallet.address, deadline)
        .returns([60, 200])
      await expect(orderBook.connect(wallet2).executeOrder(0)).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [60, 200], 0)
      expect(await provider.getBalance(orderBook.address)).to.equal(0)
      expect(await provider.getBalance(mockStaker.address)).to.equal(0)
    })
  })

  // cancelOrder() tests

  describe("other person cancels an order and should fail", () => {
    it("checks order cancellation is authorized", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)
      await expect(orderBook.connect(wallet2).callStatic.cancelOrder(0)).to.be.revertedWith("Permission denied")
      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
    })
  })

  describe("cancels a tokens for tokens order", () => {
    describe("maker cancels and should succeed", () => {
      it("check orders are empty after cancellation", async () => {
        const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
        const pairAddress = getUniswapPairAddress(params[0], params[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await orderBook.placeOrder(...params)
        expect(await provider.getBalance(orderBook.address)).to.equal(1000)
        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true)
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        await orderBook.cancelOrder(0)
        expect(await provider.getBalance(orderBook.address)).to.equal(0)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
        expect(await orderBook.callStatic.getOrdersForAddressLength(wallet.address)).to.equal(1)
        expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress)).to.equal(1)
      })

      it("check orders are pruned after cancellation", async () => {
        const params1: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
        const params2: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 150, 15, 2000, { value: 2000 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(getUniswapPairAddress(params1[0], params1[1]))
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], wethAddress).returns(getUniswapPairAddress(params1[0], wethAddress))

        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true);
        expect((await orderBook.callStatic.placeOrder(...params1)).toNumber()).to.equal(0)
        await orderBook.placeOrder(...params1)
        expect(await provider.getBalance(orderBook.address)).to.equal(1000)

        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 150).returns(true);
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], params2[2]).returns(getUniswapPairAddress(params2[0], params2[1]))
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], wethAddress).returns(getUniswapPairAddress(params2[0], wethAddress))
        expect((await orderBook.callStatic.placeOrder(...params2)).toNumber()).to.equal(1)
        await orderBook.placeOrder(...params2)
        expect(await provider.getBalance(orderBook.address)).to.equal(3000)

        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true);
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        await orderBook.cancelOrder(0)
        expect(await provider.getBalance(orderBook.address)).to.equal(2000)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
        const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
        expect(getActiveOrder.orderState).to.equal(0)
      })

      it("check OrderCancelled event emitted", async () => {
        const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await orderBook.placeOrder(...params)
        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true)
        await expect(orderBook.cancelOrder(0)).to.emit(orderBook, "OrderCancelled").withArgs(0)
      })

      it("checks that executor fee has been refunded", async () => {
        const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 500, { value: 500 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await orderBook.placeOrder(...params)
        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true)
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        const balanceAfterOrder = await wallet.getBalance()
        const ret = await orderBook.cancelOrder(0)
        const gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
        const balanceAfterCancel = await wallet.getBalance()
        expect(balanceAfterOrder.sub(gasUsed.mul(ret.gasPrice)).add(500)).to.equal(balanceAfterCancel)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
      })
    })
  })

  describe("cancels a tokens for Eth order", () => {
    describe("maker cancels and should succeed", () => {
      it("check orders are empty after cancellation", async () => {
        const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 10, 1000, { value: 1000 }]
        const pairAddress = getUniswapPairAddress(params[0], params[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await orderBook.placeOrder(...params)
        expect(await provider.getBalance(orderBook.address)).to.equal(1000)
        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true)
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        await orderBook.cancelOrder(0)
        expect(await provider.getBalance(orderBook.address)).to.equal(0)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
        expect(await orderBook.callStatic.getOrdersForAddressLength(wallet.address)).to.equal(1)
        expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress)).to.equal(1)
      })

      it("check orders are pruned after cancellation", async () => {
        const params1: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 10, 1000, { value: 1000 }]
        const params2: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 150, 15, 2000, { value: 2000 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(getUniswapPairAddress(params1[0], params1[1]))

        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true);
        expect((await orderBook.callStatic.placeOrder(...params1)).toNumber()).to.equal(0)
        await orderBook.placeOrder(...params1)
        expect(await provider.getBalance(orderBook.address)).to.equal(1000)

        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 150).returns(true);
        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], params2[2]).returns(getUniswapPairAddress(params2[0], params2[1]))
        expect((await orderBook.callStatic.placeOrder(...params2)).toNumber()).to.equal(1)
        await orderBook.placeOrder(...params2)
        expect(await provider.getBalance(orderBook.address)).to.equal(3000)

        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true);
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        await orderBook.cancelOrder(0)
        expect(await provider.getBalance(orderBook.address)).to.equal(2000)

        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
        const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
        expect(getActiveOrder.orderState).to.equal(0)
      })

      it("check OrderCancelled event emitted", async () => {
        const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 10, 1000, { value: 1000 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await orderBook.placeOrder(...params)
        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true)
        await expect(orderBook.cancelOrder(0)).to.emit(orderBook, "OrderCancelled").withArgs(0)
      })

      it("checks that executor fee has been refunded", async () => {
        const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 10, 500, { value: 500 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
        await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
        await orderBook.placeOrder(...params)
        await tokenA.mock.transfer.withArgs(wallet.address, 100).returns(true)
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        const balanceAfterOrder = await wallet.getBalance()
        const ret = await orderBook.cancelOrder(0)
        const gasUsed = (await orderBook.provider.getTransactionReceipt(ret.hash)).gasUsed
        const balanceAfterCancel = await wallet.getBalance()
        expect(balanceAfterOrder.sub(gasUsed.mul(ret.gasPrice)).add(500)).to.equal(balanceAfterCancel)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
      })
    })
  })

  describe("cancels an Eth for tokens order", () => {
    describe("maker cancels and should succeed", () => {
      it("check orders are empty after cancellation", async () => {
        const params: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 1111, 100, 1000, { value: 2111 }]
        const pairAddress = getUniswapPairAddress(params[0], params[1])
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(pairAddress)
        await orderBook.placeOrder(...params)
        expect(await provider.getBalance(orderBook.address)).to.equal(2111)
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        await orderBook.cancelOrder(0)
        expect(await provider.getBalance(orderBook.address)).to.equal(0)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
        expect(await orderBook.callStatic.getOrdersForAddressLength(wallet.address)).to.equal(1)
        expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress)).to.equal(1)
      })

      it("check orders are pruned after cancellation", async () => {
        const params1: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 100, 10, 1000, { value: 1100 }]
        const params2: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 150, 15, 2000, { value: 2150 }]

        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(getUniswapPairAddress(params1[0], params1[1]))
        expect((await orderBook.callStatic.placeOrder(...params1)).toNumber()).to.equal(0)
        await orderBook.placeOrder(...params1)
        expect(await provider.getBalance(orderBook.address)).to.equal(1100)

        await mockUniswapV2Factory.mock.getPair.withArgs(params2[1], params2[2]).returns(getUniswapPairAddress(params2[0], params2[1]))
        expect((await orderBook.callStatic.placeOrder(...params2)).toNumber()).to.equal(1)
        await orderBook.placeOrder(...params2)
        expect(await provider.getBalance(orderBook.address)).to.equal(3250)

        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        await orderBook.cancelOrder(0)
        expect(await provider.getBalance(orderBook.address)).to.equal(2150)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
        const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
        expect(getActiveOrder.orderState).to.equal(0)
      })

      it("check OrderCancelled event emitted", async () => {
        const params: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 100, 10, 1000, { value: 1100 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
        await orderBook.placeOrder(...params)
        await expect(orderBook.cancelOrder(0)).to.emit(orderBook, "OrderCancelled").withArgs(0)
      })

      it("checks that executor fee has been refunded", async () => {
        const params: any[] = [orderType.EthForTokens, wethAddress, tokenA.address, 100, 10, 500, { value: 600 }]
        await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
        await orderBook.placeOrder(...params)
        expect(await orderBook.callStatic.cancelOrder(0)).to.be.true
        const balanceAfterOrder = await wallet.getBalance()
        const ret = await orderBook.cancelOrder(0)
        const gasUsed = (await orderBook.provider.getTransactionReceipt(ret.hash)).gasUsed
        const balanceAfterCancel = await wallet.getBalance()
        expect(balanceAfterOrder.sub(gasUsed.mul(ret.gasPrice)).add(500).add(100)).to.equal(balanceAfterCancel)
        const getOrder = await orderBook.callStatic.getOrder(0)
        expect(getOrder.orderState).to.equal(1)
        expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
      })
    })
  })

  // updateOrder() tests

  describe("other person updates and should fail", () => {
    it("checks order update is authorized", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params)
      await expect(orderBook.connect(wallet2).callStatic.updateOrder(0, 100, 11, 1000)).to.be.revertedWith("Permission denied")
    })
  })

  describe("updates a tokens for tokens order", () => {
    it("succeeds when adding to the amounts and fee", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      const updateParams: any[] = [0, 110, 11, 2000, { value: 1000 }]
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 10).returns(true)
      expect(await orderBook.callStatic.updateOrder(...updateParams)).to.be.true
      await orderBook.updateOrder(...updateParams)
      expect(await provider.getBalance(orderBook.address)).to.equal(2000)

      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
      expect(getActiveOrder.amountInOffered).to.equal(110)
      expect(getActiveOrder.amountOutExpected).to.equal(11)
      expect(getActiveOrder.totalEthDeposited).to.equal(2000)
      expect(getActiveOrder.executorFee).to.equal(2000)
    })

    it("succeeds when reducing the amounts and fee", async () => {
      const params: any[] = [orderType.TokensForTokens, tokenA.address, tokenB.address, 100, 10, 1000, { value: 1000 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], wethAddress).returns(getUniswapPairAddress(params[0], wethAddress))
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      const updateParams: any[] = [0, 90, 9, 500]
      await tokenA.mock.transfer.withArgs(wallet.address, 10).returns(true)
      expect(await orderBook.callStatic.updateOrder(...updateParams)).to.be.true
      await orderBook.updateOrder(...updateParams)
      expect(await provider.getBalance(orderBook.address)).to.equal(500)

      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
      expect(getActiveOrder.amountInOffered).to.equal(90)
      expect(getActiveOrder.amountOutExpected).to.equal(9)
      expect(getActiveOrder.totalEthDeposited).to.equal(500)
      expect(getActiveOrder.executorFee).to.equal(500)
    })
  })

  describe("updates a tokens for Eth order", () => {
    it("succeeds when adding to the amounts and fee", async () => {
      const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 10, 1000, { value: 1000 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      const updateParams: any[] = [0, 110, 11, 2000, { value: 1000 }]
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 10).returns(true)
      expect(await orderBook.callStatic.updateOrder(...updateParams)).to.be.true
      await orderBook.updateOrder(...updateParams)
      expect(await provider.getBalance(orderBook.address)).to.equal(2000)

      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
      expect(getActiveOrder.amountInOffered).to.equal(110)
      expect(getActiveOrder.amountOutExpected).to.equal(11)
      expect(getActiveOrder.totalEthDeposited).to.equal(2000)
      expect(getActiveOrder.executorFee).to.equal(2000)
    })

    it("succeeds when reducing the amounts and fee", async () => {
      const params: any[] = [orderType.TokensForEth, tokenA.address, wethAddress, 100, 10, 1000, { value: 1000 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await tokenA.mock.transferFrom.withArgs(wallet.address, orderBook.address, 100).returns(true)
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1000)

      const updateParams: any[] = [0, 90, 9, 500]
      await tokenA.mock.transfer.withArgs(wallet.address, 10).returns(true)
      expect(await orderBook.callStatic.updateOrder(...updateParams)).to.be.true
      await orderBook.updateOrder(...updateParams)
      expect(await provider.getBalance(orderBook.address)).to.equal(500)

      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
      expect(getActiveOrder.amountInOffered).to.equal(90)
      expect(getActiveOrder.amountOutExpected).to.equal(9)
      expect(getActiveOrder.totalEthDeposited).to.equal(500)
      expect(getActiveOrder.executorFee).to.equal(500)
    })
  })

  describe("updates a Eth for tokens order", () => {
    it("succeeds when adding to the amounts and fee", async () => {
      const params: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 100, 10, 1000, { value: 1100 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1100)

      const updateParams: any[] = [0, 110, 11, 2000, { value: 1010 }]
      expect(await orderBook.callStatic.updateOrder(...updateParams)).to.be.true
      await orderBook.updateOrder(...updateParams)
      expect(await provider.getBalance(orderBook.address)).to.equal(2110)

      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
      expect(getActiveOrder.amountInOffered).to.equal(110)
      expect(getActiveOrder.amountOutExpected).to.equal(11)
      expect(getActiveOrder.totalEthDeposited).to.equal(2110)
      expect(getActiveOrder.executorFee).to.equal(2000)
    })

    it("succeeds when reducing the amounts and fee", async () => {
      const params: any[] = [orderType.EthForTokens, wethAddress, tokenB.address, 100, 10, 1000, { value: 1100 }]
      await mockUniswapV2Factory.mock.getPair.withArgs(params[1], params[2]).returns(getUniswapPairAddress(params[0], params[1]))
      await orderBook.placeOrder(...params)
      expect(await provider.getBalance(orderBook.address)).to.equal(1100)

      const updateParams: any[] = [0, 90, 9, 500]
      expect(await orderBook.callStatic.updateOrder(...updateParams)).to.be.true
      await orderBook.updateOrder(...updateParams)
      expect(await provider.getBalance(orderBook.address)).to.equal(590)

      expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
      const getActiveOrder = await orderBook.getOrder(await orderBook.callStatic.getActiveOrderId(0))
      expect(getActiveOrder.orderState).to.equal(0)
      expect(getActiveOrder.amountInOffered).to.equal(90)
      expect(getActiveOrder.amountOutExpected).to.equal(9)
      expect(getActiveOrder.totalEthDeposited).to.equal(590)
      expect(getActiveOrder.executorFee).to.equal(500)
    })
  })

  // updateStaker()

  describe("upgrades the staker", () => {
    describe("without ownership", () => {
      it("should fail", async () => {
        expect(await orderBook.callStatic.owner()).to.equal(wallet.address)
        expect(await orderBook.callStatic.staker()).to.equal(mockStaker.address)
        await expect(orderBook.connect(wallet2).callStatic.updateStaker(mockStaker.address)).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
    describe("with ownership", () => {
      it("should succeed", async () => {
        const mockStaker2 = await deployMockContract(wallet, IUniTradeStaker.abi)
        expect(await orderBook.callStatic.updateStaker(mockStaker2.address)).to.be.empty
        await expect(orderBook.updateStaker(mockStaker2.address)).to.emit(orderBook, "StakerUpdated").withArgs(mockStaker2.address)
        expect(await orderBook.callStatic.staker()).to.equal(mockStaker2.address)
      })
    })
    describe("with renounced ownership", () => {
      it("should fail", async () => {
        await orderBook.renounceOwnership()
        await expect(orderBook.callStatic.updateStaker(mockStaker.address)).to.be.revertedWith("Ownable: caller is not the owner")
        expect(await orderBook.callStatic.owner()).to.equal(zeroAddress)
      })
    })
  })
})
