pragma solidity ^0.6.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./IUniTradeStaker.sol";

contract UniTradeStaker01 is IUniTradeStaker, ReentrancyGuard {
    using SafeMath for uint256;

    address immutable unitrade;

    uint256 constant DEFAULT_STAKE_PERIOD = 30 days;
    uint256 public totalStake;
    uint256 totalWeight;
    uint256 public totalEthReceived;
    mapping(address => uint256) public staked;
    mapping(address => uint256) public timelock;
    mapping(address => uint256) weighted;
    mapping(address => uint256) accumulated;

    event Stake(address indexed staker, uint256 unitradeIn);
    event Withdraw(address indexed staker, uint256 unitradeOut, uint256 reward);
    event Deposit(address indexed depositor, uint256 amount);

    constructor(address _unitrade) public {
        unitrade = _unitrade;
    }

    function stake(uint256 unitradeIn) nonReentrant public {
        require(unitradeIn > 0, "Nothing to stake");

        _stake(unitradeIn);
        timelock[msg.sender] = block.timestamp.add(DEFAULT_STAKE_PERIOD);

        TransferHelper.safeTransferFrom(
            unitrade,
            msg.sender,
            address(this),
            unitradeIn
        );
    }

    function withdraw() nonReentrant public returns (uint256 unitradeOut, uint256 reward) {
        require(block.timestamp >= timelock[msg.sender], "Stake is locked");

        (unitradeOut, reward) = _applyReward();
        emit Withdraw(msg.sender, unitradeOut, reward);

        timelock[msg.sender] = 0;

        TransferHelper.safeTransfer(unitrade, msg.sender, unitradeOut);
        if (reward > 0) {
            TransferHelper.safeTransferETH(msg.sender, reward);
        }
    }

    function payout() nonReentrant public returns (uint256 reward) {
        (uint256 unitradeOut, uint256 _reward) = _applyReward();
        emit Withdraw(msg.sender, unitradeOut, _reward);
        reward = _reward;

        require(reward > 0, "Nothing to pay out");
        TransferHelper.safeTransferETH(msg.sender, reward);

        // restake after withdrawal
        _stake(unitradeOut);
        timelock[msg.sender] = block.timestamp.add(DEFAULT_STAKE_PERIOD);
    }

    function deposit() nonReentrant public override payable {
        require(msg.value > 0, "Nothing to deposit");
        require(totalStake > 0, "Nothing staked");

        totalEthReceived = totalEthReceived.add(msg.value);

        emit Deposit(msg.sender, msg.value);

        _distribute(msg.value, totalStake);
    }

    function _stake(uint256 unitradeIn) private {
        uint256 addBack;
        if (staked[msg.sender] > 0) {
            (uint256 unitradeOut, uint256 reward) = _applyReward();
            addBack = unitradeOut;
            accumulated[msg.sender] = reward;
            staked[msg.sender] = unitradeOut;
        }

        staked[msg.sender] = staked[msg.sender].add(unitradeIn);
        weighted[msg.sender] = totalWeight;
        totalStake = totalStake.add(unitradeIn);

        if (addBack > 0) {
            totalStake = totalStake.add(addBack);
        }

        emit Stake(msg.sender, unitradeIn);
    }

    function _applyReward() private returns (uint256 unitradeOut, uint256 reward) {
        require(staked[msg.sender] > 0, "Nothing staked");

        unitradeOut = staked[msg.sender];
        reward = unitradeOut
            .mul(totalWeight.sub(weighted[msg.sender]))
            .div(10**18)
            .add(accumulated[msg.sender]);
        totalStake = totalStake.sub(unitradeOut);
        accumulated[msg.sender] = 0;
        staked[msg.sender] = 0;
    }

    function _distribute(uint256 _value, uint256 _totalStake) private {
        totalWeight = totalWeight.add(_value.mul(10**18).div(_totalStake));
    }
}
