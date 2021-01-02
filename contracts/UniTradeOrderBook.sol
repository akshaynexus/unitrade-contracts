pragma solidity ^0.6.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

contract UniTradeOrderBook is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    uint256 constant UINT256_MAX = ~uint256(0);
    IUniswapV2Router02 public immutable uniswapV2Router;
    IUniswapV2Factory public immutable uniswapV2Factory;
    uint16 public feeMul;
    uint16 public feeDiv;
    uint16 public splitMul;
    uint16 public splitDiv;
    IERC20 public ETHToken;
    address public FeeReceiver;
    uint256 stakerFeesETH = 0;
    uint256 incineratorFeesETH = 0;

    enum OrderType {TokensForTokens, EthForTokens, TokensForEth}
    enum OrderState {Placed, Cancelled, Executed}

    struct Order {
        OrderType orderType;
        address payable maker;
        address tokenIn;
        address tokenOut;
        uint256 amountInOffered;
        uint256 amountOutExpected;
        uint256 executorFee;
        uint256 totalEthDeposited;
        uint256 activeOrderIndex;
        OrderState orderState;
        bool deflationary;
    }

    uint256 private orderNumber;
    uint256[] private activeOrders;
    mapping(uint256 => Order) private orders;
    mapping(address => uint256[]) private ordersForAddress;

    event OrderPlaced(
        uint256 indexed orderId,
        OrderType orderType,
        address payable indexed maker,
        address tokenIn,
        address tokenOut,
        uint256 amountInOffered,
        uint256 amountOutExpected,
        uint256 executorFee,
        uint256 totalEthDeposited
    );
    event OrderUpdated(
        uint256 indexed orderId,
        uint256 amountInOffered,
        uint256 amountOutExpected,
        uint256 executorFee
    );
    event OrderCancelled(uint256 indexed orderId);
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed executor,
        uint256[] amounts,
        uint256 unitradeFee
    );
    event StakerUpdated(address newStaker);

    modifier exists(uint256 orderId) {
        require(orders[orderId].maker != address(0), "Order not found");
        _;
    }

    constructor(
        IUniswapV2Router02 _uniswapV2Router,

        uint16 _feeMul,
        uint16 _feeDiv,
        uint16 _splitMul,
        uint16 _splitDiv,
        address _ethToken
    ) public {
        uniswapV2Router = _uniswapV2Router;
        uniswapV2Factory = IUniswapV2Factory(_uniswapV2Router.factory());
        feeMul = _feeMul;
        feeDiv = _feeDiv;
        splitMul = _splitMul;
        splitDiv = _splitDiv;
        FeeReceiver = msg.sender;
        ETHToken = IERC20(_ethToken);
    }

    function setFeeReceiver(address newFeeGetter) public onlyOwner {
        FeeReceiver = newFeeGetter;
    }

    function placeOrder(
        OrderType orderType,
        address tokenIn,
        address tokenOut,
        uint256 amountInOffered,
        uint256 amountOutExpected,
        uint256 executorFee
    ) external payable nonReentrant returns (uint256) {
        require(amountInOffered > 0, "Invalid offered amount");
        require(amountOutExpected > 0, "Invalid expected amount");
        require(executorFee > 0, "Invalid executor fee");

        address _wethAddress = uniswapV2Router.WETH();
        bool deflationary = false;

        if (orderType != OrderType.EthForTokens) {
            require(
                msg.value == executorFee,
                "Transaction value must match executor fee"
            );
            if (orderType == OrderType.TokensForEth) {
                require(tokenOut == _wethAddress, "Token out must be WETH");
            } else {
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
                deflationary = true;
            }
            require(amountInOffered > 0, "Invalid final offered amount");
        } else {
            require(tokenIn == _wethAddress, "Token in must be WETH");
            require(
                msg.value == amountInOffered.add(executorFee),
                "Transaction value must match offer and fee"
            );
        }

        // get canonical uniswap pair address
        address _pairAddress = getPair(tokenIn, tokenOut);

        (uint256 _orderId, Order memory _order) = registerOrder(
            orderType,
            msg.sender,
            tokenIn,
            tokenOut,
            _pairAddress,
            amountInOffered,
            amountOutExpected,
            executorFee,
            msg.value,
            deflationary
        );

        emit OrderPlaced(
            _orderId,
            _order.orderType,
            _order.maker,
            _order.tokenIn,
            _order.tokenOut,
            _order.amountInOffered,
            _order.amountOutExpected,
            _order.executorFee,
            _order.totalEthDeposited
        );

        return _orderId;
    }

    function updateOrder(
        uint256 orderId,
        uint256 amountInOffered,
        uint256 amountOutExpected,
        uint256 executorFee
    ) external payable exists(orderId) nonReentrant returns (bool) {
        Order memory _updatingOrder = orders[orderId];
        require(msg.sender == _updatingOrder.maker, "Permission denied");
        require(
            _updatingOrder.orderState == OrderState.Placed,
            "Cannot update order"
        );
        require(amountInOffered > 0, "Invalid offered amount");
        require(amountOutExpected > 0, "Invalid expected amount");
        require(executorFee > 0, "Invalid executor fee");

        if (_updatingOrder.orderType == OrderType.EthForTokens) {
            uint256 newTotal = amountInOffered.add(executorFee);
            if (newTotal > _updatingOrder.totalEthDeposited) {
                require(
                    msg.value == newTotal.sub(_updatingOrder.totalEthDeposited),
                    "Additional deposit must match"
                );
            } else if (newTotal < _updatingOrder.totalEthDeposited) {
                TransferHelper.safeTransferETH(
                    _updatingOrder.maker,
                    _updatingOrder.totalEthDeposited.sub(newTotal)
                );
            }
            _updatingOrder.totalEthDeposited = newTotal;
        } else {
            if (executorFee > _updatingOrder.executorFee) {
                require(
                    msg.value == executorFee.sub(_updatingOrder.executorFee),
                    "Additional fee must match"
                );
            } else if (executorFee < _updatingOrder.executorFee) {
                TransferHelper.safeTransferETH(
                    _updatingOrder.maker,
                    _updatingOrder.executorFee.sub(executorFee)
                );
            }
            _updatingOrder.totalEthDeposited = executorFee;
            if (amountInOffered > _updatingOrder.amountInOffered) {
                uint256 beforeBalance = IERC20(_updatingOrder.tokenIn)
                    .balanceOf(address(this));
                TransferHelper.safeTransferFrom(
                    _updatingOrder.tokenIn,
                    msg.sender,
                    address(this),
                    amountInOffered.sub(_updatingOrder.amountInOffered)
                );
                uint256 afterBalance = IERC20(_updatingOrder.tokenIn).balanceOf(
                    address(this)
                );
                amountInOffered = _updatingOrder.amountInOffered.add(
                    afterBalance.sub(beforeBalance)
                );
            } else if (amountInOffered < _updatingOrder.amountInOffered) {
                TransferHelper.safeTransfer(
                    _updatingOrder.tokenIn,
                    _updatingOrder.maker,
                    _updatingOrder.amountInOffered.sub(amountInOffered)
                );
            }
        }

        // update order record
        _updatingOrder.amountInOffered = amountInOffered;
        _updatingOrder.amountOutExpected = amountOutExpected;
        _updatingOrder.executorFee = executorFee;
        orders[orderId] = _updatingOrder;

        emit OrderUpdated(
            orderId,
            amountInOffered,
            amountOutExpected,
            executorFee
        );

        return true;
    }

    function cancelOrder(uint256 orderId)
        external
        exists(orderId)
        nonReentrant
        returns (bool)
    {
        Order memory _cancellingOrder = orders[orderId];
        require(msg.sender == _cancellingOrder.maker, "Permission denied");
        require(
            _cancellingOrder.orderState == OrderState.Placed,
            "Cannot cancel order"
        );

        proceedOrder(orderId, OrderState.Cancelled);

        // Revert token allocation, funds, and fees
        if (_cancellingOrder.orderType != OrderType.EthForTokens) {
            TransferHelper.safeTransfer(
                _cancellingOrder.tokenIn,
                _cancellingOrder.maker,
                _cancellingOrder.amountInOffered
            );
        }

        TransferHelper.safeTransferETH(
            _cancellingOrder.maker,
            _cancellingOrder.totalEthDeposited
        );

        emit OrderCancelled(orderId);
        return true;
    }

    function executeOrder(uint256 orderId)
        external
        exists(orderId)
        nonReentrant
        returns (uint256[] memory amounts)
    {
        Order memory _executingOrder = orders[orderId];
        require(
            _executingOrder.orderState == OrderState.Placed,
            "Cannot execute order"
        );

        proceedOrder(orderId, OrderState.Executed);

        address[] memory _addressPair = createPair(
            _executingOrder.tokenIn,
            _executingOrder.tokenOut
        );
        uint256 unitradeFee = 0;

        if (_executingOrder.orderType == OrderType.TokensForTokens) {
            TransferHelper.safeApprove(
                _executingOrder.tokenIn,
                address(uniswapV2Router),
                _executingOrder.amountInOffered
            );
            uint256 _tokenFee = _executingOrder.amountInOffered.mul(feeMul).div(
                feeDiv
            );
            if (_executingOrder.deflationary) {
                uint256 beforeBalance = IERC20(_executingOrder.tokenOut)
                    .balanceOf(_executingOrder.maker);
                uniswapV2Router
                    .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    _executingOrder.amountInOffered.sub(_tokenFee),
                    _executingOrder.amountOutExpected,
                    _addressPair,
                    _executingOrder.maker,
                    UINT256_MAX
                );
                uint256 afterBalance = IERC20(_executingOrder.tokenOut)
                    .balanceOf(_executingOrder.maker);
                amounts = new uint256[](2);
                amounts[0] = _executingOrder.amountInOffered.sub(_tokenFee);
                amounts[1] = afterBalance.sub(beforeBalance);
            } else {
                amounts = uniswapV2Router.swapExactTokensForTokens(
                    _executingOrder.amountInOffered.sub(_tokenFee),
                    _executingOrder.amountOutExpected,
                    _addressPair,
                    _executingOrder.maker,
                    UINT256_MAX
                );
            }

            if (_tokenFee > 0) {
                // Convert x% of tokens to ETH as fee
                address[] memory _wethPair = createPair(
                    _executingOrder.tokenIn,
                    uniswapV2Router.WETH()
                );
                if (_executingOrder.deflationary) {
                    uint256 beforeBalance = IERC20(uniswapV2Router.WETH())
                        .balanceOf(address(this));
                    uniswapV2Router
                        .swapExactTokensForETHSupportingFeeOnTransferTokens(
                        _tokenFee,
                        0, //take any
                        _wethPair,
                        address(this),
                        UINT256_MAX
                    );
                    uint256 afterBalance = IERC20(uniswapV2Router.WETH())
                        .balanceOf(address(this));
                    unitradeFee = afterBalance.sub(beforeBalance);
                } else {
                    uint256[] memory _ethSwapResult = uniswapV2Router
                        .swapExactTokensForETH(
                        _tokenFee,
                        0, //take any
                        _wethPair,
                        address(this),
                        UINT256_MAX
                    );
                    unitradeFee = _ethSwapResult[1];
                }
            }
        } else if (_executingOrder.orderType == OrderType.TokensForEth) {
            TransferHelper.safeApprove(
                _executingOrder.tokenIn,
                address(uniswapV2Router),
                _executingOrder.amountInOffered
            );
            if (_executingOrder.deflationary) {
                uint256 beforeBalance = address(this).balance;
                uniswapV2Router
                    .swapExactTokensForETHSupportingFeeOnTransferTokens(
                    _executingOrder.amountInOffered,
                    _executingOrder.amountOutExpected,
                    _addressPair,
                    address(this),
                    UINT256_MAX
                );
                uint256 afterBalance = address(this).balance;
                amounts = new uint256[](2);
                amounts[0] = _executingOrder.amountInOffered;
                amounts[1] = afterBalance.sub(beforeBalance);
            } else {
                amounts = uniswapV2Router.swapExactTokensForETH(
                    _executingOrder.amountInOffered,
                    _executingOrder.amountOutExpected,
                    _addressPair,
                    address(this),
                    UINT256_MAX
                );
            }

            unitradeFee = amounts[1].mul(feeMul).div(feeDiv);
            if (amounts[1].sub(unitradeFee) > 0) {
                // Transfer to maker after post swap fee split
                TransferHelper.safeTransferETH(
                    _executingOrder.maker,
                    amounts[1].sub(unitradeFee)
                );
            }
        } else if (_executingOrder.orderType == OrderType.EthForTokens) {
            // Subtract fee from initial swap
            uint256 amountEthOffered = _executingOrder.totalEthDeposited.sub(
                _executingOrder.executorFee
            );
            unitradeFee = amountEthOffered.mul(feeMul).div(feeDiv);

            uint256 beforeBalance = IERC20(_executingOrder.tokenOut).balanceOf(
                _executingOrder.maker
            );
            uniswapV2Router.swapExactETHForTokensSupportingFeeOnTransferTokens{
                value: amountEthOffered.sub(unitradeFee)
            }(
                _executingOrder.amountOutExpected,
                _addressPair,
                _executingOrder.maker,
                UINT256_MAX
            );
            uint256 afterBalance = IERC20(_executingOrder.tokenOut).balanceOf(
                _executingOrder.maker
            );
            amounts = new uint256[](2);
            amounts[0] = amountEthOffered.sub(unitradeFee);
            amounts[1] = afterBalance.sub(beforeBalance);
        }

        // Transfer fee to incinerator/staker
        if (address(ETHToken) != address(0) && unitradeFee > 0) {
            //Swap BNB to ETH
            uniswapV2Router.swapExactETHForTokens{
                value: unitradeFee
            }(
                0,//Accept any amount of ETH tokens
                createPair(uniswapV2Router.WETH(),address(ETHToken)),
                FeeReceiver,
                UINT256_MAX
            );
            //Update fee data
            uint256 unitradeFeeETH = ETHToken.balanceOf(address(this));
            uint256 burnAmount = unitradeFeeETH.mul(splitMul).div(splitDiv);
            if (burnAmount > 0) {
                incineratorFeesETH = incineratorFeesETH.add(burnAmount);
            }
            stakerFeesETH = stakerFeesETH.add(unitradeFeeETH.sub(burnAmount));
        }

        // transfer fee to executor
        TransferHelper.safeTransferETH(msg.sender, _executingOrder.executorFee);

        emit OrderExecuted(orderId, msg.sender, amounts, unitradeFee);
    }

    function registerOrder(
        OrderType orderType,
        address payable maker,
        address tokenIn,
        address tokenOut,
        address pairAddress,
        uint256 amountInOffered,
        uint256 amountOutExpected,
        uint256 executorFee,
        uint256 totalEthDeposited,
        bool deflationary
    ) internal returns (uint256 orderId, Order memory) {
        uint256 _orderId = orderNumber;
        orderNumber++;

        // create order entries
        Order memory _order = Order({
            orderType: orderType,
            maker: maker,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountInOffered: amountInOffered,
            amountOutExpected: amountOutExpected,
            executorFee: executorFee,
            totalEthDeposited: totalEthDeposited,
            activeOrderIndex: activeOrders.length,
            orderState: OrderState.Placed,
            deflationary: deflationary
        });

        activeOrders.push(_orderId);
        orders[_orderId] = _order;
        ordersForAddress[maker].push(_orderId);
        ordersForAddress[pairAddress].push(_orderId);

        return (_orderId, _order);
    }

    function proceedOrder(uint256 orderId, OrderState nextState)
        internal
        returns (bool)
    {
        Order memory _proceedingOrder = orders[orderId];
        require(
            _proceedingOrder.orderState == OrderState.Placed,
            "Cannot proceed order"
        );

        if (activeOrders.length > 1) {
            uint256 _availableIndex = _proceedingOrder.activeOrderIndex;
            uint256 _lastOrderId = activeOrders[activeOrders.length - 1];
            Order memory _lastOrder = orders[_lastOrderId];
            _lastOrder.activeOrderIndex = _availableIndex;
            orders[_lastOrderId] = _lastOrder;
            activeOrders[_availableIndex] = _lastOrderId;
        }

        activeOrders.pop();
        _proceedingOrder.orderState = nextState;
        _proceedingOrder.activeOrderIndex = UINT256_MAX; // indicate that it's not active
        orders[orderId] = _proceedingOrder;

        return true;
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

    function getOrder(uint256 orderId)
        external
        view
        exists(orderId)
        returns (
            OrderType orderType,
            address payable maker,
            address tokenIn,
            address tokenOut,
            uint256 amountInOffered,
            uint256 amountOutExpected,
            uint256 executorFee,
            uint256 totalEthDeposited,
            OrderState orderState,
            bool deflationary
        )
    {
        Order memory _order = orders[orderId];
        return (
            _order.orderType,
            _order.maker,
            _order.tokenIn,
            _order.tokenOut,
            _order.amountInOffered,
            _order.amountOutExpected,
            _order.executorFee,
            _order.totalEthDeposited,
            _order.orderState,
            _order.deflationary
        );
    }

    function updateStaker(IUniTradeStaker newStaker) external onlyOwner {
        staker = newStaker;
        emit StakerUpdated(address(newStaker));
    }

    function updateFee(uint16 _feeMul, uint16 _feeDiv) external onlyOwner {
        require(_feeMul < _feeDiv, "!fee");
        feeMul = _feeMul;
        feeDiv = _feeDiv;
    }

    function updateSplit(uint16 _splitMul, uint16 _splitDiv)
        external
        onlyOwner
    {
        require(_splitMul < _splitDiv, "!split");
        splitMul = _splitMul;
        splitDiv = _splitDiv;
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

    function getActiveOrdersLength() external view returns (uint256) {
        return activeOrders.length;
    }

    function getActiveOrderId(uint256 index) external view returns (uint256) {
        return activeOrders[index];
    }

    function getOrdersForAddressLength(address _address)
        external
        view
        returns (uint256)
    {
        return ordersForAddress[_address].length;
    }

    function getOrderIdForAddress(address _address, uint256 index)
        external
        view
        returns (uint256)
    {
        return ordersForAddress[_address][index];
    }

    receive() external payable {} // to receive ETH from Uniswap
}
