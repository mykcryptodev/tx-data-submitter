"use client";

import { useState } from "react";
import {
  ConnectButton,
  useActiveAccount,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { sendAndConfirmTransaction, prepareTransaction } from "thirdweb";
import { client } from "@/lib/thirdweb";
import { defineChain } from "thirdweb/chains";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction, Transaction } from "@solana/web3.js";

// ── Types ──────────────────────────────────────────────────────────────────

type ChainType = "evm" | "solana";

interface BaseQuote {
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
}

interface EvmNormalizedData {
  chainType: "evm";
  tx: {
    data: string;
    gas: string;
    gasPrice: string;
    from: string;
    to: string;
    value: string;
  };
  quote: BaseQuote;
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

interface SolanaNormalizedData {
  chainType: "solana";
  tx: {
    from: string;
    transaction: string; // base64 encoded
  };
  quote: BaseQuote;
  chainId: number;
  fee?: {
    amount: string;
    percentage: string;
  };
  warning?: {
    code: string;
    message: string;
  };
}

type NormalizedTransactionData = EvmNormalizedData | SolanaNormalizedData;

// ── EVM input formats ──────────────────────────────────────────────────────

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
    gas_price?: string;
    gasPrice?: string;
    from: string;
    to: string;
    value?: string;
  };
  quote: {
    from_asset?: {
      name: string;
      currency_code?: string;
      currencyCode?: string;
      address: string;
      decimals: number;
    };
    fromAsset?: {
      name: string;
      currency_code?: string;
      currencyCode?: string;
      address: string;
      decimals: number;
    };
    to_asset?: {
      name: string;
      currency_code?: string;
      currencyCode?: string;
      address: string;
      decimals: number;
    };
    toAsset?: {
      name: string;
      currency_code?: string;
      currencyCode?: string;
      address: string;
      decimals: number;
    };
    from_amount?: string;
    fromAmount?: string;
    to_amount?: string;
    toAmount?: string;
    chain_id?: string;
    chainId?: string;
  };
  approve_tx?: {
    data: string;
    gas: string;
    gas_price?: string;
    gasPrice?: string;
    from: string;
    to: string;
  };
  approveTx?: {
    data: string;
    gas: string;
    gas_price?: string;
    gasPrice?: string;
    from: string;
    to: string;
  };
  fee?: {
    amount: string;
    percentage: string;
  };
}

// ── Detection & Normalization ──────────────────────────────────────────────

function detectChainType(data: unknown): ChainType {
  const obj = data as Record<string, unknown>;
  const inner = obj.result
    ? (obj.result as Record<string, unknown>)
    : obj;
  const tx = inner.tx as Record<string, unknown> | undefined;

  if (tx && "transaction" in tx && typeof tx.transaction === "string") {
    return "solana";
  }
  return "evm";
}

function normalizeSolanaData(data: unknown): SolanaNormalizedData {
  const obj = data as Record<string, unknown>;
  const inner = (obj.result ?? obj) as Record<string, unknown>;

  const tx = inner.tx as { from: string; transaction: string };
  if (!tx?.from || !tx?.transaction) {
    throw new Error("Invalid Solana transaction: missing from or transaction field");
  }

  const quote = inner.quote as Record<string, unknown>;
  const chainId = (inner.chainId ?? quote?.chainId ?? 101) as number;

  const fromAsset = (quote?.fromAsset ?? quote?.from_asset) as {
    name: string;
    currencyCode?: string;
    currency_code?: string;
    address: string;
    decimals: number;
  } | undefined;
  const toAsset = (quote?.toAsset ?? quote?.to_asset) as {
    name: string;
    currencyCode?: string;
    currency_code?: string;
    address?: string;
    decimals: number;
  } | undefined;

  if (!fromAsset || !toAsset) {
    throw new Error("Invalid Solana quote: missing asset information");
  }

  const fromAmount = (quote?.fromAmount ?? quote?.from_amount) as string;
  const toAmount = (quote?.toAmount ?? quote?.to_amount) as string;

  if (!fromAmount || !toAmount) {
    throw new Error("Invalid Solana quote: missing amounts");
  }

  const fee = inner.fee as { amount: string; percentage: string } | undefined;

  return {
    chainType: "solana",
    tx: {
      from: tx.from,
      transaction: tx.transaction,
    },
    quote: {
      fromAsset: {
        name: fromAsset.name,
        currencyCode: fromAsset.currencyCode ?? fromAsset.currency_code ?? "",
        address: fromAsset.address,
        decimals: fromAsset.decimals,
      },
      toAsset: {
        name: toAsset.name,
        currencyCode: toAsset.currencyCode ?? toAsset.currency_code ?? "",
        address: toAsset.address ?? "",
        decimals: toAsset.decimals,
      },
      fromAmount,
      toAmount,
    },
    chainId,
    fee: fee ? { amount: fee.amount, percentage: fee.percentage } : undefined,
  };
}

