const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const deployDataPath = path.resolve(__dirname, '../../../deploys.json');
  let deploysData = JSON.parse(fs.readFileSync(deployDataPath, 'utf8'));

  // WNativeTokenAddress
  const WNativeTokenAddress = '0x5002477fda4A92E3165B52d635bD24a0dc1716a6';
  const signers = await hre.ethers.getSigners();
  const ProxyAdmin = signers[0].address;

  deploysData.wrapped = WNativeTokenAddress;

  const TickLensFactory = await hre.ethers.getContractFactory('TickLens');
  let TickLens = await TickLensFactory.deploy();

  TickLens = await TickLens.waitForDeployment();

  deploysData.tickLens = TickLens.target;
  console.log('TickLens deployed to:', TickLens.target);

  // arg1 factory address
  // arg2 wnative address
  const QuoterFactory = await hre.ethers.getContractFactory('Quoter');
  let Quoter = await QuoterFactory.deploy(deploysData.factory, WNativeTokenAddress, deploysData.poolDeployer);

  Quoter = await Quoter.waitForDeployment();

  deploysData.quoter = Quoter.target;
  console.log('Quoter deployed to:', Quoter.target);

  // arg1 factory address
  // arg2 wnative address
  const QuoterV2Factory = await hre.ethers.getContractFactory('QuoterV2');
  let QuoterV2 = await QuoterV2Factory.deploy(deploysData.factory, WNativeTokenAddress, deploysData.poolDeployer);

  QuoterV2 = await QuoterV2.waitForDeployment();

  deploysData.quoterV2 = QuoterV2.target;
  console.log('QuoterV2 deployed to:', QuoterV2.target);

  // arg1 factory address
  // arg2 wnative address
  const SwapRouterFactory = await hre.ethers.getContractFactory('SwapRouter');
  let SwapRouter = await SwapRouterFactory.deploy(deploysData.factory, WNativeTokenAddress, deploysData.poolDeployer);

  SwapRouter = await SwapRouter.waitForDeployment();

  deploysData.swapRouter = SwapRouter.target;
  console.log('SwapRouter deployed to:', SwapRouter.target);

  const NFTDescriptorFactory = await hre.ethers.getContractFactory('NFTDescriptor');
  let NFTDescriptor = await NFTDescriptorFactory.deploy();

  NFTDescriptor = await NFTDescriptor.waitForDeployment();
  // arg1 wnative address
  const NonfungibleTokenPositionDescriptorFactory = await hre.ethers.getContractFactory(
    'NonfungibleTokenPositionDescriptor',
    {
      libraries: {
        NFTDescriptor: NFTDescriptor.target,
      },
    }
  );
  let NonfungibleTokenPositionDescriptor = await NonfungibleTokenPositionDescriptorFactory.deploy(
    WNativeTokenAddress,
    'WTLS',
    []
  );

  NonfungibleTokenPositionDescriptor = await NonfungibleTokenPositionDescriptor.waitForDeployment();

  console.log('NonfungibleTokenPositionDescriptor deployed to:', NonfungibleTokenPositionDescriptor.target);

  //console.log('NFTDescriptor deployed to:', NFTDescriptor.target)
  const ProxyFactory = await hre.ethers.getContractFactory('TransparentUpgradeableProxy');
  let Proxy = await ProxyFactory.deploy(NonfungibleTokenPositionDescriptor.target, ProxyAdmin, '0x');

  Proxy = await Proxy.waitForDeployment();

  deploysData.proxy = Proxy.target;

  console.log('Proxy deployed to:', Proxy.target);
  // // arg1 factory address
  // // arg2 wnative address
  // // arg3 tokenDescriptor address
  const NonfungiblePositionManagerFactory = await hre.ethers.getContractFactory('NonfungiblePositionManager');
  let NonfungiblePositionManager = await NonfungiblePositionManagerFactory.deploy(
    deploysData.factory,
    WNativeTokenAddress,
    Proxy.target,
    deploysData.poolDeployer
  );

  NonfungiblePositionManager = await NonfungiblePositionManager.waitForDeployment();

  deploysData.nonfungiblePositionManager = NonfungiblePositionManager.target;
  console.log('NonfungiblePositionManager deployed to:', NonfungiblePositionManager.target);

  // // arg1 factory address
  // // arg2 wnative address
  // // arg3 nonfungiblePositionManager address
  // const V3MigratorFactory = await hre.ethers.getContractFactory('V3Migrator');
  // const V3Migrator = await V3MigratorFactory.deploy(
  //   deploysData.factory,
  //   WNativeTokenAddress,
  //   NonfungiblePositionManager.target,
  //   deploysData.poolDeployer
  // );

  // await V3Migrator.waitForDeployment();

  const AlgebraInterfaceMulticallFactory = await hre.ethers.getContractFactory('AlgebraInterfaceMulticall');
  let AlgebraInterfaceMulticall = await AlgebraInterfaceMulticallFactory.deploy();

  AlgebraInterfaceMulticall = await AlgebraInterfaceMulticall.waitForDeployment();

  console.log('AlgebraInterfaceMulticall deployed to:', AlgebraInterfaceMulticall.target);
  // console.log('V3Migrator deployed to:', V3Migrator.target);

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
