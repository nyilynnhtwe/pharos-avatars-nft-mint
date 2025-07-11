import { useState, useEffect } from "react";
import { ethers } from "ethers";
import nftAbi from "./ABI.json";
import metadata from "./all_metadata.json";
import "./App.css";
import type { NFT } from "./types";
import { BASE_URI, blockExplorerUrl, CONTRACT_ADDRESS, MINT_PRICE, PHAROS_TESTNET_CHAIN_ID, rpcUrls } from "./constant";





declare global {
  interface Window {
    ethereum?: any;
  }
}


function App() {
  // Existing state declarations remain the same
  const [walletAddress, setWalletAddress] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<{ type: "idle" | "success" | "error" | "loading"; message: string }>({
    type: "idle",
    message: "",
  });
  const [tokenCounter, setTokenCounter] = useState(0);
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [balance, setBalance] = useState<string>("0");
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [ownedNFTs, setOwnedNFTs] = useState<NFT[]>([]);


  useEffect(() => {
    fetchNFTStatus();
  }, []);


  // Check if wallet is already connected on load
  useEffect(() => {
    const checkWalletConnection = async () => {
      if (window.ethereum?.isMetaMask) {
        try {
          const accounts = await window.ethereum.request({ method: "eth_accounts" });
          if (accounts.length > 0) {
            setWalletAddress(accounts[0]);
            setIsConnected(true);
            await fetchBalance(accounts[0]);
          }
        } catch (error) {
          console.error("Failed to check wallet connection:", error);
        }
      }
    };

    checkWalletConnection();
  }, []);


  const fetchOwnedNFTs = async (address: string) => {
    if (!window.ethereum) return;
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, nftAbi.abi, provider);

      const counter = await contract.tokenCounter();
      const totalMinted = Number(counter);

      const ownedList: NFT[] = [];

      for (let i = 0; i < totalMinted; i++) {
        try {
          const owner = await contract.ownerOf(i);
          if (owner.toLowerCase() === address.toLowerCase()) {
            const nftData = metadata[i]; // assuming your metadata array is indexed by tokenId
            ownedList.push({
              tokenId: i,
              ...nftData,
              isMinted: true,
              isMintable: false, // Owned NFTs are not mintable
            });
          }
        } catch (err) {
          // tokenId not minted yet; skip
        }
      }

      setOwnedNFTs(ownedList);
    } catch (error) {
      console.error("Failed to fetch owned NFTs:", error);
    }
  };


  // Fetch user's PHRS balance
  const fetchBalance = async (address: string) => {
    setIsCheckingBalance(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const balanceWei = await provider.getBalance(address);
      const balanceEth = ethers.formatEther(balanceWei);
      setBalance(Number(balanceEth).toFixed(4));
    } catch (error) {
      console.error("Failed to fetch balance:", error);
      setStatus({ type: "error", message: "Failed to fetch balance" });
    } finally {
      setIsCheckingBalance(false);
    }
  };

  // Connect to MetaMask and switch to Pharos testnet
  async function connectWallet() {
    try {
      if (!window.ethereum) throw new Error("MetaMask not detected");

      setStatus({ type: "loading", message: "Connecting wallet..." });
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setWalletAddress(accounts[0]);
      setIsConnected(true);

      await switchToPharosNetwork();
      await fetchBalance(accounts[0]);
      await fetchOwnedNFTs(accounts[0]);
      setStatus({ type: "success", message: "Connected to Pharos Testnet!" });
      fetchNFTStatus();
    } catch (error: any) {
      setStatus({ type: "error", message: error.message || "Connection failed" });
    }
  }

  // Switch to Pharos network
  async function switchToPharosNetwork() {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: PHAROS_TESTNET_CHAIN_ID }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await addPharosNetwork();
      } else {
        throw new Error("Failed to switch network");
      }
    }
  }

  // Add Pharos network to MetaMask
  async function addPharosNetwork() {
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: PHAROS_TESTNET_CHAIN_ID,
            chainName: "Pharos Testnet",
            rpcUrls,
            nativeCurrency: {
              name: "Pharos",
              symbol: "PHRS",
              decimals: 18,
            },
            blockExplorerUrls: [blockExplorerUrl],
          },
        ],
      });
    } catch (addError) {
      throw new Error("Failed to add Pharos network");
    }
  }

  // Fetch tokenCounter and NFT status
  async function fetchNFTStatus() {
    try {
      if (!window.ethereum) throw new Error("MetaMask not installed");

      setStatus({ type: "loading", message: "Loading NFTs..." });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, nftAbi.abi, provider);
      const counter = await contract.tokenCounter();
      const tokenCounterValue = Number(counter);
      setTokenCounter(tokenCounterValue);
      const nftList: NFT[] = await Promise.all(
        metadata.slice(0, 133).map(async (nft, index) => {
          let isMinted = false;
          let isMintable = false; // Add this

          try {
            const uri = await contract.tokenURI(index);
            isMinted = !!uri;
          } catch (err) {
            isMinted = false;
            isMintable = true; // All unminted NFTs are mintable
          }

          return {
            tokenId: index,
            ...nft,
            isMinted,
            isMintable, // Add this property
          };
        })
      );


      setNfts(nftList);
      setStatus({ type: "success", message: "NFTs loaded successfully!" });
    } catch (error: any) {
      setStatus({ type: "error", message: `Error fetching NFTs: ${error.message}` });
    }
  }

  // Mint NFT
  async function mintNFT(tokenId: number) {
    // Check if user has sufficient balance
    const mintPriceEth = parseFloat(MINT_PRICE);
    const userBalance = parseFloat(balance);

    if (userBalance < mintPriceEth) {
      setStatus({
        type: "error",
        message: `Insufficient balance! You need at least ${MINT_PRICE} PHRS to mint`
      });
      return;
    }

    try {
      setIsMinting(true);
      setStatus({ type: "loading", message: `Starting mint for NFT #${tokenId}...` });

      if (!window.ethereum) throw new Error("MetaMask not detected");

      // Verify network
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      console.log(chainId);

      if (chainId !== PHAROS_TESTNET_CHAIN_ID) {
        await switchToPharosNetwork();
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, nftAbi.abi, signer);

      const tokenURI = `${BASE_URI}${tokenId}.json`;

      setStatus({ type: "loading", message: "Confirm transaction in MetaMask..." });
      const tx = await contract.mintNFT(tokenURI, {
        value: ethers.parseEther(MINT_PRICE),
      });

      setStatus({ type: "loading", message: "Processing transaction..." });
      await tx.wait();

      setStatus({ type: "success", message: `NFT #${tokenId} minted successfully!` });

      // Refresh data after minting
      await fetchBalance(walletAddress);
      await fetchNFTStatus();
    } catch (error: any) {
      setStatus({ type: "error", message: error.reason || error.message || "Minting failed" });
    } finally {
      setIsMinting(false);
    }
  }

  // Shorten wallet address for display
  const formatAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // Refresh balance
  const handleRefreshBalance = async () => {
    if (isConnected) {
      await fetchBalance(walletAddress);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-indigo-900 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Enhanced Header */}
        <div className="text-center py-10 relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://uploads-ssl.webflow.com/62e3ee10882dc50bcae8d07a/631a5d4631d4c55a475f3e34_noise.gif')] opacity-20"></div>
          <div className="relative z-10">
            <div className="inline-block mb-4">
              <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-0.5 rounded-full">
                <div className="bg-gray-900 px-4 py-1 rounded-full text-xs font-bold text-purple-300">
                  EXCLUSIVE COLLECTION
                </div>
              </div>
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-indigo-300 to-cyan-300 mb-3">
              Pharos Avatars
            </h1>
            <p className="text-lg text-indigo-200 max-w-2xl mx-auto">
              Collect unique digital avatars minted on the Pharos blockchain. Each NFT unlocks special community benefits.
            </p>
          </div>
        </div>

        {/* Wallet Connection & Balance - Enhanced */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl p-6 mb-10 border border-indigo-500/20 relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://uploads-ssl.webflow.com/62e3ee10882dc50bcae8d07a/631a5d4631d4c55a475f3e34_noise.gif')] opacity-10"></div>
          <div className="relative z-10">
            {!isConnected ? (
              <button
                onClick={connectWallet}
                className="w-full group relative bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4 rounded-xl hover:opacity-90 transition-all shadow-lg hover:shadow-indigo-500/30 flex items-center justify-center gap-3 font-medium text-lg"
                disabled={status.type === "loading"}
              >
                {status.type === "loading" ? (
                  <>
                    <span className="animate-spin h-6 w-6 border-3 border-white border-t-transparent rounded-full"></span>
                    Connecting...
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-[url('https://uploads-ssl.webflow.com/62e3ee10882dc50bcae8d07a/631a5d4631d4c55a475f3e34_noise.gif')] opacity-20"></div>
                    <span className="relative z-10 flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22 12l-4-4v3H3v2h15v3l4-4z" />
                      </svg>
                      Connect Wallet
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-green-500 rounded-full blur-[8px] opacity-60"></div>
                    <div className="bg-green-500 w-3 h-3 rounded-full relative z-10"></div>
                  </div>
                  <div>
                    <p className="font-medium text-gray-400 text-sm">Connected as</p>
                    <p className="text-white font-mono flex items-center gap-2">
                      {formatAddress(walletAddress)}
                      <button
                        onClick={() => navigator.clipboard.writeText(walletAddress)}
                        className="text-indigo-400 hover:text-indigo-200 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M8 4H4a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4" strokeWidth="2" />
                          <rect x="8" y="4" width="12" height="12" rx="2" strokeWidth="2" />
                        </svg>
                      </button>
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-1 rounded-xl border border-indigo-500/20">
                  <div className="bg-gray-900/80 p-3 rounded-lg flex items-center gap-4">
                    <div>
                      <p className="text-gray-400 text-sm flex items-center gap-1">
                        <span>Balance</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                        </svg>
                      </p>
                      <p className="text-white font-bold text-xl flex items-center">
                        {isCheckingBalance ? (
                          <span className="inline-block h-6 w-16 bg-gray-700 rounded animate-pulse"></span>
                        ) : (
                          <>
                            {balance} <span className="text-indigo-400 ml-1">PHRS</span>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={handleRefreshBalance}
                      className="bg-indigo-900/50 p-2 rounded-lg hover:bg-indigo-800/50 transition-colors"
                      disabled={isCheckingBalance}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className={`h-5 w-5 text-indigo-400 ${isCheckingBalance ? "animate-spin" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-600/30 to-indigo-600/30 px-5 py-3 rounded-xl border border-indigo-500/30">
                  <p className="text-sm text-gray-300">
                    Next to mint:
                  </p>
                  <p className="text-xl font-bold text-white mt-1">#{tokenCounter}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status Indicator - Enhanced */}
        {status.type !== "idle" && (
          <div
            className={`mb-8 p-4 rounded-xl border ${status.type === "error"
              ? "bg-red-900/20 border-red-700/50 text-red-300"
              : status.type === "success"
                ? "bg-green-900/20 border-green-700/50 text-green-300"
                : "bg-indigo-900/20 border-indigo-700/50 text-indigo-300"
              }`}
          >
            <div className="flex items-center gap-3">
              {status.type === "loading" ? (
                <span className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full"></span>
              ) : status.type === "success" ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              )}
              <span>{status.message}</span>
            </div>
          </div>
        )}

        {/* NFT Grid - Enhanced */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {nfts.map((nft) => (
            <div
              key={nft.tokenId}
              className={`group relative bg-gradient-to-b from-gray-800 to-gray-900 rounded-xl overflow-hidden border-2 ${nft.isMinted
                ? "border-green-500/20"
                : nft.isMintable
                  ? "border-purple-500 shadow-lg shadow-purple-500/10"
                  : "border-gray-700"
                } transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}
            >
              <div className="relative">
                <div className="overflow-hidden">
                  <img
                    src={nft.image}
                    alt={nft.name}
                    className="w-full h-52 object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="absolute top-3 right-3 bg-black/80 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-medium">
                  #{nft.tokenId}
                </div>
                <div
                  className={`absolute top-3 left-3 px-3 py-1 rounded-full text-sm font-medium ${nft.isMinted
                    ? "bg-green-900/80 text-green-200"
                    : nft.isMintable
                      ? "bg-gradient-to-r from-purple-600/80 to-indigo-600/80 text-purple-100"
                      : "bg-gray-700/80 text-gray-400"
                    }`}
                >
                  {nft.isMinted ? "Minted" : nft.isMintable ? "Available" : "Coming Soon"}
                </div>
              </div>

              <div className="p-4">
                <h2 className="text-lg font-bold text-white mb-1 truncate">{nft.name}</h2>
                <p className="text-gray-400 text-sm mb-4 line-clamp-2 min-h-[40px]">{nft.description}</p>

                {!nft.isMinted && nft.isMintable && (
                  <button
                    onClick={() => mintNFT(nft.tokenId)}
                    disabled={isMinting || parseFloat(balance) < parseFloat(MINT_PRICE)}
                    className={`w-full py-3 rounded-lg font-medium transition-all relative overflow-hidden ${isMinting || parseFloat(balance) < parseFloat(MINT_PRICE)
                      ? "bg-gray-700/50 text-gray-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-purple-600 to-indigo-700 text-white hover:opacity-90 hover:shadow-md hover:shadow-purple-500/20"
                      }`}
                  >
                    <div className="absolute inset-0 bg-[url('https://uploads-ssl.webflow.com/62e3ee10882dc50bcae8d07a/631a5d4631d4c55a475f3e34_noise.gif')] opacity-10"></div>
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {isMinting ? (
                        <>
                          <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                          Minting...
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                          </svg>
                          Mint ({MINT_PRICE} PHRS)
                        </>
                      )}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {ownedNFTs.length > 0 && (
          <div className="mt-16">
            <h2 className="text-3xl font-bold text-white mb-4">Your Minted NFTs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {ownedNFTs.map((nft) => (
                <div
                  key={nft.tokenId}
                  className="bg-gray-800 rounded-xl p-4 border border-green-600/30"
                >
                  <img
                    src={nft.image}
                    alt={nft.name}
                    className="w-full h-48 object-cover rounded mb-3"
                  />
                  <h3 className="text-white font-semibold">{nft.name}</h3>
                  <p className="text-sm text-gray-400 mb-1">#{nft.tokenId}</p>
                  <p className="text-xs text-green-300">You Own This</p>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* Network Information - Enhanced */}
        <div className="mt-16 pt-8 border-t border-gray-700 text-center">
          <div className="inline-flex items-center gap-2 bg-gray-800/50 px-4 py-2 rounded-full border border-gray-700">
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
            <p className="text-gray-400 text-sm">
              Connected to Pharos Testnet
            </p>
          </div>
          <p className="text-gray-600 text-xs mt-4">
            Contract: {formatAddress(CONTRACT_ADDRESS)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;