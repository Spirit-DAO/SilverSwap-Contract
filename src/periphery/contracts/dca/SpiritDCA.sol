// SPDX-License-Identifier: MIT
pragma solidity =0.8.20;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ISwapRouter} from 'contracts/interfaces/ISwapRouter.sol';
import 'contracts/NonfungiblePositionManager.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import 'hardhat/console.sol';

contract SpiritSwapDCA is Ownable {
	ISwapRouter public router;
	ERC20 public usdc;
	ERC20 public tresory;

	struct Order {
		address tokenIn;
		address tokenOut;
		uint256 amountIn;
		uint256 amountOutMin;
		uint256 period;
		uint256 lastExecution;
		uint256 totalExecutions;
		uint256 totalAmountIn;
		uint256 totalAmountOut;
		bool deleted;
	}

	mapping(address => Order[]) public ordersByAddress;

	event OrderCreated(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);
	event OrderEdited(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);
	event OrderDeleted(address indexed user, uint256 indexed id);
	event OrderExecuted(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);
	event OrderFailed(address indexed user, uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period);

	constructor(address _router, address _tresory, address _usdc) {
		router = ISwapRouter(payable(_router));
		usdc = ERC20(_usdc);
		tresory = ERC20(_tresory);
	}

	//faire une fonction getCurrentTimestamp à la place de block.timestamp pour fix le not-rely-on-time
	//https://ethereum.stackexchange.com/questions/413/can-a-contract-safely-rely-on-block-timestamp
	function _executeOrder(address user, uint id) private {
		ERC20 tokenIn = ERC20(ordersByAddress[user][id].tokenIn);
		ERC20 tokenOut = ERC20(ordersByAddress[user][id].tokenOut);

		uint256	fees = ordersByAddress[user][id].amountIn / 100;

		uint256 balanceBefore = tokenOut.balanceOf(address(user));
		ordersByAddress[user][id].lastExecution = block.timestamp;
		ordersByAddress[user][id].totalExecutions += 1;
		
		tokenIn.transferFrom(user, address(this), ordersByAddress[user][id].amountIn);
		tokenIn.transfer(address(tresory), fees);
		tokenIn.approve(address(router), ordersByAddress[user][id].amountIn - fees);
		router.exactInputSingle(
			ISwapRouter.ExactInputSingleParams({
				tokenIn: ordersByAddress[user][id].tokenIn,
				tokenOut: ordersByAddress[user][id].tokenOut,
				recipient: payable(address(user)),
				deadline: block.timestamp + 100,
				amountIn: ordersByAddress[user][id].amountIn - fees,
				amountOutMinimum: ordersByAddress[user][id].amountOutMin,
				limitSqrtPrice: 0
			})
		);
		
		uint256 balanceAfter = tokenOut.balanceOf(address(user));
		require(balanceAfter - balanceBefore >= ordersByAddress[user][id].amountOutMin, 'Too little received.');
		ordersByAddress[user][id].totalAmountIn += ordersByAddress[user][id].amountIn - fees;
		ordersByAddress[user][id].totalAmountOut += balanceAfter - balanceBefore;

		emit OrderExecuted(user, id, ordersByAddress[user][id].tokenIn, ordersByAddress[user][id].tokenOut, ordersByAddress[user][id].amountIn - fees, ordersByAddress[user][id].amountOutMin, ordersByAddress[user][id].period);
	}

	function executeOrder(address user, uint256 id) public {
		require(id < getOrdersCount(msg.sender), 'Order does not exist.');
		require(block.timestamp - ordersByAddress[user][id].lastExecution >= ordersByAddress[user][id].period, 'Period not elapsed.');
		require(ERC20(ordersByAddress[user][id].tokenIn).balanceOf(user) >= ordersByAddress[user][id].amountIn, 'Not enough balance.');
		require(ordersByAddress[user][id].deleted == false, 'Order is deleted.');
		
		_executeOrder(user, id);
	}

	function getOrdersCount(address user) public view returns (uint256) {
		return ordersByAddress[user].length;
	}

	function createOrder(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 period) public {
		require(period > 0, 'Period must be greater than 0.');
		require(amountIn > 0, 'AmountIn must be greater than 0.');
		require(tokenIn != tokenOut, 'TokenIn must be different than TokenOut.');
		require(tokenIn != address(0), 'TokenIn must be different than 0x0.');
		require(tokenOut != address(0), 'tokenOut must be different than 0x0.');

		Order memory order = Order(tokenIn, tokenOut, amountIn, amountOutMin, period, 0, 0, 0, 0, false);
		ordersByAddress[msg.sender].push(order);

		_executeOrder(msg.sender, getOrdersCount(msg.sender) - 1);

		emit OrderCreated(msg.sender, getOrdersCount(msg.sender) - 1, tokenIn, tokenOut, amountIn, amountOutMin, period);
	}

	function editOrder(uint256 id, uint256 amountIn, uint256 amountOutMin, uint256 period) public {
		require(id < getOrdersCount(msg.sender), 'Order does not exist.');
		require(ordersByAddress[msg.sender][id].deleted == false, 'Order is deleted.');
		require(period > 0, 'Period must be greater than 0.');
		require(amountIn > 0, 'AmountIn must be greater than 0.');

		ordersByAddress[msg.sender][id].amountIn = amountIn;
		ordersByAddress[msg.sender][id].amountOutMin = amountOutMin;
		ordersByAddress[msg.sender][id].period = period;

		emit OrderEdited(msg.sender, id, ordersByAddress[msg.sender][id].tokenIn, ordersByAddress[msg.sender][id].tokenOut, amountIn, amountOutMin, period);
	}

	function deleteOrder(uint256 id) public {
		require(id < getOrdersCount(msg.sender), 'Order does not exist.');
		require(ordersByAddress[msg.sender][id].deleted == false, 'Order is already deleted.');

		ordersByAddress[msg.sender][id].deleted = true;
		
		emit OrderDeleted(msg.sender, id);
	}

	function editUSDC(address _usdc) public onlyOwner {
		usdc = ERC20(_usdc);
	}

	function editTresory(address _tresory) public onlyOwner {
		tresory = ERC20(_tresory);
	}
}