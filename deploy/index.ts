import { Contract, providers, Signer, Wallet } from "ethers"
import { deployContract, deployMockContract } from "ethereum-waffle"
import UniTradeStaker01 from "../build/UniTradeStaker01.json"
import UniTradeIncinerator from "../build/UniTradeIncinerator.json"
import UniTradeOrderBook from "../build/UniTradeOrderBook.json"
import IUniswapV2Router from "../build/IUniswapV2Router02.json"
import IUniswapV2Factory from "../build/IUniswapV2Factory.json"

require("dotenv").config()

const logContractData = (environment: string, name: string, contract: Contract) => {
  console.log("")
  console.log("         !!! DEPLOYED !!!")
  console.log("network:", environment)
  console.log("name:   ", name)
  console.log("tx hash:", contract.deployTransaction.hash)
  console.log("address:", contract.address)
  console.log("")
}

const deployWithSigner = (environment: string, signer: Signer, uniswapRouterAddress: string, unitradeTokenAddress: string) => {
  let unitradeStaker: Contract,
      unitradeIncinerator: Contract

  deployContract(signer, UniTradeStaker01, [unitradeTokenAddress])
    .then((_unitradeStaker: Contract) => {
      unitradeStaker = _unitradeStaker
      logContractData(environment, "UniTradeStaker01", _unitradeStaker)
    })
    .then(() => {
      return deployContract(signer, UniTradeIncinerator, [uniswapRouterAddress, unitradeTokenAddress])
    })
    .then((_unitradeIncinerator: Contract) => {
      unitradeIncinerator = _unitradeIncinerator
      logContractData(environment, "UniTradeIncinerator", _unitradeIncinerator)
    })
    .then(() => {
      return deployContract(signer, UniTradeOrderBook, [
        uniswapRouterAddress, 
        unitradeIncinerator.address, 
        unitradeStaker.address, 
        2, // feeMul
        1000, // feeDiv
        6, // splitMul
        10 // splitDiv
      ])
    })
    .then((_unitradeOrderBook: Contract) => {
      logContractData(environment, "UniTradeOrderBook", _unitradeOrderBook)
    })
    .catch(console.error)
}

const ticker = (environment: string, timeout: number, signer: Signer, uniswapRouterAddress: string) => {
  const unitradeTokenAddress: string = (process.env.UNITRADE_CONTRACT_ADDRESS || "")
  if (!unitradeTokenAddress) throw new Error("set UNITRADE_CONTRACT_ADDRESS")

  console.log("")
  console.log(`in ${environment.toUpperCase()} mode`)
  console.log(`deploying to ${environment.toUpperCase()} blockchain`)
  console.log("")
  console.log("did you remember to recompile?")
  console.log("")
  console.log(`continuing in ${timeout} seconds`)
  console.log("")

  return new Promise(resolve => {
    const tick = setInterval(async () => {
      process.stdout.write(`${timeout}... `);

      timeout--
      if (timeout >= 0) return

      console.log("")
      console.log("")
      clearInterval(tick)

      await deployWithSigner(environment, signer, uniswapRouterAddress, unitradeTokenAddress)
      resolve()
    }, 1000)
  })
}

const publicDeploy = async (envName: string, envPrivateKey: string | undefined, timeout: number) => {
  if (!envPrivateKey) throw new Error(`Set ${envName.toUpperCase()}_DEPLOYMENT_PRIVATE_KEY`)
  const provider: providers.BaseProvider = providers.getDefaultProvider(envName)
  const signer: Signer = new Wallet(envPrivateKey, provider)
  const uniswapRouterAddress: string = (process.env.UNISWAP_V2_ROUTER || "")
  if (!uniswapRouterAddress) throw new Error("set UNISWAP_V2_ROUTER")
  await ticker(envName, timeout, signer, uniswapRouterAddress)
}

const makeUniswapMocks = async (signer: Signer) => {
  const mockUniswapV2Factory: Contract = await deployMockContract(signer, IUniswapV2Factory.abi)
  const mockUniswapV2Router: Contract = await deployMockContract(signer, IUniswapV2Router.abi)
  
  await mockUniswapV2Router.mock.factory.returns(mockUniswapV2Factory.address);
  
  return mockUniswapV2Router.address
}

const deploy = async (args?: string[]) => {
  let timeout: number = parseInt(process.env.DEPLOYMENT_TIMEOUT || "10", 10)
  if (timeout < 0) timeout = 0
  if (args?.includes("--no-wait")) timeout = 0

  if (!args?.includes("public")) {
    const provider: providers.JsonRpcProvider = new providers.JsonRpcProvider(`http://localhost:${process.env.DEVELOPMENT_BLOCKCHAIN_PORT}`)
    const signer: Signer = provider.getSigner()
    const uniswapRouterAddress = await makeUniswapMocks(signer)
    await ticker("development", timeout, signer, uniswapRouterAddress)
  } else {
    let deployed = false

    if (args?.includes("--goerli")) {
      deployed = true
      await publicDeploy("goerli", process.env.GOERLI_DEPLOYMENT_PRIVATE_KEY, timeout)
    }

    if (args?.includes("--ropsten")) {
      deployed = true
      await publicDeploy("ropsten", process.env.ROPSTEN_DEPLOYMENT_PRIVATE_KEY, timeout)
    }

    if (args?.includes("--kovan")) {
      deployed = true
      await publicDeploy("kovan", process.env.KOVAN_DEPLOYMENT_PRIVATE_KEY, timeout)
    }

    if (args?.includes("--rinkeby")) {
      deployed = true
      await publicDeploy("rinkeby", process.env.RINKEBY_DEPLOYMENT_PRIVATE_KEY, timeout)
    }

    if (args?.includes("--mainnet")) {
      deployed = true
      await publicDeploy("mainnet", process.env.MAINNET_DEPLOYMENT_PRIVATE_KEY, 10)
    }

    if (!deployed) {
      console.log("To perform a public deployemnt, pass in one or more public network flags")
      console.log("Options are:")
      console.log("  --goerli")
      console.log("  --ropsten")
      console.log("  --kovan")
      console.log("  --rinkeby")
      console.log("  --mainnet")
    }
  }
}

try {
  deploy(process.argv)
} catch (error) {
  console.error(error)
}

