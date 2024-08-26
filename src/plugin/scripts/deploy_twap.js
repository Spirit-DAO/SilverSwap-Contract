const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {

    const deployDataPath = path.resolve(__dirname, '../../../deploys.json')
    const deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'))

    const BasePluginV1Factory = await hre.ethers.getContractFactory("AlgebraOracleV1TWAP");
    const dsFactory = await BasePluginV1Factory.deploy("0xB017D70Ec02eA6cC706FD7970C14470db995c2a0");

    await dsFactory.waitForDeployment()

    console.log("TWAP to:", dsFactory.target);
    deploysData.TWAP = dsFactory.target;
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