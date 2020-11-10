pragma solidity ^0.6.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract UniTradeIncinerator {
    using SafeMath for uint256;

    uint256 constant UINT256_MAX = ~uint256(0);
    IUniswapV2Router02 public immutable uniswapV2Router;
    address public immutable unitrade;
    uint256 lastIncinerated;

    event UniTradeToBurn(uint256 etherIn);
    event UniTradeBurned(uint256 etherIn, uint256 tokensBurned);

    constructor(IUniswapV2Router02 _uniswapV2Router, address _unitrade) public {
        uniswapV2Router = _uniswapV2Router;
        unitrade = _unitrade;
        lastIncinerated = block.timestamp;
    }

    function burn() external payable returns (bool) {
        require(msg.value > 0, "Nothing to burn");

        emit UniTradeToBurn(msg.value);

        if (block.timestamp < lastIncinerated + 1 days) {
            return true;
        }

        lastIncinerated = block.timestamp;

        address[] memory _tokenPair = new address[](2);
        _tokenPair[0] = uniswapV2Router.WETH();
        _tokenPair[1] = unitrade;

        uint256[] memory _swapResult = uniswapV2Router.swapExactETHForTokens{
            value: address(this).balance
        }(
            0, // take any
            _tokenPair,
            address(this),
            UINT256_MAX
        );

        emit UniTradeBurned(_swapResult[0], _swapResult[1]);

        return true;
    }
}
