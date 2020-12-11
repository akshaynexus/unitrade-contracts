# Unitrade

This repository contains the smart contract code and deployment scripts for the UniTrade system.

## Ethereum Mainnet Deployments

### V1

*UniTradeOrderBook*

* `0xce96c75b5b2252efb6d22770c7d7a3567c4c30f1`
* https://etherscan.io/address/0xce96c75b5b2252efb6d22770c7d7a3567c4c30f1#code

*UniTradeStaker00*

* `0x5b32cdda19ea68f8e3a8511455ef39a9d178c5ca`
* https://etherscan.io/address/0x5b32cdda19ea68f8e3a8511455ef39a9d178c5ca#code

### V2

*UniTradeOrderBook*

* `0xC1bF1B4929DA9303773eCEa5E251fDEc22cC6828`
* https://etherscan.io/address/0xC1bF1B4929DA9303773eCEa5E251fDEc22cC6828#code

*UniTradeStaker01*

* `0x6e6a543D755448fc256cfc54EcCEaD4E589477b7`
* https://etherscan.io/address/0x6e6a543D755448fc256cfc54EcCEaD4E589477b7#code

### Shared

*UniTradeIncinerator*

* `0xc54fa7403b020e78828886becd99b6caaa1433cb`
* https://etherscan.io/address/0xc54fa7403b020e78828886becd99b6caaa1433cb#code

## Development and Deployment

To either do local development, or deploy the contracts, you'll need to set some configuration values.

```sh
$ cp .env.example .env
```

Then open up `.env` and edit as you see fit. The default values are fine for local development.

If you're going to be deploying to public blockchain networks (testnets, or mainnet), you need to enter a private key into the corresponding `<NETWORK>_DEPLOYMENT_PRIVATE_KEY` environment variable (starting with `0x`). Make sure this key has some ETH, to pay for the transaction fees!

Next, install the project's dependencies

```sh
$ npm install
```

Finally, you'll need to compile the contracts. Solidity version 0.6.6 is required for compilation. See https://ethereum-waffle.readthedocs.io/en/latest/compilation.html for more information

```sh
$ npm run build
```

Now you're all set up for doing local development or deploying the contracts to a public network.

## Local Development

"Running" the project consists of spinning up a local blockchain and deploying the contracts to that blockchain.

Once you've done that, you'll be able to use any Ethereum wallet to connect to your local blockchain and interact with those contracts.

Starting a local blockchain and deploying the contracts can be completed with a single command

```sh
$ npm run develop
```

In your console output you'll see both the contracts being deployed, their transaction hashes, and their addresses.

## Testing

To run the tests, run

```sh
$ npm run test
```

## Deployment

There is a deployment script which can execute deployments onto your local blockchain, as well as any of the major public blockchains.

If you already have a local blockchain running and it doesn't have the contracts on it yet (aka not started through `npm run develop`), you can deploy the contracts with a simple

```sh
$ npm run deploy
```

To deploy to a public network, you need to pass in a `public` parameter, followed by one or more network flags (eg `--ropsten`).

If you want to skip the countdown timer, you can pass in a `--no-wait` flag (deploying to `--mainnet` has a 10 second timeout which cannot be skipped).

Due to the way that `npm run` scripts work, all parameters and flags need to be preceed with an initial `--` after the `npm run deploy` command.

Some examples:

```sh
$ npm run deploy
  # deploys the contracts to a local blockchain
  # running on the DEVELOPMENT_BLOCKCHAIN_PORT
  $ environment variable

$ npm run deploy -- --no-wait
  # deploys the contracts to a local blockchain and
  # skips the timeout defined in the DEPLOYMENT_TIMEOUT
  # environment variable

$ npm run deploy -- public
  # because no network flags were provided, this will
  # print out some more instructions

$ npm run deploy -- public --goerli
  # deploys contracts to the public goerli network, using
  # the private key defined in the GOERLI_DEPLOYMENT_PRIVATE_KEY
  # environment variable

$ npm run deploy -- public --ropsten --kovan --mainnet
  # deploys contracts to ropsten, kovan, and mainnet, using
  # the private keys from their respective environment variables
```

## Solidfied security audit report

Audit Report prepared by Solidified covering the Unitrade smart contracts
https://github.com/solidified-platform/audits/blob/master/Audit%20Report%20-%20%20Unitrade%20%5B06.10.2020%5D.pdf

## Final notes

Any time you make any changes to the smart contracts, don't forget to re-compile before executing any of the above commands

```sh
$ npm run build
```

If you've got a local development environment running (via `npm run develop`), you'll want to stop and restart that.
