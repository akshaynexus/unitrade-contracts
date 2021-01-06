import { expect, use } from "chai"
import { BigNumber, Contract } from "ethers"
import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"
import UniTradeOrderBook from "../build/UniTradeOrderBook.json"
import IUniTradeStaker from "../build/IUniTradeStaker.json"
import { getUniswapPairAddress } from "./helpers"
import IUniswapV2Factory from "../build/IUniswapV2Factory.json"
import IUniswapV2Router from "../build/IUniswapV2Router02.json"
import TestERC20 from "../build/TestERC20.json"
import TestERC20WithTransferFee from "../build/TestERC20WithTransferFee.json"

use(solidity)

describe("UniTradeOrderBook E2T", () => {
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
  const deadline = "115792089237316195423570985008687907853269984665640564039457584007913129639935"

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

  // eth 2 token scenario

  describe("places an eth order for tokens", () => {
    let ret: any
    let response: any
    let receipt: Promise<any>
    let pairAddress: string
    let params1: any[]

    beforeEach(async () => {
      params1 = [orderType.EthForTokens, testWeth.address, tokenB.address, 1000, 200, 5000]
    })

    describe("places an invalid order", () => {
      it("without an executor fee", async () => {
        await expect(orderBook.callStatic.placeOrder(...params1)).to.be.revertedWith("Transaction value must match offer and fee")
      })

      it("with an executor fee that is not equal to committed eth", async () => {
        await expect(orderBook.callStatic.placeOrder(...params1, { value: 5001 })).to.be.revertedWith("Transaction value must match offer and fee")
      })

      it("with an output token that has no liquidity pool", async () => {
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(zeroAddress)
        await expect(orderBook.callStatic.placeOrder(...params1, { value: 6000 })).to.be.revertedWith("Unavailable pair address")
      })
    })

    // place order

    describe("places a valid order", () => {
      beforeEach(async () => {
        pairAddress = getUniswapPairAddress(params1[1], params1[2])
        await mockUniswapV2Factory.mock.getPair.withArgs(params1[1], params1[2]).returns(pairAddress)
        await tokenA.approve(orderBook.address, params1[3])
      })

      describe("getting readonly callstatic data", () => {
        beforeEach(async () => {
          response = await orderBook.callStatic.placeOrder(...params1, { value: 6000 })
        })

        it("returns expected order id", async () => {
          expect(response).to.equal(0)
        })
      })

      describe("places order", () => {
        beforeEach(async () => {
          receipt = orderBook.placeOrder(...params1, { value: 6000 })
          await receipt
        })

        it("emits an event", async () => {
          await expect(receipt).to.emit(orderBook, "OrderPlaced")
            .withArgs(0, 1, wallet.address, testWeth.address, tokenB.address, 1000, 200, 5000, 6000)
        })

        it("has expected ether balance", async () => {
          expect(await provider.getBalance(orderBook.address)).to.equal(6000)
        })

        it("has expected active orders length", async () => {
          expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
        })

        it("has expected orders length for trader address", async () => {
          expect(await orderBook.callStatic.getOrdersForAddressLength(wallet.address)).to.equal(1)
        })

        it("has expected orders length for pair address", async () => {
          expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress)).to.equal(1)
        })

        it("has expected order id for trader address", async () => {
          expect(await orderBook.callStatic.getOrderIdForAddress(wallet.address, 0)).to.equal(0)
        })

        it("has expected order id for pair address", async () => {
          expect(await orderBook.callStatic.getOrderIdForAddress(pairAddress, 0)).to.equal(0)
        })

        it("has expected order state", async () => {
          response = await orderBook.callStatic.getOrder(0);
          expect(response.orderType).to.equal(1);
          expect(response.maker).to.equal(wallet.address)
          expect(response.tokenIn).to.equal(testWeth.address)
          expect(response.tokenOut).to.equal(tokenB.address)
          expect(response.amountInOffered.toNumber()).to.equal(1000)
          expect(response.amountOutExpected.toNumber()).to.equal(200)
          expect(response.executorFee.toNumber()).to.equal(5000)
          expect(response.totalEthDeposited.toNumber()).to.equal(6000)
          expect(response.orderState).to.equal(0)
          expect(response.deflationary).to.be.false
        })

        // cancel order

        describe("cancels an order", () => {
          describe("without permission", () => {
            it("should be reverted", async () => {
              await expect(orderBook.connect(wallet2).callStatic.cancelOrder(0)).to.be.revertedWith("Permission denied")
            })
          })

          describe("with permission", () => {
            beforeEach(async () => {
              receipt = orderBook.cancelOrder(0)
              await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(orderBook, "OrderCancelled").withArgs(0)
            })

            it("token has correct balance for order book", async () => {
              expect(await tokenA.callStatic.balanceOf(orderBook.address)).to.equal(0)
            })

            it("has expected ether balance", async () => {
              expect(await provider.getBalance(orderBook.address)).to.equal(0)
            })

            it("has expected active orders length", async () => {
              expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
            })

            it("has expected orders length for trader address", async () => {
              expect(await orderBook.callStatic.getOrdersForAddressLength(wallet.address)).to.equal(1)
            })

            it("has expected orders length for pair address", async () => {
              expect(await orderBook.callStatic.getOrdersForAddressLength(pairAddress)).to.equal(1)
            })

            it("has cancelled order state", async () => {
              response = await orderBook.callStatic.getOrder(0);
              expect(response.orderState).to.equal(1)
            })
          })
        })

        // update order

        describe("updates an order", () => {
          describe("without permission", () => {
            it("should be reverted", async () => {
              await expect(orderBook.connect(wallet2).callStatic.updateOrder(0, 2000, 400, 6000)).to.be.revertedWith("Permission denied")
            })
          })

          describe("with insufficient value", () => {
            it("should be reverted", async () => {
              await expect(orderBook.callStatic.updateOrder(0, 2000, 400, 6000, { value: 500 })).to.be.revertedWith("Additional deposit must match")
            })
          })

          describe("with additional deposit", () => {
            beforeEach(async () => {
              receipt = orderBook.updateOrder(0, 2000, 400, 6000, { value: 2000 })
              await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(orderBook, "OrderUpdated").withArgs(0, 2000, 400, 6000)
            })

            it("has expected ether balance", async () => {
              expect(await provider.getBalance(orderBook.address)).to.equal(8000)
            })

            it("has expected active orders length", async () => {
              expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
            })

            it("has expected order state", async () => {
              response = await orderBook.callStatic.getOrder(0);
              expect(response.orderType).to.equal(1);
              expect(response.maker).to.equal(wallet.address)
              expect(response.tokenIn).to.equal(testWeth.address)
              expect(response.tokenOut).to.equal(tokenB.address)
              expect(response.amountInOffered.toNumber()).to.equal(2000)
              expect(response.amountOutExpected.toNumber()).to.equal(400)
              expect(response.executorFee.toNumber()).to.equal(6000)
              expect(response.totalEthDeposited.toNumber()).to.equal(8000)
              expect(response.orderState).to.equal(0)
              expect(response.deflationary).to.be.false
            })
          })

          describe("with refundable amount", () => {
            let tokensBeforeUpdate: BigNumber
            let balanceBeforeUpdate: BigNumber

            beforeEach(async () => {
              tokensBeforeUpdate = await tokenA.callStatic.balanceOf(wallet.address);
              balanceBeforeUpdate = await provider.getBalance(wallet.address)
              receipt = orderBook.updateOrder(0, 500, 100, 3000)
              ret = await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(orderBook, "OrderUpdated").withArgs(0, 500, 100, 3000)
            })

            it("has expected ether balance", async () => {
              expect(await provider.getBalance(orderBook.address)).to.equal(3500)
            })

            it("returns ether to trader", async () => {
              const gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              const balanceAfterUpdate = await provider.getBalance(wallet.address)
              expect(balanceBeforeUpdate.sub(gasUsed.mul(ret.gasPrice)).add(2500)).to.equal(balanceAfterUpdate)
            })

            it("has expected active orders length", async () => {
              expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(1)
            })

            it("has expected order state", async () => {
              response = await orderBook.callStatic.getOrder(0);
              expect(response.orderType).to.equal(1);
              expect(response.maker).to.equal(wallet.address)
              expect(response.tokenIn).to.equal(testWeth.address)
              expect(response.tokenOut).to.equal(tokenB.address)
              expect(response.amountInOffered.toNumber()).to.equal(500)
              expect(response.amountOutExpected.toNumber()).to.equal(100)
              expect(response.executorFee.toNumber()).to.equal(3000)
              expect(response.totalEthDeposited.toNumber()).to.equal(3500)
              expect(response.orderState).to.equal(0)
              expect(response.deflationary).to.be.false
            })
          })
        })

        // execute order

        describe("executes an order", () => {
          let balanceBeforeExecute: BigNumber

          beforeEach(async () => {
            await mockUniswapV2Router.mock.swapExactETHForTokensSupportingFeeOnTransferTokens
              .withArgs(200, [params1[1], params1[2]], wallet.address, deadline).returns()
            balanceBeforeExecute = await provider.getBalance(wallet2.address)
          })

          describe("calling statically", () => {
            it("returns swap amounts", async () => {
              response = await orderBook.connect(wallet2).callStatic.executeOrder(0)
              expect(response[0]).to.equal(990)
              expect(response[1]).to.equal(0/*200*/)
            })
          })

          describe("executing order", () => {
            beforeEach(async () => {
              receipt = orderBook.connect(wallet2).executeOrder(0)
              ret = await receipt
            })

            it("emits an event", async () => {
              await expect(receipt).to.emit(orderBook, "OrderExecuted").withArgs(0, wallet2.address, [990, 0/*200*/], 10)
            })

            it("executor receives ether fee", async() => {
              const gasUsed = (await provider.getTransactionReceipt(ret.hash)).gasUsed
              const balanceAfterExecute = await provider.getBalance(wallet2.address)
              expect(balanceBeforeExecute.sub(gasUsed.mul(ret.gasPrice)).add(5000)).to.equal(balanceAfterExecute)
            })

            it("has expected ether balance", async () => {
              expect(await provider.getBalance(orderBook.address)).to.equal(0)
            })

            it("has expected active orders length", async () => {
              expect(await orderBook.callStatic.getActiveOrdersLength()).to.equal(0)
            })

            it("has expected order state", async () => {
              response = await orderBook.callStatic.getOrder(0);
              expect(response.orderState).to.equal(2)
            })
          })
        })
      })
    })
  })
})
