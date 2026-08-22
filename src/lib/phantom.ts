/** Phantom devnet USDC payment helper.
 *
 *  The one function that matters is `payWithPhantom`: it builds the exact
 *  transaction the backend verifier expects — an SPL TransferChecked of the
 *  configured USDC amount to the merchant's ATA, plus a memo instruction
 *  carrying the SHA-256 of the analysis — signs it with the user's Phantom
 *  wallet, waits for devnet confirmation, and returns the transaction
 *  signature.
 *
 *  Nothing here trusts the browser about anything financial. The backend
 *  re-fetches the transaction from the RPC and checks every field again
 *  before writing the payment ledger.
 */

import { Buffer } from 'buffer'
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  type SendOptions,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'

// The SPL memo program (v3). The verifier accepts the legacy id too, but this
// is the one the current SDK builds against.
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

type PhantomProvider = {
  publicKey: PublicKey | null
  isPhantom?: boolean
  connect: () => Promise<{ publicKey: PublicKey }>
  signAndSendTransaction: (tx: Transaction, opts?: SendOptions) =>
    Promise<{ signature: string } | string>
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider }
    solana?: PhantomProvider
  }
}

// Buffer needs to exist on window for @solana/spl-token in the browser.
if (typeof window !== 'undefined' && !window.Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
}

export interface PaymentRequirements {
  amount: string          // base units, as a string per x402
  asset: string           // mint address
  assetDecimals: number
  payTo: string           // recipient wallet
  network: string         // CAIP-2 id, e.g. "solana:EtWTRABZaYq..."
  extra: {
    memo: string
    network?: string      // "devnet"
    rpcUrl?: string       // e.g. "https://api.devnet.solana.com"
  }
  resource: string
}

export class PhantomError extends Error {
  constructor(message: string, public code: 'not-installed' | 'user-cancelled'
    | 'rpc-error' | 'signature-failed' | 'confirm-failed' | 'unknown' = 'unknown') {
    super(message)
    this.name = 'PhantomError'
  }
}

export function getPhantom(): PhantomProvider {
  if (typeof window === 'undefined') {
    throw new PhantomError('Phantom is only available in the browser.', 'not-installed')
  }
  const provider = window.phantom?.solana ?? window.solana
  if (!provider || !provider.isPhantom) {
    throw new PhantomError(
      'Phantom wallet extension not found. Install Phantom (phantom.app) and refresh this page.',
      'not-installed',
    )
  }
  return provider
}

export async function connectPhantom(): Promise<string> {
  const provider = getPhantom()
  const conn = provider.publicKey
    ? { publicKey: provider.publicKey }
    : await provider.connect().catch(err => {
        throw new PhantomError(
          err instanceof Error ? err.message : 'Phantom connect was rejected.',
          'user-cancelled')
      })
  return conn.publicKey.toBase58()
}

export async function payWithPhantom(
  requirements: PaymentRequirements,
): Promise<{ signature: string; payer: string }> {
  const provider = getPhantom()
  const rpcUrl = requirements.extra.rpcUrl || 'https://api.devnet.solana.com'
  const connection = new Connection(rpcUrl, 'confirmed')

  const conn = provider.publicKey
    ? { publicKey: provider.publicKey }
    : await provider.connect().catch(err => {
        throw new PhantomError(
          err instanceof Error ? err.message : 'Phantom connect was rejected.',
          'user-cancelled')
      })
  const payer = conn.publicKey

  let mint: PublicKey
  let merchant: PublicKey
  try {
    mint = new PublicKey(requirements.asset)
    merchant = new PublicKey(requirements.payTo)
  } catch (error) {
    throw new PhantomError(
      `Bad payment requirements: ${(error as Error).message}`, 'unknown')
  }

  const payerAta = getAssociatedTokenAddressSync(mint, payer)
  const merchantAta = getAssociatedTokenAddressSync(mint, merchant)

  const tx = new Transaction()

  // Only create the merchant's ATA if it doesn't exist. In devnet the merchant
  // wallet may not yet hold this mint's token account.
  let merchantAtaExists = true
  try {
    const info = await connection.getAccountInfo(merchantAta, 'confirmed')
    merchantAtaExists = info !== null
  } catch (error) {
    throw new PhantomError(
      `Could not reach devnet RPC (${rpcUrl}): ${(error as Error).message}`,
      'rpc-error')
  }
  if (!merchantAtaExists) {
    tx.add(createAssociatedTokenAccountInstruction(
      payer, merchantAta, merchant, mint,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ))
  }

  // Memo first, then transfer — the verifier only cares that both are in the
  // same transaction; ordering is not a constraint on-chain.
  tx.add(new TransactionInstruction({
    keys: [], programId: MEMO_PROGRAM_ID,
    data: Buffer.from(requirements.extra.memo, 'utf8'),
  }))

  tx.add(createTransferCheckedInstruction(
    payerAta, mint, merchantAta, payer,
    BigInt(requirements.amount), requirements.assetDecimals, [],
    TOKEN_PROGRAM_ID,
  ))

  let latest
  try {
    latest = await connection.getLatestBlockhash('confirmed')
  } catch (error) {
    throw new PhantomError(
      `Could not fetch a devnet blockhash: ${(error as Error).message}`,
      'rpc-error')
  }
  tx.recentBlockhash = latest.blockhash
  tx.feePayer = payer

  let sent
  try {
    sent = await provider.signAndSendTransaction(tx)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Phantom refused to sign.'
    // Phantom throws `WalletSignTransactionError` when the user cancels.
    if (/user\s*rejected|reject/i.test(msg)) {
      throw new PhantomError('You cancelled the Phantom signature request.', 'user-cancelled')
    }
    throw new PhantomError(msg, 'signature-failed')
  }
  const signature = typeof sent === 'string' ? sent : sent.signature

  try {
    await connection.confirmTransaction({
      signature, blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed')
  } catch (error) {
    throw new PhantomError(
      `Transaction was signed but did not confirm on devnet: ${(error as Error).message}`,
      'confirm-failed')
  }

  return { signature, payer: payer.toBase58() }
}
