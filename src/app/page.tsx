"use client";

import { useState } from "react";
import { ConnectButton, useActiveAccount, useSwitchActiveWalletChain } from "thirdweb/react";
import { sendAndConfirmTransaction, prepareTransaction } from "thirdweb";
import { client } from "@/lib/thirdweb";
import { defineChain } from "thirdweb/chains";

// Normalized internal format
interface NormalizedTransactionData {
  tx: {
    data: string;
    gas: string;
    gasPrice: string;
    from: string;
    to: string;
    value: string;
  };
  quote: {
    fromAsset: {
      name: string;
      currencyCode: string;
      address: string;
      decimals: number;
    };
    toAsset: {
      name: string;
      currencyCode: string;
      address: string;
      decimals: number;
    };
    fromAmount: string;
    toAmount: string;
    warning?: {
      type: string;
      message: string;
      description: string;
    };
  };
  approveTx?: {
    data: string;
    gas: string;
    gasPrice: string;
    from: string;
    to: string;
  };
  chainId: number;
  warning?: {
    code: string;
    message: string;
  };
}

// Format 1: result wrapper with camelCase
interface SwapServiceHttpTxData {
  result: {
    tx: {
      data: string;
      gas: string;
      gasPrice: string;
      from: string;
      to: string;
      value: string;
    };
    quote: {
      fromAsset: {
        name: string;
        currencyCode: string;
        address: string;
        decimals: number;
      };
      toAsset: {
        name: string;
        currencyCode: string;
        address: string;
        decimals: number;
      };
      fromAmount: string;
      toAmount: string;
      warning?: {
        type: string;
        message: string;
        description: string;
      };
    };
    approveTx?: {
      data: string;
      gas: string;
      gasPrice: string;
      from: string;
      to: string;
    };
    chainId: number;
  };
  warning?: {
    code: string;
    message: string;
  };
}

// Format 2: flat structure with snake_case
interface SwapServiceGrpcTxData {
  tx: {
    data: string;
    gas: string;
    gas_price: string;
    from: string;
    to: string;
    value?: string;
  };
  quote: {
    from_asset: {
      name: string;
      currency_code: string;
      address: string;
      decimals: number;
    };
    to_asset: {
      name: string;
      currency_code: string;
      address: string;
      decimals: number;
    };
    from_amount: string;
    to_amount: string;
    chain_id: string;
  };
  approve_tx?: {
    data: string;
    gas: string;
    gas_price: string;
    from: string;
    to: string;
  };
  fee?: {
    amount: string;
    percentage: string;
  };
}

function normalizeTransactionData(data: unknown): NormalizedTransactionData {
  // Check if it's Format 1 (has result wrapper)
  if (typeof data === 'object' && data !== null && 'result' in data) {
    const format1 = data as SwapServiceHttpTxData;
    return {
      tx: format1.result.tx,
      quote: format1.result.quote,
      approveTx: format1.result.approveTx,
      chainId: format1.result.chainId,
      warning: format1.warning,
    };
  }

  // Check if it's Format 2 (flat structure with snake_case)
  if (typeof data === 'object' && data !== null && 'tx' in data && 'quote' in data) {
    const format2 = data as SwapServiceGrpcTxData;
    
    return {
      tx: {
        data: format2.tx.data,
        gas: format2.tx.gas,
        gasPrice: format2.tx.gas_price,
        from: format2.tx.from,
        to: format2.tx.to,
        value: format2.tx.value || "0",
      },
      quote: {
        fromAsset: {
          name: format2.quote.from_asset.name,
          currencyCode: format2.quote.from_asset.currency_code,
          address: format2.quote.from_asset.address,
          decimals: format2.quote.from_asset.decimals,
        },
        toAsset: {
          name: format2.quote.to_asset.name,
          currencyCode: format2.quote.to_asset.currency_code,
          address: format2.quote.to_asset.address,
          decimals: format2.quote.to_asset.decimals,
        },
        fromAmount: format2.quote.from_amount,
        toAmount: format2.quote.to_amount,
      },
      approveTx: format2.approve_tx ? {
        data: format2.approve_tx.data,
        gas: format2.approve_tx.gas,
        gasPrice: format2.approve_tx.gas_price,
        from: format2.approve_tx.from,
        to: format2.approve_tx.to,
      } : undefined,
      chainId: parseInt(format2.quote.chain_id, 10),
    };
  }

  throw new Error("Unrecognized JSON format");
}

