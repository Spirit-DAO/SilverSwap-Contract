const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const deployDataPath = path.resolve(__dirname, '../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));

  const LiquidityQuoterFactory = await hre.ethers.getContractFactory('SpiritSwapDCA');
  const LiquidityQuoter = await LiquidityQuoterFactory.deploy(deploysData.swapRouter, '0x9FDdA2Eb31bF682E918be4548722B82A7F5705E5', '0x9FDdA2Eb31bF682E918be4548722B82A7F5705E5');

  await LiquidityQuoter.waitForDeployment();

  deploysData.dca = LiquidityQuoter.target;
  console.log('DCA deployed to:', LiquidityQuoter.target);

  fs.writeFileSync(deployDataPath, JSON.stringify(deploysData), 'utf-8');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
