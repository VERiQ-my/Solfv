"use client";

import { Buffer } from "buffer";
import { useState } from "react";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const merchantWallet = new PublicKey("GG8RDLrDoBfvdqZuJrRT2xFsVAE7R2MKsGzCrpMHSzwP");
const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

type PhantomProvider = {
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string } | string>;
};

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}

type Requirements = { amount: string; asset: string; payTo: string; network: string; extra: { memo: string } };
type PaymentResult = {
  status: string;
  payment_mode: string;
  verify_hash: string;
  message: string;
  payment?: { transaction_signature: string; payer_wallet: string };
};
type MarketSnapshot = {
  asset: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  change_24h_percent: number;
  trending_pools: Array<{ name: string; price_change_24h: string; volume_24h_usd: string; liquidity_usd: string }>;
  source: string[];
  timestamp: string;
  disclaimer: string;
};
type CryptoAsset = {
  id: string; symbol: string; name: string; image: string; rank: number; price_usd: number;
  market_cap_usd: number; volume_24h_usd: number; change_24h_percent: number | null; change_7d_percent: number | null;
};
type CryptoSnapshot = { assets: CryptoAsset[]; universe: string; source: string; timestamp: string; disclaimer: string };
type PaperOrder = { order_id: string; asset_id: string; notional_usd: number; reference_price_usd: number; simulated_quantity: number; payment_transaction_signature: string; disclaimer: string };

const verifyResult = {
  revenue: { value: 1000000, currency: "MYR", period: "FY2025" },
  source: { page: 4, method: "table-extraction", confidence: 0.98 },
};

function getPhantom(): PhantomProvider {
  const provider = window.phantom?.solana ?? window.solana;
  if (!provider) throw new Error("Phantom is not installed. Open this page in a browser with Phantom enabled.");
  return provider;
}

