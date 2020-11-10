pragma solidity ^0.6.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20, Ownable {
    uint256 private _totalSupply = 21000000000000000000000000;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) public {}

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }
}
