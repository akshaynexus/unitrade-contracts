pragma solidity ^0.6.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IUniTradeStaker.sol";

contract UniTradeStaker00 is IUniTradeStaker, Ownable {
    event Deposit(address indexed depositor, uint256 etherIn);
    event Transfer(address newStaker, uint256 etherOut);

    function deposit() external override payable {
        require(owner() != address(0), "Staker is disabled");
        require(msg.value > 0, "Nothing to deposit");

        emit Deposit(msg.sender, msg.value);
    }

    function transfer(IUniTradeStaker newStaker) external onlyOwner {
        uint256 currentBalance = address(this).balance;

        require(currentBalance > 0, "Nothing to transfer");

        newStaker.deposit{value: currentBalance}();

        emit Transfer(address(newStaker), currentBalance);

        renounceOwnership();
    }
}