export default function Home() {
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [crypto, setCrypto] = useState<CryptoSnapshot | null>(null);
  const [cryptoFilter, setCryptoFilter] = useState("all");
  const [paperOrder, setPaperOrder] = useState<PaperOrder | null>(null);
  const [selectedAsset, setSelectedAsset] = useState("solana");
  const [notionalUsd, setNotionalUsd] = useState("10");
  const [purchaseResourceKey, setPurchaseResourceKey] = useState<string | null>(null);

  async function requestAnalysis() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${apiBaseUrl}/v1/reports/demo-report/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify_result: verifyResult }),
      });
      const body = await response.json();
      if (response.status === 402) {
        setRequirements(body.detail.paymentRequirements);
        return;
      }
      if (!response.ok) throw new Error(body.detail ?? "The analysis request failed.");
      setResult(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function payWithPhantom() {
    if (!requirements) return;
    setBusy(true);
    setError(null);
    try {
      const provider = getPhantom();
      const connection = new Connection(rpcUrl, "confirmed");
      const connected = provider.publicKey ? { publicKey: provider.publicKey } : await provider.connect();
      const payer = connected.publicKey;
      setWalletAddress(payer.toBase58());

      const payerTokenAccount = getAssociatedTokenAddressSync(usdcMint, payer);
      const merchantTokenAccount = getAssociatedTokenAddressSync(usdcMint, merchantWallet);
      const transaction = new Transaction();
      if (!(await connection.getAccountInfo(merchantTokenAccount, "confirmed"))) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            payer, merchantTokenAccount, merchantWallet, usdcMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }
      transaction.add(
        new TransactionInstruction({ keys: [], programId: memoProgram, data: Buffer.from(requirements.extra.memo, "utf8") }),
        createTransferCheckedInstruction(
          payerTokenAccount, usdcMint, merchantTokenAccount, payer, BigInt(requirements.amount), 6, [], TOKEN_PROGRAM_ID,
        ),
      );

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = payer;
      const sent = await provider.signAndSendTransaction(transaction);
      const signature = typeof sent === "string" ? sent : sent.signature;
      await connection.confirmTransaction(
        { signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight },
        "confirmed",
      );

      if (!purchaseResourceKey) throw new Error("Prepare the paper purchase before paying.");
      const verificationResponse = await fetch(`${apiBaseUrl}/v1/reports/${purchaseResourceKey}/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify_result: verifyResult, transaction_signature: signature }),
      });
      const verificationBody = await verificationResponse.json();
      if (!verificationResponse.ok) throw new Error(verificationBody.detail ?? "The payment could not be verified.");

      const orderResponse = await fetch(`${apiBaseUrl}/v1/reports/${purchaseResourceKey}/paper-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify_result: verifyResult, asset_id: selectedAsset, notional_usd: Number(notionalUsd) }),
      });
      const orderBody = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderBody.detail ?? "The paper order could not be created.");
      setPaperOrder({ ...orderBody, payment_transaction_signature: verificationBody.payment.transaction_signature });
      setRequirements(null);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Payment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMarket() {
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/v1/market/solana`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "Live market data could not be loaded.");
      setMarket(body);
    } catch (marketError) {
      setError(marketError instanceof Error ? marketError.message : "Market request failed.");
    }
  }

  async function loadCrypto() {
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/v1/market/crypto`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "Crypto market data could not be loaded.");
      setCrypto(body);
    } catch (cryptoError) {
      setError(cryptoError instanceof Error ? cryptoError.message : "Crypto market request failed.");
    }
  }

  async function createPaperOrder() {
    setBusy(true);
    setError(null);
    try {
      const resourceKey = `demo-report-purchase-${selectedAsset}-${notionalUsd}`;
      setPurchaseResourceKey(resourceKey);
      const response = await fetch(`${apiBaseUrl}/v1/reports/${resourceKey}/paper-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify_result: verifyResult, asset_id: selectedAsset, notional_usd: Number(notionalUsd) }),
      });
      const body = await response.json();
      if (response.status === 402) {
        setRequirements(body.detail.paymentRequirements);
        return;
      }
      if (!response.ok) throw new Error(body.detail ?? "The paper order could not be created.");
      setPaperOrder(body);
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "Paper order failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">SOLFV / AGENT API</p><h1>Verified analysis access</h1></div>
        <span className="mode-badge">LIVE DEVNET X402</span>
      </header>
      <section className="workspace">
        <div className="intro">
          <p className="section-label">PAID RESOURCE</p>
          <h2>Financial report analysis</h2>
          <p>The API challenges unpaid requests with HTTP 402. Phantom signs a devnet USDC payment containing the verification memo before the analysis is unlocked.</p>
          {walletAddress && <p className="muted">Connected wallet: {walletAddress}</p>}
          <button className="primary-button" onClick={() => void requestAnalysis()} disabled={busy}>{busy ? "Checking access..." : "Request analysis"}</button>
        </div>
        <div className="status-panel" aria-live="polite">
          <div className="panel-heading"><span>Payment status</span><span className="status-dot" /></div>
          {!requirements && !result && <p className="muted">No payment challenge yet.</p>}
          {requirements && <div className="challenge">
            <div className="challenge-header"><strong>402 Payment Required</strong><span className="devnet-label">DEVNET</span></div>
            <dl>
              <div><dt>Amount</dt><dd>{Number(requirements.amount) / 1_000_000} USDC</dd></div>
              <div><dt>Network</dt><dd>{requirements.network}</dd></div>
              <div><dt>Asset</dt><dd>{requirements.asset}</dd></div>
              <div><dt>Memo</dt><dd>{requirements.extra.memo}</dd></div>
            </dl>
            <p className="simulation-note">Phantom will request a real devnet USDC payment. The crypto purchase remains simulated.</p>
            <button className="secondary-button" onClick={() => void payWithPhantom()} disabled={busy}>{busy ? "Sending and verifying..." : "Connect Phantom & pay"}</button>
          </div>}
          {result && <div className="success-state">
            <span className="success-icon">OK</span><strong>Analysis unlocked</strong><p>{result.message}</p>
            {result.payment?.transaction_signature && <code>Transaction: {result.payment.transaction_signature}</code>}
            <code>{result.verify_hash}</code>
          </div>}
          {result && !paperOrder && <div className="paper-order-form">
            <strong>Simulate a crypto purchase</strong>
            <p className="muted">Uses live market pricing. No cryptocurrency will be purchased or transferred.</p>
            <label>Asset<select value={selectedAsset} onChange={(event) => setSelectedAsset(event.target.value)}><option value="solana">Solana (SOL)</option><option value="bitcoin">Bitcoin (BTC)</option><option value="ethereum">Ethereum (ETH)</option></select></label>
            <label>Paper amount (USD)<input type="number" min="1" max="10000" value={notionalUsd} onChange={(event) => setNotionalUsd(event.target.value)} /></label>
            <button className="secondary-button" onClick={() => void createPaperOrder()} disabled={busy}>{busy ? "Preparing payment..." : "Prepare purchase payment"}</button>
          </div>}
          {paperOrder && <div className="success-state paper-receipt"><strong>Paper order created</strong><p>{paperOrder.asset_id} · ${paperOrder.notional_usd} at ${paperOrder.reference_price_usd} reference price</p><code>Quantity: {paperOrder.simulated_quantity.toFixed(8)}</code><code>Order: {paperOrder.order_id}</code><p className="market-disclaimer">{paperOrder.disclaimer}</p></div>}
          {error && <p className="error-message">{error}</p>}
        </div>
      </section>
      <section className="market-section">
        <div className="market-heading">
          <div><p className="section-label">LIVE SOLANA MARKET</p><h2>Market intelligence</h2></div>
          <button className="secondary-button market-button" onClick={() => void loadMarket()}>Refresh live data</button>
        </div>
        {!market && <p className="muted">Load current SOL market and on-chain pool data.</p>}
        {market && <>
          <div className="market-grid">
            <div><span>Price</span><strong>${market.price_usd.toLocaleString()}</strong></div>
            <div><span>24h change</span><strong className={market.change_24h_percent >= 0 ? "positive" : "negative"}>{market.change_24h_percent.toFixed(2)}%</strong></div>
            <div><span>Market cap</span><strong>${(market.market_cap_usd / 1e9).toFixed(2)}B</strong></div>
            <div><span>24h volume</span><strong>${(market.volume_24h_usd / 1e9).toFixed(2)}B</strong></div>
          </div>
          <p className="market-disclaimer">{market.disclaimer}</p>
          <p className="market-meta">Updated {new Date(market.timestamp).toLocaleString()} · {market.source.join(" · ")}</p>
          <div className="pool-list"><strong>Trending Solana pools</strong>{market.trending_pools.map((pool) => <div className="pool-row" key={pool.name}><span>{pool.name}</span><span>{pool.price_change_24h}% · ${Number(pool.volume_24h_usd).toLocaleString()} volume</span></div>)}</div>
        </>}
      </section>
      <section className="market-section">
        <div className="market-heading">
          <div><p className="section-label">CRYPTO UNIVERSE</p><h2>Top digital assets</h2></div>
          <button className="secondary-button market-button" onClick={() => void loadCrypto()}>Load live crypto</button>
        </div>
        {!crypto && <p className="muted">Ranked live by market capitalization.</p>}
        {crypto && <>
          <div className="filter-row">
            {["all", "gainers", "losers"].map((filter) => <button key={filter} className={cryptoFilter === filter ? "filter-active" : "filter-button"} onClick={() => setCryptoFilter(filter)}>{filter}</button>)}
          </div>
          <div className="crypto-table"><div className="crypto-row crypto-header"><span># / Asset</span><span>Price</span><span>24h</span><span>Market cap</span></div>
            {crypto.assets.filter((asset) => cryptoFilter === "all" || (cryptoFilter === "gainers" ? (asset.change_24h_percent ?? 0) >= 0 : (asset.change_24h_percent ?? 0) < 0)).slice(0, 20).map((asset) => <div className="crypto-row" key={asset.id}><span><b>{asset.rank}</b> {asset.name} <small>{asset.symbol.toUpperCase()}</small></span><span>${asset.price_usd.toLocaleString()}</span><span className={(asset.change_24h_percent ?? 0) >= 0 ? "positive" : "negative"}>{asset.change_24h_percent?.toFixed(2) ?? "-"}%</span><span>${(asset.market_cap_usd / 1e9).toFixed(2)}B</span></div>)}
          </div>
          <p className="market-meta">{crypto.universe} · Updated {new Date(crypto.timestamp).toLocaleString()} · {crypto.source}</p>
          <p className="market-disclaimer">{crypto.disclaimer}</p>
        </>}
      </section>
    </main>
  );
}
