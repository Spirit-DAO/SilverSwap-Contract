const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const deployDataPath = path.resolve(__dirname, '../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));

  const LiquidityLockerFactory = await hre.ethers.getContractFactory('LiquidityLocker');
  const LiquidityLocker = await LiquidityLockerFactory.deploy(deploysData.swapRouter, '0x68Edf2cecbAf0bfcC9db032A1422F99196A50aBc', '0x68Edf2cecbAf0bfcC9db032A1422F99196A50aBc');

  await LiquidityLocker.waitForDeployment();

  deploysData.locker = LiquidityLocker.target;
  console.log('Locker deployed to:', LiquidityLocker.target);

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