function normalizeEvmData(data: unknown): EvmNormalizedData {
  // Format 1: has result wrapper
  if (typeof data === "object" && data !== null && "result" in data) {
    const format1 = data as SwapServiceHttpTxData;
    return {
      chainType: "evm",
      tx: format1.result.tx,
      quote: format1.result.quote,
      approveTx: format1.result.approveTx,
      chainId: format1.result.chainId,
      warning: format1.warning,
    };
  }

  // Format 2: flat structure with snake_case
  if (typeof data === "object" && data !== null && "tx" in data && "quote" in data) {
    const format2 = data as SwapServiceGrpcTxData;

    const fromAsset = format2.quote.from_asset ?? format2.quote.fromAsset;
    const toAsset = format2.quote.to_asset ?? format2.quote.toAsset;
    const chainIdRaw = format2.quote.chain_id ?? format2.quote.chainId;
    const fromAmount = format2.quote.from_amount ?? format2.quote.fromAmount;
    const toAmount = format2.quote.to_amount ?? format2.quote.toAmount;
    const approveTx = format2.approve_tx ?? format2.approveTx;

    if (!fromAsset || !toAsset || !chainIdRaw || !fromAmount || !toAmount) {
      throw new Error("Invalid quote format: missing required quote fields");
    }

    return {
      chainType: "evm",
      tx: {
        data: format2.tx.data,
        gas: format2.tx.gas,
        gasPrice: format2.tx.gas_price ?? format2.tx.gasPrice ?? "0",
        from: format2.tx.from,
        to: format2.tx.to,
        value: format2.tx.value || "0",
      },
      quote: {
        fromAsset: {
          name: fromAsset.name,
          currencyCode: fromAsset.currency_code ?? fromAsset.currencyCode ?? "",
          address: fromAsset.address,
          decimals: fromAsset.decimals,
        },
        toAsset: {
          name: toAsset.name,
          currencyCode: toAsset.currency_code ?? toAsset.currencyCode ?? "",
          address: toAsset.address,
          decimals: toAsset.decimals,
        },
        fromAmount,
        toAmount,
      },
      approveTx: approveTx
        ? {
            data: approveTx.data,
            gas: approveTx.gas,
            gasPrice: approveTx.gas_price ?? approveTx.gasPrice ?? "0",
            from: approveTx.from,
            to: approveTx.to,
          }
        : undefined,
      chainId: parseInt(chainIdRaw, 10),
    };
  }

  throw new Error("Unrecognized JSON format");
}

