const hre = require("hardhat");

async function main() {
    const Pair = await hre.ethers.getContractAt("IAlgebraPool", "0xd6e17B16F75f3b6688f94Ff8a90404088baaFcE7");
   
    await Pair.setPlugin("0x95B0C74368EA041FF29a58b6bB27adBc4eCEA44f")
    await Pair.setPluginConfig(1)

    console.log("Plugin activated");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });