// SPDX-License-Identifier: MIT
pragma solidity =0.8.20;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ISwapRouter} from 'contracts/interfaces/ISwapRouter.sol';
import 'contracts/NonfungiblePositionManager.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import 'hardhat/console.sol';
import './DcaApprover.sol';

contract SpiritSwapDCA is Ownable {
	ISwapRouter public router;
	ERC20 public usdc;
	ERC20 public tresory;

	uint256 public ordersCount;
	mapping(uint256 => Order) public ordersById;
	mapping(address => uint256[]) public idByAddress;

	event OrderCreated(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);
	event OrderEdited(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);
	event OrderStopped(address indexed user, uint256 indexed id);
	event OrderRestarted(address indexed user, uint256 indexed id);
	event OrderExecuted(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);
	event OrderFailed(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);

	constructor(address _router, address _tresory, address _usdc) {
		router = ISwapRouter(payable(_router));
		usdc = ERC20(_usdc);
		tresory = ERC20(_tresory);
	}

	function _executeOrder(uint id) private {
		address user = ordersById[id].user;
		ERC20 tokenIn = ERC20(ordersById[id].tokenIn);
		ERC20 tokenOut = ERC20(ordersById[id].tokenOut);

		uint256	fees = ordersById[id].amountIn / 100;

		uint256 balanceBefore = tokenOut.balanceOf(user);
        SpiritDcaApprover(ordersById[id].approver).executeOrder();
		ordersById[id].lastExecution = block.timestamp;
		ordersById[id].totalExecutions += 1;
		ordersById[id].totalAmountIn += ordersById[id].amountIn;
		
		tokenIn.transfer(address(tresory), fees);
		tokenIn.approve(address(router), ordersById[id].amountIn - fees);
		router.exactInputSingle(
			ISwapRouter.ExactInputSingleParams({
				tokenIn: ordersById[id].tokenIn,
				tokenOut: ordersById[id].tokenOut,
				recipient: payable(user),
				deadline: block.timestamp + 100,
				amountIn: ordersById[id].amountIn - fees,
				amountOutMinimum: ordersById[id].amountOutMin,
				limitSqrtPrice: 0
			})
		);
		
		uint256 balanceAfter = tokenOut.balanceOf(user);
		require(balanceAfter - balanceBefore >= ordersById[id].amountOutMin, 'Too little received.');
		ordersById[id].totalAmountOut += balanceAfter - balanceBefore;

		emit OrderExecuted(user, id, ordersById[id].tokenIn, ordersById[id].tokenOut, ordersById[id].amountIn - fees, ordersById[id].amountOutMin, ordersById[id].period);
	}

	function executeOrder(uint256 id) public {
		require(id < getOrdersCountTotal(), 'Order does not exist.');
		require(ordersById[id].stopped == false, 'Order is stopped.');
		require(block.timestamp - ordersById[id].lastExecution >= ordersById[id].period, 'Period not elapsed.');
		require(ERC20(ordersById[id].tokenIn).balanceOf(ordersById[id].user) >= ordersById[id].amountIn, 'Not enough balance.');

		_executeOrder(id);
	}

	function getOrdersCountTotal() public view returns (uint256) {
		return ordersCount;
	}

    function getOrdersCountByAddress(address user) public view returns (uint256) {
        return idByAddress[user].length;
    }

    function getOrdersByIndex(address user, uint256 index) public view returns (Order memory, uint256 id) {
        return (ordersById[idByAddress[user][index]], idByAddress[user][index]);
    }

    function getApproveBytecode(uint256 _id, address _user, address _tokenIn) public pure returns (bytes memory) {
        bytes memory bytecode = type(SpiritDcaApprover).creationCode;

        return abi.encodePacked(bytecode, abi.encode(_id, _user, _tokenIn));
    }

    function getApproveAddress(
        address _user,
        address _tokenIn
    ) public view returns (address) {
        uint _id = ordersCount;
        bytes memory bytecode = getApproveBytecode(_id, _user, _tokenIn);

        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _id, keccak256(bytecode))
        );

        // NOTE: cast last 20 bytes of hash to address
        return address(uint160(uint(hash)));
    }

	function createOrder(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period) public {
		require(period > 0, 'Period must be greater than 0.');
		require(amountIn > 0, 'AmountIn must be greater than 0.');
		require(tokenIn != tokenOut, 'TokenOut must be different.');
		require(tokenIn != address(0), 'Invalid tokenIn.');
		require(tokenOut != address(0), 'Invalid tokenOut.');

        address approver = address(new SpiritDcaApprover{salt: bytes32(ordersCount)}(ordersCount, msg.sender, tokenIn));
		Order memory order = Order(msg.sender, tokenIn, tokenOut, amountIn, amountOutMin, period, 0, 0, 0, 0, block.timestamp, false, approver);
		ordersById[ordersCount] = order;
		idByAddress[msg.sender].push(ordersCount);
		ordersCount++;

		_executeOrder(getOrdersCountTotal() - 1);

		emit OrderCreated(msg.sender, getOrdersCountTotal() - 1, tokenIn, tokenOut, amountIn, amountOutMin, period);
	}

	function editOrder(uint256 id, uint256 amountIn, uint256 amountOutMin, uint256 period) public {
		require(id < getOrdersCountTotal(), 'Order does not exist.');
		require(ordersById[id].user == msg.sender, 'Order does not belong to user.');
		require(period > 0, 'Period must be greater than 0.');
		require(amountIn > 0, 'AmountIn must be greater than 0.');

		ordersById[id].amountIn = amountIn;
		ordersById[id].amountOutMin = amountOutMin;
		ordersById[id].period = period;

		emit OrderEdited(msg.sender, id, ordersById[id].tokenIn, ordersById[id].tokenOut, amountIn, amountOutMin, period);
	}

	function stopOrder(uint256 id) public {
		require(id < getOrdersCountTotal(), 'Order does not exist.');
		require(ordersById[id].user == msg.sender, 'Order does not belong to user.');
		require(ordersById[id].stopped == false, 'Order is already stopped.');

		ordersById[id].stopped = true;

		emit OrderStopped(msg.sender, id);
	}

	function restartOrder(uint256 id) public {
		require(id < getOrdersCountTotal(), 'Order does not exist.');
		require(ordersById[id].user == msg.sender, 'Order does not belong to user.');
		require(ordersById[id].stopped == true, 'Order is not stopped.');

		ordersById[id].stopped = false;
		if (block.timestamp - ordersById[id].lastExecution >= ordersById[id].period) {
			_executeOrder(id);
		}

		emit OrderRestarted(msg.sender, id);
	}

	function editUSDC(address _usdc) public onlyOwner {
		usdc = ERC20(_usdc);
	}

	function editTresory(address _tresory) public onlyOwner {
		tresory = ERC20(_tresory);
	}
}