function normalizeTransactionData(data: unknown): NormalizedTransactionData {
  const chainType = detectChainType(data);
  if (chainType === "solana") {
    return normalizeSolanaData(data);
  }
  return normalizeEvmData(data);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Home() {
  const [jsonInput, setJsonInput] = useState("");
  const [parsedData, setParsedData] = useState<NormalizedTransactionData | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ChainType>("evm");

  // EVM hooks
  const account = useActiveAccount();
  const switchChain = useSwitchActiveWalletChain();

  // Solana hooks
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const parseJsonData = () => {
    try {
      setError("");
      const rawData = JSON.parse(jsonInput);
      const data = normalizeTransactionData(rawData);

      if (data.chainType === "evm" && (!data.tx || !data.chainId)) {
        throw new Error("Invalid transaction data: missing required fields");
      }

      // Auto-switch tab to match detected chain type
      setActiveTab(data.chainType);
      setParsedData(data);
    } catch (err) {
      setError(`Failed to parse JSON: ${err instanceof Error ? err.message : "Unknown error"}`);
      setParsedData(null);
    }
  };

  const executeEvmTransaction = async (data: EvmNormalizedData) => {
    if (!account) {
      throw new Error("EVM wallet not connected");
    }

    const targetChain = defineChain(data.chainId);
    await switchChain(targetChain);
    setTxStatus("Switched to correct network...");

    // Execute approval transaction if present
    if (data.approveTx) {
      setTxStatus("Executing approval transaction...");

      const approvalTx = prepareTransaction({
        to: data.approveTx.to,
        data: data.approveTx.data as `0x${string}`,
        gas: BigInt(data.approveTx.gas),
        gasPrice: BigInt(data.approveTx.gasPrice),
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
      to: data.tx.to,
      data: data.tx.data as `0x${string}`,
      value: BigInt(data.tx.value),
      gas: BigInt(data.tx.gas),
      gasPrice: BigInt(data.tx.gasPrice),
      client,
      chain: targetChain,
    });

    const mainResult = await sendAndConfirmTransaction({
      transaction: mainTx,
      account,
    });

    setTxStatus(`Transaction successful! Hash: ${mainResult.transactionHash}`);
  };

  const executeSolanaTransaction = async (data: SolanaNormalizedData) => {
    if (!publicKey || !signTransaction) {
      throw new Error("Solana wallet not connected");
    }

    setTxStatus("Deserializing transaction...");

    // Decode base64 to Uint8Array
    const binaryString = atob(data.tx.transaction);
    const txBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      txBytes[i] = binaryString.charCodeAt(i);
    }

    // Try VersionedTransaction first (v0), fall back to legacy
    let transaction: VersionedTransaction | Transaction;
    try {
      transaction = VersionedTransaction.deserialize(txBytes);
    } catch {
      transaction = Transaction.from(txBytes);
    }

    setTxStatus("Signing transaction...");
    const signed = await signTransaction(transaction);

    setTxStatus("Sending transaction...");
    const serialized = signed.serialize();
    const signature = await connection.sendRawTransaction(serialized, {
      skipPreflight: true,
      maxRetries: 3,
    });

    setTxStatus("Confirming transaction...");
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    setTxStatus(`Transaction successful! Signature: ${signature}`);
  };

  const executeTransactions = async () => {
    if (!parsedData) {
      setError("No parsed data");
      return;
    }

    setIsExecuting(true);
    setTxStatus("");
    setError("");

    try {
      if (parsedData.chainType === "solana") {
        await executeSolanaTransaction(parsedData);
      } else {
        await executeEvmTransaction(parsedData);
      }
    } catch (err) {
      setError(`Transaction failed: ${err instanceof Error ? err.message : "Unknown error"}`);
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

    const fractionStr = fraction.toString().padStart(decimals, "0");
    const trimmedFraction = fractionStr.replace(/0+$/, "");
    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
  };

  const isWalletConnected =
    parsedData?.chainType === "solana" ? !!publicKey : !!account;

  const getExecuteButtonLabel = () => {
    if (isExecuting) return "Executing...";
    if (!parsedData) return "Execute Transactions";
    if (parsedData.chainType === "solana" && !publicKey) return "Connect Solana Wallet First";
    if (parsedData.chainType === "evm" && !account) return "Connect EVM Wallet First";
    return "Execute Transactions";
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

          {/* Chain Tabs + Wallet Connection */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg mb-6 overflow-hidden">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab("evm")}
                className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === "evm"
                    ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                EVM
              </button>
              <button
                onClick={() => setActiveTab("solana")}
                className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                  activeTab === "solana"
                    ? "border-b-2 border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Solana
              </button>
            </div>
            <div className="p-6 flex justify-center">
              {activeTab === "evm" ? (
                <ConnectButton client={client} />
              ) : (
                <WalletMultiButton />
              )}
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
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Transaction Preview
                </h2>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    parsedData.chainType === "solana"
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  }`}
                >
                  {parsedData.chainType === "solana" ? "Solana" : "EVM"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Swap Details - shared */}
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                    Swap Details
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">From: </span>
                      <span className="font-mono">
                        {formatAmount(parsedData.quote.fromAmount, parsedData.quote.fromAsset.decimals)}{" "}
                        {parsedData.quote.fromAsset.currencyCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">To: </span>
                      <span className="font-mono">
                        {formatAmount(parsedData.quote.toAmount, parsedData.quote.toAsset.decimals)}{" "}
                        {parsedData.quote.toAsset.currencyCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Chain ID: </span>
                      <span className="font-mono">{parsedData.chainId}</span>
                    </div>
                  </div>
                </div>

                {/* Transaction Info - chain-specific */}
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                    Transaction Info
                  </h3>
                  <div className="space-y-2 text-sm">
                    {parsedData.chainType === "evm" ? (
                      <>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">To: </span>
                          <span className="font-mono text-xs break-all">
                            {parsedData.tx.to}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Gas: </span>
                          <span className="font-mono">{parsedData.tx.gas}</span>
                        </div>
                        {parsedData.approveTx && (
                          <div className="text-green-600 dark:text-green-400">
                            Includes approval transaction
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">From: </span>
                          <span className="font-mono text-xs break-all">
                            {parsedData.tx.from}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Network: </span>
                          <span className="font-mono">
                            Solana{" "}
                            {parsedData.chainId === 101
                              ? "Mainnet"
                              : parsedData.chainId === 102
                                ? "Testnet"
                                : "Devnet"}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Transaction: </span>
                          <span className="font-mono text-xs">
                            {parsedData.tx.transaction.substring(0, 20)}...
                            {parsedData.tx.transaction.substring(
                              parsedData.tx.transaction.length - 10
                            )}
                          </span>
                        </div>
                        {parsedData.fee && (
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">Fee: </span>
                            <span className="font-mono">
                              {parsedData.fee.percentage}% ({parsedData.fee.amount})
                            </span>
                          </div>
                        )}
                      </>
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
                  disabled={!isWalletConnected || isExecuting}
                  className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
                >
                  {getExecuteButtonLabel()}
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
