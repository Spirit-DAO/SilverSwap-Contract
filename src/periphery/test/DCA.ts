import { MaxUint256, Wallet } from 'ethers';
import { ethers } from 'hardhat';
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { MockTimeNonfungiblePositionManager, QuoterV2, SpiritSwapDCA, TestERC20 } from '../typechain';
import completeFixture from './shared/completeFixture';
import { MaxUint128 } from './shared/constants';
import { encodePriceSqrt } from './shared/encodePriceSqrt';
import { expandTo18Decimals } from './shared/expandTo18Decimals';
import { expect } from './shared/expect';
import { encodePath } from './shared/path';
import { createPool, createPoolWithMultiplePositions, createPoolWithZeroTickInitialized } from './shared/quoter';
import snapshotGasCost from './shared/snapshotGasCost';
import { extendConfig } from 'hardhat/config';
import { token } from '../typechain/@openzeppelin/contracts';

type TestERC20WithAddress = TestERC20 & { address: string };

describe('SpiritDCA', function () {
  this.timeout(40000);
  let wallet: Wallet;
  let trader: Wallet;

  const swapRouterFixture: () => Promise<{
    nft: MockTimeNonfungiblePositionManager;
    tokens: [TestERC20WithAddress, TestERC20WithAddress, TestERC20WithAddress];
    quoter: QuoterV2;
    dca: SpiritSwapDCA;
  }> = async () => {
    const { wnative, factory, router, tokens, nft } = await loadFixture(completeFixture);
    let _tokens = tokens as [TestERC20WithAddress, TestERC20WithAddress, TestERC20WithAddress];
    // approve & fund wallets
    for (const token of _tokens) {
      await token.approve(router, MaxUint256);
      await token.approve(nft, MaxUint256);
      await token.connect(trader).approve(router, MaxUint256);
      await token.transfer(trader.address, expandTo18Decimals(1_000_000));
      token.address = await token.getAddress();
    }

    const quoterFactory = await ethers.getContractFactory('QuoterV2');
    quoter = (await quoterFactory.deploy(factory, wnative, await factory.poolDeployer())) as any as QuoterV2;
	const dcaFactory = await ethers.getContractFactory('SpiritSwapDCA');
    dca = (await dcaFactory.deploy(await router.getAddress(), await quoter.getAddress(), await tokens[2].getAddress())) as any as SpiritSwapDCA;

    return {
      tokens: _tokens,
      nft,
      quoter,
	  dca,
    };
  };

  let nft: MockTimeNonfungiblePositionManager;
  let tokens: [TestERC20WithAddress, TestERC20WithAddress, TestERC20WithAddress];
  let quoter: QuoterV2;
  let dca: SpiritSwapDCA;

  before('create fixture loader', async () => {
    const wallets = await (ethers as any).getSigners();
    [wallet, trader] = wallets;
  });

  describe('Orders', () => {
    const subFixture = async () => {
      ({ tokens, nft, quoter, dca } = await swapRouterFixture());
      await createPool(nft, wallet, tokens[0].address, tokens[1].address);
      await createPool(nft, wallet, tokens[1].address, tokens[2].address);
      await createPoolWithMultiplePositions(nft, wallet, tokens[0].address, tokens[2].address);
      return {
        tokens,
        nft,
        quoter,
		dca,
      };
    };

    beforeEach(async () => {
      ({ tokens, nft, quoter, dca } = await loadFixture(subFixture));
    });

    describe('#createOrder', () => {
		it('period is 0', async () => {
			await expect(dca.createOrder(tokens[0].address, tokens[1].address, 10000, 20000, 0)).to.be.revertedWith('Period must be greater than 0.');
		});

		it('amountIn is 0', async () => {
			await expect(dca.createOrder(tokens[0].address, tokens[1].address, 0, 20000, 360)).to.be.revertedWith('AmountIn must be greater than 0.');
		});

		it('tokenIn & tokenOut are same', async () => {
			await expect(dca.createOrder(tokens[0].address, tokens[0].address, 10000, 20000, 360)).to.be.revertedWith('TokenIn must be different than TokenOut.');
		});

		//'tokenIn is null'

		it('10 tokens with avaible balances', async () => {
			const { amountOut } = await quoter.quoteExactInput.staticCall(encodePath([tokens[0].address, tokens[1].address]), 10000);

			const balanceBefore0 = await tokens[0].balanceOf(wallet.address);
			const balanceBefore1 = await tokens[1].balanceOf(wallet.address);

			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);
			
			const balanceAfter0 = await tokens[0].balanceOf(wallet.address);
			const balanceAfter1 = await tokens[1].balanceOf(wallet.address);
			
			expect (balanceBefore0 - balanceAfter0).to.be.eq(10000);
			expect (balanceAfter1 - balanceBefore1).to.be.eq(amountOut);
		});

		it('outMin is not respected', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await expect(dca.createOrder(tokens[0].address, tokens[1].address, 10000, 20000, 86400*7)).to.be.revertedWith('Too little received');
		});
    });

	describe('#getOrdersCount', () => {
		it('Order creation + getOrdersCount', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const count = await dca.getOrdersCount(wallet.address);

			await expect(count).to.be.eq(1);
		});
	});

	describe('#deleteOrder', () => {
		it('Order creation + deleteOrder', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.deleteOrder(0);

			await expect((await dca.ordersByAddress(wallet.address, 0)).deleted).to.be.eq(true);
		});
	});

	describe('#getEstimatedFees', () => {
		it('test', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const address = await quoter.getAddress();
			const contract = new ethers.Contract(address, quoter.interface, wallet);
			console.log(await contract.quoteExactOutput.staticCall(encodePath([tokens[1].address, tokens[0].address]), 1000));
			console.log(await quoter.getAddress());
			console.log(await dca.getEstimatedFees(tokens[0].address, tokens[1].address, 1000));
		});
	});
	
	describe('#editOrder', () => {
		it('Try to edit an order', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect((await dca.ordersByAddress(wallet.address, 0)).amountIn).to.be.equal(10000);
			await expect((await dca.ordersByAddress(wallet.address, 0)).amountOutMin).to.be.equal(0);
			await expect((await dca.ordersByAddress(wallet.address, 0)).period).to.be.equal(86400*7);

			await dca.editOrder(0, 20000, 100, 86400*30);

			await expect((await dca.ordersByAddress(wallet.address, 0)).amountIn).to.be.equal(20000);
			await expect((await dca.ordersByAddress(wallet.address, 0)).amountOutMin).to.be.equal(100);
			await expect((await dca.ordersByAddress(wallet.address, 0)).period).to.be.equal(86400*30);
		});

		it('Edit an order with invalid ID', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.editOrder(16, 20000, 100, 86400*30)).to.be.revertedWith('Order does not exist.');
		});

		it('Edit an deleted order', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.deleteOrder(0);
			await expect(dca.editOrder(0, 20000, 100, 86400*30)).to.be.revertedWith('Order is deleted.');
		});

		it('Edit an order with invalid period', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.editOrder(0, 20000, 100, 0)).to.be.revertedWith('Period must be greater than 0.');
		});

		it('Edit an order with invalid amountIn', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.editOrder(0, 0, 100, 360)).to.be.revertedWith('AmountIn must be greater than 0.');
		});
    });

	describe('#executeOrder', () => {
		it('executeOrder an valid order', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const lastExecutionBefore = (await dca.ordersByAddress(wallet.address, 0)).lastExecution;

			await time.increase(86400*7);
			await dca.executeOrder(wallet.address, 0);

			const lastExecutionAfter = (await dca.ordersByAddress(wallet.address, 0)).lastExecution;

			await expect(lastExecutionAfter > lastExecutionBefore);
			await expect((await dca.ordersByAddress(wallet.address, 0)).totalExecutions).to.be.equal(2);
		});

		it('executeOrder an order with invalid ID', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);
			await expect(dca.executeOrder(wallet.address, 667)).to.be.revertedWith('Order does not exist.');
		});

		it('executeOrder too early', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.executeOrder(wallet.address, 0)).to.be.revertedWith('Period not elapsed.');
		});

		it('executeOrder with insufficient balance', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);
			await tokens[0].transfer(trader.address, await tokens[0].balanceOf(wallet.address));
			await expect(dca.executeOrder(wallet.address, 0)).to.be.revertedWith('Not enough balance.');
		});

		it('executeOrder with an deleted order', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);
			await dca.deleteOrder(0);
			await expect(dca.executeOrder(wallet.address, 0)).to.be.revertedWith('Order is deleted.');
		});

		it('executeOrder with invalid order & retry it with valid order', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.executeOrder(wallet.address, 0)).to.be.revertedWith('Period not elapsed.');

			await time.increase(86400*7);
			await tokens[0].transfer(trader.address, await tokens[0].balanceOf(wallet.address));
			await expect(dca.executeOrder(wallet.address, 0)).to.be.revertedWith('Not enough balance.');

			await tokens[0].connect(trader).transfer(wallet.address, await tokens[0].balanceOf(trader.address));
			await dca.executeOrder(wallet.address, 0);

			await expect((await dca.ordersByAddress(wallet.address, 0)).totalExecutions).to.be.equal(2);
		});

		it('executeOrder where outMin is not respected', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 1000, 86400*7);

			await dca.editOrder(0, 10000, 20000, 86400*7);
			await time.increase(86400*7);

			await expect(dca.createOrder(tokens[0].address, tokens[1].address, 10000, 20000, 86400*7)).to.be.revertedWith('Too little received');
		});

		it('create & executeOrder and check totalAmountIn & totalAmountOut', async () => {
			const { amountOut } = await quoter.quoteExactInput.staticCall(encodePath([tokens[0].address, tokens[1].address]), 10000 * 2);
			
			await tokens[0].approve(await dca.getAddress(), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 1000, 86400*7);

			await time.increase(86400*7);

			await dca.executeOrder(wallet.address, 0);

			await expect((await dca.ordersByAddress(wallet.address, 0)).totalAmountIn).to.be.equal(10000 * 2);
			await expect((await dca.ordersByAddress(wallet.address, 0)).totalAmountOut).to.be.equal(amountOut);
		});
    });
  });
});
