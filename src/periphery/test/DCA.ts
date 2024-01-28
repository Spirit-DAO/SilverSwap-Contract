import { MaxUint256, Wallet } from 'ethers';
import { ethers } from 'hardhat';
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

type TestERC20WithAddress = TestERC20 & { address: string };

describe('QuoterV2', function () {
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
    dca = (await dcaFactory.deploy(await router.getAddress())) as any as SpiritSwapDCA;

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

  describe('position', () => {
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

	  it('OutMin is not respected', async () => {
		await tokens[0].approve(await dca.getAddress(), MaxUint256)
		await expect(dca.createOrder(tokens[0].address, tokens[1].address, 10000, 20000, 86400*7)).to.be.revertedWith('Too little received');
      });
    });
  });
});
