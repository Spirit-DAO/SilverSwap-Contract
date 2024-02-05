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
  let tresory: Wallet;

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
	const wallets = await (ethers as any).getSigners();
    [tresory] = wallets;
    dca = (await dcaFactory.deploy(await router.getAddress(), tresory.address, await tokens[2].getAddress())) as any as SpiritSwapDCA;

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
			await expect(dca.createOrder(tokens[0].address, tokens[0].address, 10000, 20000, 360)).to.be.revertedWith('TokenOut must be different.');
		});

		//'tokenIn is null'

		it('10 tokens with avaible balances', async () => {
			const { amountOut } = await quoter.quoteExactInput.staticCall(encodePath([tokens[0].address, tokens[1].address]), 10000 * 0.99);

			const balanceBefore0 = await tokens[0].balanceOf(wallet.address);
			const balanceBefore1 = await tokens[1].balanceOf(wallet.address);

			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);
			
			const balanceAfter0 = await tokens[0].balanceOf(wallet.address);
			const balanceAfter1 = await tokens[1].balanceOf(wallet.address);
			
			expect (balanceBefore0 - balanceAfter0).to.be.eq(10000 * 0.99);
			expect (balanceAfter1 - balanceBefore1).to.be.eq(amountOut);
		});

		it('outMin is not respected', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await expect(dca.createOrder(tokens[0].address, tokens[1].address, 10000, 20000, 86400*7)).to.be.revertedWith('Too little received');
		});
    });

	describe('#getOrdersCount', () => {
		it('Order creation + getOrdersCount', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const count = await dca.ordersCount();

			await expect(count).to.be.eq(1);
		});

		it('5*Order creation + getOrdersCount', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const count = await dca.ordersCount();

			await expect(count).to.be.eq(5);
		});
	});

	describe('#stopOrder', () => {
		it('stopOrder', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.stopOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(true);
		});

		it('Trying to delete someones order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.connect(trader).stopOrder(0)).to.be.revertedWith('Order does not belong to user.');
			await expect((await dca.ordersById(0)).stopped).to.be.eq(false);
		});
	});

	describe('#restartOrder', () => {
		it('restartOrder', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.stopOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(true);

			await dca.restartOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(false);
		});

		it('Trying to restart someones order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.stopOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(true);

			await expect(dca.connect(trader).restartOrder(0)).to.be.revertedWith('Order does not belong to user.');
			await expect((await dca.ordersById(0)).stopped).to.be.eq(true);
		});

		it('restartOrder & check if it has been executed (should be)', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.stopOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(true);

			const lastExecutionBefore = (await dca.ordersById(0)).lastExecution;
			await time.increase(86400*7);

			await dca.restartOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(false);
			const lastExecutionAfter = (await dca.ordersById(0)).lastExecution;
			
			await expect(lastExecutionAfter > lastExecutionBefore);
		});

		it('restartOrder & check if it has been executed (shouldnt be)', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.stopOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(true);

			const lastExecutionBefore = (await dca.ordersById(0)).lastExecution;

			await dca.restartOrder(0);
			await expect((await dca.ordersById(0)).stopped).to.be.eq(false);
			const lastExecutionAfter = (await dca.ordersById(0)).lastExecution;
			
			await expect(lastExecutionAfter == lastExecutionBefore);
		});
	});

	/*describe('#getEstimatedFees', () => {
		it('Checking the getEstimatedFees function', async () => {
			await tokens[0].approve(await dca.getAddress(), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const address = await quoter.getAddress();
			const contract = new ethers.Contract(address, quoter.interface, wallet);
			console.log(await contract.quoteExactOutput.staticCall(encodePath([tokens[1].address, tokens[0].address]), 1000));
			console.log(await quoter.getAddress());
			console.log(await tokens[1].address);
			console.log(await tokens[0].address);
			console.log(encodePath([tokens[1].address, tokens[0].address]));
			await dca.getEstimatedFees(tokens[0].address, tokens[1].address, 1000);
			//console.log(await dca.getEstimatedFees(tokens[0].address, tokens[1].address, 1000));
		});
	});*/
	
	describe('#editOrder', () => {
		it('Try to edit an order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect((await dca.ordersById(0)).amountIn).to.be.equal(10000);
			await expect((await dca.ordersById(0)).amountOutMin).to.be.equal(0);
			await expect((await dca.ordersById(0)).period).to.be.equal(86400*7);

			await dca.editOrder(0, 20000, 100, 86400*30);

			await expect((await dca.ordersById(0)).amountIn).to.be.equal(20000);
			await expect((await dca.ordersById(0)).amountOutMin).to.be.equal(100);
			await expect((await dca.ordersById(0)).period).to.be.equal(86400*30);
		});

		it('Edit someone s order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.connect(trader).editOrder(0, 20000, 100, 86400*30)).to.be.revertedWith('Order does not belong to user.');
		});

		it('Edit an order with invalid ID', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.editOrder(16, 20000, 100, 86400*30)).to.be.revertedWith('Order does not exist.');
		});

		it('Edit an stopped order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await dca.stopOrder(0);

			await expect((await dca.ordersById(0)).amountIn).to.be.equal(10000);
			await expect((await dca.ordersById(0)).amountOutMin).to.be.equal(0);
			await expect((await dca.ordersById(0)).period).to.be.equal(86400*7);

			await dca.editOrder(0, 20000, 100, 86400*30);

			await expect((await dca.ordersById(0)).amountIn).to.be.equal(20000);
			await expect((await dca.ordersById(0)).amountOutMin).to.be.equal(100);
			await expect((await dca.ordersById(0)).period).to.be.equal(86400*30);
		});

		it('Edit an order with invalid period', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.editOrder(0, 20000, 100, 0)).to.be.revertedWith('Period must be greater than 0.');
		});

		it('Edit an order with invalid amountIn', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256)
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.editOrder(0, 0, 100, 360)).to.be.revertedWith('AmountIn must be greater than 0.');
		});
    });

	describe('#executeOrder', () => {
		it('executeOrder an valid order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			const lastExecutionBefore = (await dca.ordersById(0)).lastExecution;

			await time.increase(86400*7);
			await dca.executeOrder(0);

			const lastExecutionAfter = (await dca.ordersById(0)).lastExecution;

			await expect(lastExecutionAfter > lastExecutionBefore);
			await expect((await dca.ordersById(0)).totalExecutions).to.be.equal(2);
		});

		it('executeOrder an order with invalid ID', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);
			await expect(dca.executeOrder(667)).to.be.revertedWith('Order does not exist.');
		});

		it('executeOrder too early', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.executeOrder(0)).to.be.revertedWith('Period not elapsed.');
		});

		it('executeOrder with insufficient balance', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);
			await tokens[0].transfer(trader.address, await tokens[0].balanceOf(wallet.address));
			await expect(dca.executeOrder(0)).to.be.revertedWith('Not enough balance.');
		});

		it('executeOrder with an stopped order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);
			
			await dca.stopOrder(0);
			await expect(dca.executeOrder(0)).to.be.revertedWith('Order is stopped.');
		});

		it('executeOrder with an restarted order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await time.increase(86400*7);

			await dca.stopOrder(0);
			await expect(dca.executeOrder(0)).to.be.revertedWith('Order is stopped.');

			let lastExecutionBefore = (await dca.ordersById(0)).lastExecution;
			await dca.restartOrder(0);
			let lastExecutionAfter = (await dca.ordersById(0)).lastExecution;
			await expect(dca.executeOrder(0)).to.be.revertedWith('Period not elapsed.');

			await time.increase(86400*7);
			lastExecutionBefore = (await dca.ordersById(0)).lastExecution;
			await dca.executeOrder(0);
			lastExecutionAfter = (await dca.ordersById(0)).lastExecution;

			await expect(lastExecutionAfter > lastExecutionBefore);
		});

		it('executeOrder with invalid order & retry it with valid order', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			await expect(dca.executeOrder(0)).to.be.revertedWith('Period not elapsed.');

			await time.increase(86400*7);
			await tokens[0].transfer(trader.address, await tokens[0].balanceOf(wallet.address));
			
			await expect(dca.executeOrder(0)).to.be.revertedWith('Not enough balance.');

			await tokens[0].connect(trader).transfer(wallet.address, await tokens[0].balanceOf(trader.address));
			await dca.executeOrder(0);

			await expect((await dca.ordersById(0)).totalExecutions).to.be.equal(2);
		});

		it('executeOrder where outMin is not respected', async () => {
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 1000, 86400*7);

			await dca.editOrder(0, 10000, 20000, 86400*7);
			await time.increase(86400*7);

			await expect(dca.executeOrder(0)).to.be.revertedWith('Too little received');
		});

		it('create & executeOrder and check totalAmountIn & totalAmountOut', async () => {
			const { amountOut } = await quoter.quoteExactInput.staticCall(encodePath([tokens[0].address, tokens[1].address]), (10000 * 0.99) + (10000 * 0.99));
			
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 1000, 86400*7);

			await time.increase(86400*7);

			await dca.executeOrder(0);

			await expect((await dca.ordersById(0)).totalAmountIn).to.be.equal((10000 * 0.99) + (10000 * 0.99));
			await expect((await dca.ordersById(0)).totalAmountOut).to.be.equal(amountOut);
		});
    });

	describe('#tresory', () => {
		it('tresory got 1% fees of 10000 (check it 2x)', async () => {
			await dca.editTresory(trader.address);

			let balanceBefore = await tokens[0].balanceOf(trader.address);
			
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			let balanceAfter = await tokens[0].balanceOf(trader.address);
			await expect(balanceAfter - balanceBefore).to.be.equal(10000*0.01);

			balanceBefore = await tokens[0].balanceOf(trader.address);
			
			await time.increase(86400*7);
			await dca.executeOrder(0);

			balanceAfter = await tokens[0].balanceOf(trader.address);
			await expect(balanceAfter - balanceBefore).to.be.equal(10000*0.01);

		});

		it('tresory got 1% fees of 84987', async () => {
			await dca.editTresory(trader.address);

			let balanceBefore = await tokens[0].balanceOf(trader.address);
			
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 84900, 0, 86400*7);

			let balanceAfter = await tokens[0].balanceOf(trader.address);
			await expect(balanceAfter - balanceBefore).to.be.equal(84900*0.01);
		});

		it('tresory got 1% fees of 20000 and editing the order to 66700 and re try', async () => {
			await dca.editTresory(trader.address);

			let balanceBefore = await tokens[0].balanceOf(trader.address);
			
			await tokens[0].approve(await dca.getApproveAddress(wallet.address, tokens[0].address), MaxUint256);
			await dca.createOrder(tokens[0].address, tokens[1].address, 10000, 0, 86400*7);

			let balanceAfter = await tokens[0].balanceOf(trader.address);
			await expect(balanceAfter - balanceBefore).to.be.equal(10000*0.01);

			balanceBefore = await tokens[0].balanceOf(trader.address);
			
			await time.increase(86400*7);
			await dca.editOrder(0, 66700, 0, 86400*7);
			await dca.executeOrder(0);

			balanceAfter = await tokens[0].balanceOf(trader.address);
			await expect(balanceAfter - balanceBefore).to.be.equal(66700*0.01);
		});
	});
  });
});
