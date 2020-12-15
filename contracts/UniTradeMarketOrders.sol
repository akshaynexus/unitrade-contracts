pragma solidity ^0.6.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./UniTradeIncinerator.sol";
import "./IUniTradeStaker.sol";
import "./UniTradeOrderBook.sol";


contract UniTradeMarketOrders is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    uint256 constant UINT256_MAX = ~uint256(0);
    IUniswapV2Router02 public immutable uniswapV2Router;
    IUniswapV2Factory public immutable uniswapV2Factory;
    UniTradeOrderBook public immutable orderBook;

    enum OrderType {TokensForTokens, EthForTokens, TokensForEth}

    event OrderExecuted(
        address indexed taker,
        address tokenIn,
        address tokenOut,
        uint256[] amounts,
        uint256 unitradeFee
    );

    constructor(
        UniTradeOrderBook _orderBook
    ) public {
        uniswapV2Router = _orderBook.uniswapV2Router();
        uniswapV2Factory = _orderBook.uniswapV2Factory();
        orderBook = _orderBook;
    }

    receive() external payable {} // to receive ETH from Uniswap

    function executeOrder(
        OrderType orderType,
        address tokenIn,
        address tokenOut,
        uint256 amountInOffered,
        uint256 amountOutExpected
    )
        external
        payable
        nonReentrant
        returns (uint256[] memory amounts)
    {       
        address _taker = msg.sender;
        address _wethAddress = uniswapV2Router.WETH();

        if (orderType != OrderType.EthForTokens) {
            if (orderType == OrderType.TokensForEth) {
                require(tokenOut == _wethAddress, "Token out must be WETH");
            } else {
                // check if pair exists
                getPair(tokenIn, _wethAddress);
            }
            uint256 beforeBalance = IERC20(tokenIn).balanceOf(address(this));
            // transfer tokenIn funds in necessary for order execution
            TransferHelper.safeTransferFrom(
                tokenIn,
                msg.sender,
                address(this),
                amountInOffered
            );
            uint256 afterBalance = IERC20(tokenIn).balanceOf(address(this));
            if (afterBalance.sub(beforeBalance) != amountInOffered) {
                amountInOffered = afterBalance.sub(beforeBalance);
            }
            require(amountInOffered > 0, "Invalid final offered amount");
        } else {
            require(tokenIn == _wethAddress, "Token in must be WETH");
        }
        
        address[] memory _addressPair = createPair(tokenIn, tokenOut);
        uint256 unitradeFee = 0;

        if (orderType != OrderType.EthForTokens) {
            TransferHelper.safeApprove(
                tokenIn,
                address(uniswapV2Router),
                amountInOffered
            );
        }

        if (orderType == OrderType.TokensForTokens) {
            // Note: Collects fee from input token then swap for ETH
            uint256 _tokenFee = amountInOffered.mul(orderBook.feeMul()).div(orderBook.feeDiv());

            uint256 beforeBalance = IERC20(tokenOut).balanceOf(_taker);
            uniswapV2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountInOffered.sub(_tokenFee),
                amountOutExpected,
                _addressPair,
                _taker,
                UINT256_MAX
            );
            uint256 afterBalance = IERC20(tokenOut).balanceOf(_taker);
            amounts = new uint256[](2);
            amounts[0] = amountInOffered.sub(_tokenFee);
            amounts[1] = afterBalance.sub(beforeBalance);

            if (_tokenFee > 0) {
                address[] memory _wethPair = createPair(tokenIn, uniswapV2Router.WETH());

                uint256 beforeBalance = IERC20(uniswapV2Router.WETH()).balanceOf(address(this));
                uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                    _tokenFee,
                    0, // take any
                    _wethPair,
                    address(this),
                    UINT256_MAX
                );
                uint256 afterBalance = IERC20(uniswapV2Router.WETH()).balanceOf(address(this));
                unitradeFee = afterBalance.sub(beforeBalance);
            }
        } else if (orderType == OrderType.TokensForEth) {
            uint256 beforeBalance = address(this).balance;
            uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                amountInOffered,
                amountOutExpected,
                _addressPair,
                address(this),
                UINT256_MAX
            );
            uint256 afterBalance = address(this).balance;
            amounts = new uint256[](2);
            amounts[0] = amountInOffered;
            amounts[1] = afterBalance.sub(beforeBalance);

            // Note: Collects ETH fee from output
            unitradeFee = amounts[1].mul(orderBook.feeMul()).div(orderBook.feeDiv());

            if (amounts[1].sub(unitradeFee) > 0) {
                // Transfer `output - fee` to the taker
                TransferHelper.safeTransferETH(
                    _taker,
                    amounts[1].sub(unitradeFee)
                );
            }
        } else if (orderType == OrderType.EthForTokens) {
            uint256 totalEthDeposited = msg.value;

            // Note: Collects ETH fee from input
            unitradeFee = totalEthDeposited.mul(orderBook.feeMul()).div(orderBook.feeDiv());

            uint256 beforeBalance = IERC20(tokenOut).balanceOf(_taker);
            uniswapV2Router.swapExactETHForTokensSupportingFeeOnTransferTokens{
                value: totalEthDeposited.sub(unitradeFee)
            }(
                amountOutExpected,
                _addressPair,
                _taker,
                UINT256_MAX
            );
            uint256 afterBalance = IERC20(tokenOut).balanceOf(_taker);
            amounts = new uint256[](2);
            amounts[0] = totalEthDeposited.sub(unitradeFee);
            amounts[1] = afterBalance.sub(beforeBalance);
        }

        // Transfer fee to incinerator/staker
        if (unitradeFee > 0) {
            uint256 burnAmount = unitradeFee.mul(orderBook.splitMul()).div(orderBook.splitDiv());
            if (burnAmount > 0) {
                orderBook.incinerator().burn{value: burnAmount}(); //no require
            }
            orderBook.staker().deposit{value: unitradeFee.sub(burnAmount)}(); //no require
        }

        emit OrderExecuted(_taker, tokenIn, tokenOut, amounts, unitradeFee);
    }

    function createPair(address tokenA, address tokenB)
        internal
        pure
        returns (address[] memory)
    {
        address[] memory _addressPair = new address[](2);
        _addressPair[0] = tokenA;
        _addressPair[1] = tokenB;
        return _addressPair;
    }

    function getPair(address tokenA, address tokenB)
        internal
        view
        returns (address)
    {
        address _pairAddress = uniswapV2Factory.getPair(tokenA, tokenB);
        require(_pairAddress != address(0), "Unavailable pair address");
        return _pairAddress;
    }   
}