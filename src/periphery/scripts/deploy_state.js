const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const deployDataPath = path.resolve(__dirname, '../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));

  const StateMulticallFactory = await hre.ethers.getContractFactory('AlgebraStateMulticall');
  const StateMulticall = await StateMulticallFactory.deploy("0x399A6c8Bed55Cb193439EB4732F4F8332C05346f");

  await StateMulticall.waitForDeployment();

  deploysData.stateMulticall = StateMulticall.target;
  console.log('StateMulticall deployed to:', StateMulticall.target);

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
