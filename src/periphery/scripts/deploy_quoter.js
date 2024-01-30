const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const deployDataPath = path.resolve(__dirname, '../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));

  const LiquidityQuoterFactory = await hre.ethers.getContractFactory('LiquidityQuoter');
  const LiquidityQuoter = await LiquidityQuoterFactory.deploy(deploysData.nonfungiblePositionManager);

  await LiquidityQuoter.waitForDeployment();

  deploysData.liquidityQuoter = LiquidityQuoter.target;
  console.log('LiquidityQuoter deployed to:', LiquidityQuoter.target);

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