export default function Home() {
  const [jsonInput, setJsonInput] = useState("");
  const [parsedData, setParsedData] = useState<NormalizedTransactionData | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const account = useActiveAccount();
  const switchChain = useSwitchActiveWalletChain();

  const parseJsonData = () => {
    try {
      setError("");
      const rawData = JSON.parse(jsonInput);
      const data = normalizeTransactionData(rawData);
      
      // Validate required fields
      if (!data.tx || !data.chainId) {
        throw new Error("Invalid transaction data: missing required fields");
      }
      
      setParsedData(data);
    } catch (err) {
      setError(`Failed to parse JSON: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setParsedData(null);
    }
  };

  const executeTransactions = async () => {
    if (!parsedData || !account) {
      setError("No parsed data or wallet not connected");
      return;
    }

    setIsExecuting(true);
    setTxStatus("");
    setError("");

    try {
      // Switch to the correct chain
      const targetChain = defineChain(parsedData.chainId);
      await switchChain(targetChain);
      setTxStatus("Switched to correct network...");

      // Execute approval transaction if present
      if (parsedData.approveTx) {
        setTxStatus("Executing approval transaction...");
        
        const approvalTx = prepareTransaction({
          to: parsedData.approveTx.to,
          data: parsedData.approveTx.data as `0x${string}`,
          gas: BigInt(parsedData.approveTx.gas),
          gasPrice: BigInt(parsedData.approveTx.gasPrice),
          client,
          chain: targetChain,
        });

        const approvalResult = await sendAndConfirmTransaction({
          transaction: approvalTx,
          account,
        });

        setTxStatus(`Approval transaction confirmed: ${approvalResult.transactionHash}`);
      }

      // Execute main transaction
      setTxStatus("Executing main transaction...");
      
      const mainTx = prepareTransaction({
        to: parsedData.tx.to,
        data: parsedData.tx.data as `0x${string}`,
        value: BigInt(parsedData.tx.value),
        gas: BigInt(parsedData.tx.gas),
        gasPrice: BigInt(parsedData.tx.gasPrice),
        client,
        chain: targetChain,
      });

      const mainResult = await sendAndConfirmTransaction({
        transaction: mainTx,
        account,
      });

      setTxStatus(`✅ Transaction successful! Hash: ${mainResult.transactionHash}`);
      
    } catch (err) {
      setError(`Transaction failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTxStatus("");
    } finally {
      setIsExecuting(false);
    }
  };

  const formatAmount = (amount: string, decimals: number) => {
    const num = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = num / divisor;
    const fraction = num % divisor;
    
    if (fraction === BigInt(0)) {
      return whole.toString();
    }
    
    const fractionStr = fraction.toString().padStart(decimals, '0');
    const trimmedFraction = fractionStr.replace(/0+$/, '');
    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Web3 Transaction Executor
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              Connect your wallet and execute transactions from JSON data
            </p>
          </div>

          {/* Wallet Connection */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <div className="flex justify-center">
              <ConnectButton client={client} />
            </div>
          </div>

          {/* JSON Input */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Transaction JSON Data
            </h2>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="Paste your transaction JSON here..."
              className="w-full h-64 p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={parseJsonData}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Parse JSON
              </button>
              <button
                onClick={() => {
                  setJsonInput("");
                  setParsedData(null);
                  setError("");
                  setTxStatus("");
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <div className="flex">
                <div className="text-red-400 mr-3">⚠️</div>
                <div className="text-red-700 dark:text-red-300">{error}</div>
              </div>
            </div>
          )}

          {/* Transaction Preview */}
          {parsedData && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Transaction Preview
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Swap Details</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">From: </span>
                      <span className="font-mono">
                        {formatAmount(parsedData.quote.fromAmount, parsedData.quote.fromAsset.decimals)} {parsedData.quote.fromAsset.currencyCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">To: </span>
                      <span className="font-mono">
                        {formatAmount(parsedData.quote.toAmount, parsedData.quote.toAsset.decimals)} {parsedData.quote.toAsset.currencyCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Chain ID: </span>
                      <span className="font-mono">{parsedData.chainId}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Transaction Info</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">To: </span>
                      <span className="font-mono text-xs break-all">{parsedData.tx.to}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Gas: </span>
                      <span className="font-mono">{parsedData.tx.gas}</span>
                    </div>
                    {parsedData.approveTx && (
                      <div className="text-green-600 dark:text-green-400">
                        ✓ Includes approval transaction
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {(parsedData.quote.warning || parsedData.warning) && (
                <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <div className="flex items-start">
                    <div className="text-yellow-400 mr-2">⚠️</div>
                    <div>
                      {parsedData.quote.warning && (
                        <div className="text-yellow-700 dark:text-yellow-300 text-sm mb-1">
                          <strong>{parsedData.quote.warning.message}</strong>
                          <br />
                          {parsedData.quote.warning.description}
                        </div>
                      )}
                      {parsedData.warning && (
                        <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                          {parsedData.warning.message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Execute Button */}
              <div className="mt-6">
                <button
                  onClick={executeTransactions}
                  disabled={!account || isExecuting}
                  className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
                >
                  {isExecuting ? "Executing..." : !account ? "Connect Wallet First" : "Execute Transactions"}
                </button>
              </div>
            </div>
          )}

          {/* Transaction Status */}
          {txStatus && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center">
                <div className="text-blue-400 mr-3">ℹ️</div>
                <div className="text-blue-700 dark:text-blue-300">{txStatus}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}