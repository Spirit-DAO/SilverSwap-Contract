const path = require('path');
const config = require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { FTMSCAN_API_KEY, PRIVATE_KEY, INFURA_ID_PROJECT } = config.parsed || {};

export default {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      loggingEnabled: false,
      evm: 'paris',
    },
    localHardhat: {
      url: `http://127.0.0.1:8545`,
      accounts: ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'],
    },
    localGeth: {
      url: `http://127.0.0.1:8545`,
      chainId: 1337,
      gas: 10000000,
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_ID_PROJECT}`,
    },
    sonic: {
      url: `https://rpc.soniclabs.com`,
      chainId: 146,
      accounts: [PRIVATE_KEY],
    },
    sonicBlaze: {
      url: 'https://rpc.blaze.soniclabs.com',
      chainId: 57054,
      accounts: [PRIVATE_KEY],
    },
    tenderly: {
      url: 'https://rpc.tenderly.co/fork/8518f864-9b22-4755-abf4-f7008a8fc330',
      chainId: 250,
      accounts: [PRIVATE_KEY],
    },
    ftmtest: {
      url: 'https://rpc.testnet.fantom.network/',
      chainId: 4002,
      accounts: [PRIVATE_KEY],
	},
	sonic: {
		url: "https://rpc.sonic.fantom.network/",
		chainId: 64165,
		accounts: [PRIVATE_KEY],
	},
	tenderly: {
		url: "https://rpc.tenderly.co/fork/8518f864-9b22-4755-abf4-f7008a8fc330",
		chainId: 250,
		accounts: [PRIVATE_KEY],
	},
	ftm: {
		url: "https://rpc.ftm.tools",
		chainId: 250,
		accounts: [PRIVATE_KEY],
	},
	ftmtest: {
		url: "https://rpc.testnet.fantom.network/",
		chainId: 4002,
		accounts: [PRIVATE_KEY],
	},
	ftm: {
		url: 'https://rpc.fantom.network',
		chainId: 250,
		accounts: [PRIVATE_KEY],
	},
    nibiruTestnet: {
      url: 'https://evm-rpc.testnet-1.nibiru.fi/',
      chainId: 7210,
      accounts: [PRIVATE_KEY],
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${INFURA_ID_PROJECT}`,
      chainId: 3,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${INFURA_ID_PROJECT}`,
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_ID_PROJECT}`,
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${INFURA_ID_PROJECT}`,
      chainId: 42,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
      gasPrice: 8000000000,
    },
    bscTestnet: {
      url: `https://data-seed-prebsc-2-s3.binance.org:8545`,
      chainId: 97,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    bsc: {
      url: `https://bsc-dataseed3.binance.org`,
    },
    mumbai: {
      url: `https://polygon-mumbai-bor.publicnode.com`,
      chainId: 80001,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    mantleTestnet: {
      url: `https://rpc.testnet.mantle.xyz`,
      chainId: 5001,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    mantle: {
      url: `https://rpc.mantle.xyz`,
      chainId: 5000,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    seiTestnet: {
      url: `https://evm-rpc.arctic-1.seinetwork.io`,
      chainId: 713715,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    mode: {
      url: `https://mainnet.mode.network/`,
      chainId: 34443,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    blastTestnet: {
      url: `https://blast-sepolia.blockpi.network/v1/rpc/public`,
      chainId: 168587773,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    telos: {
      url: `https://rpc3.us.telos.net/evm`,
      chainId: 40,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    telosTestnet: {
      url: `https://testnet.telos.net/evm`,
      chainId: 41,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    beraTestnet: {
      url: `https://artio.rpc.berachain.com/`,
      chainId: 80085,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    maticMainnet: {
      url: `https://rpc-mainnet.matic.quiknode.pro`,
      chainId: 137,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
      gasPrice: 50_000_000_000,
    },
    artheraTestnet: {
      url: `https://rpc-test.arthera.net`,
      chainId: 10243,
      accounts: [`0x${PRIVATE_KEY || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    },
    sourcify: {
        // Disabled by default
        // Doesn't need an API key
        enabled: true,
    },
    etherscan: {
        enabled: false,
        // Your API key for Etherscan
        // Obtain one at https://etherscan.io/
        apiKey: {
            opera: FTMSCAN_API_KEY,
            ftmTestnet: FTMSCAN_API_KEY,
            telosTestnet: FTMSCAN_API_KEY,
        },
        customChains: [
        {
            network: 'seiTestnet',
            chainId: 713715,
            urls: {
            apiURL: 'https://seitrace.com/api',
            browserURL: 'https://seitrace.com/',
            },
        },
        {
            network: 'mode',
            chainId: 34443,
            urls: {
            apiURL: 'https://explorer.mode.network/api',
            browserURL: 'https://explorer.mode.network/',
            },
        },
        {
            network: 'blastTestnet',
            chainId: 168587773,
            urls: {
            apiURL: 'https://api-sepolia.blastscan.io/api',
            browserURL: 'https://sepolia.blastscan.io/',
            },
        },
        {
            network: 'mantle',
            chainId: 5000,
            urls: {
            apiURL: 'https://explorer.mantle.xyz/api',
            browserURL: 'https://explorer.mantle.xyz/',
            },
        },
        {
            network: 'beraTestnet',
            chainId: 80085,
            urls: {
            apiURL: 'https://api.routescan.io/v2/network/testnet/evm/80085/etherscan/api/',
            browserURL: 'https://artio.beratrail.io/',
            },
        },
        {
            network: 'telosTestnet',
            chainId: 41,
            urls: {
                apiURL: 'https://sourcify.dev/server',
                browserURL: 'https://telos.net/',
            }
        },
        ],
    },
};
