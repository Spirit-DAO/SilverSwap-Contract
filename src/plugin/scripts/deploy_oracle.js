const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const deployDataPath = path.resolve(__dirname, '../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));

  const LiquidityQuoterFactory = await hre.ethers.getContractFactory('AlgebraOracleV1TWAP');
  const LiquidityQuoter = await LiquidityQuoterFactory.deploy(deploysData.BasePluginV1Factory);

  await LiquidityQuoter.waitForDeployment();

  deploysData.dca = LiquidityQuoter.target;
  console.log('Oracle:', LiquidityQuoter.target);

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
