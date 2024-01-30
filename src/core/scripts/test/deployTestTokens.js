const hre = require('hardhat');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
  const TokenFactory = await hre.ethers.getContractFactory('TestERC20');
  const tokenA = await TokenFactory.deploy(hre.ethers.parseEther('1000'));

    const addressA = await tokenA.getAddress();
    
  console.log(`TestToken1: ${addressA}`);

  const deployDataPath = path.resolve(__dirname, '../../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));
  deploysData.testToken0 = addressA;
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
