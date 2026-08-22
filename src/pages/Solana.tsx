/** Solana Investments — the settlement surface, and what is actually on chain.
 *
 *  The design's version of this screen totals an AUM figure and streams a
 *  payroll. This build holds no assets and runs no payroll program, so those
 *  panels would be decoration with a currency symbol in front. What SOLFV does
 *  have on chain is real and is what this page shows: a metering model, a
 *  treasury account, and a live cluster reading.
 *
 *  Every figure here is either read from the RPC or explicitly withheld with
 *  the reason attached. On a page about settlement, an invented balance would
 *  be the one number nobody could trace.
 */

import { useEffect, useState } from 'react'
import {
  Card, Empty, Icon, NotConfigured, PageIntro, Spinner, Stat,
} from '../components/ui'
import { api } from '../lib/api'
import { useSession } from '../state'
import type {
  PaperStatus, PaymentQuote, PaymentRecord, SolanaNetwork,
} from '../types'

export default function Solana() {
  const { analysis, documents } = useSession()
  const [quote, setQuote] = useState<PaymentQuote | null>(null)
  const [network, setNetwork] = useState<SolanaNetwork | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    Promise.all([api.quote(), api.network()])
      .then(([nextQuote, nextNetwork]) => {
        if (!live) return
        setQuote(nextQuote)
        setNetwork(nextNetwork)
      })
      .catch(caught => live && setError(
        caught instanceof Error ? caught.message : String(caught)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [])

  const gated = quote?.required ?? false
  const analysed = documents.filter(doc => doc.status === 'ready').length

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow="Commercial model"
        title="Solana Investments"
        lede="One report, one payment, settled on chain. No seats, no subscription, no minimum commitment — the unit of value is a document analysed."
      />

      {error && (
        <div className="flex items-start gap-md p-md rounded-lg border border-danger/30 bg-danger/5">
          <Icon name="error" className="text-danger shrink-0" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">Could not reach the engine.</b>
            <p className="text-body-sm text-on-surface-variant mt-xs break-words">{error}</p>
          </div>
        </div>
      )}

      {loading ? <Spinner label="Reading the cluster…" /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
            <Stat
              label="Treasury balance" icon="account_balance_wallet"
              value={network?.balance_sol != null
                ? `${network.balance_sol.toFixed(4)} SOL`
                : '—'}
              tone={network?.balance_sol == null ? 'muted' : undefined}
              hint={network?.balance_sol != null
                ? `read from ${network.cluster}`
                : 'no treasury configured'}
            />
            <Stat
              label="Cluster" icon="hub"
              value={network?.cluster ?? '—'}
              tone={network?.reachable ? 'good' : 'bad'}
              hint={
                <span className="inline-flex items-center gap-xs">
                  <span className={`dot ${network?.reachable ? 'bg-success' : 'bg-danger'}`} />
                  {network?.reachable
                    ? `slot ${network.slot?.toLocaleString()}`
                    : 'unreachable'}
                </span>
              }
            />
            <Stat
              label="Price per report" icon="toll"
              value={quote ? `${quote.price_sol} SOL` : '—'}
              hint={quote ? `${quote.price_lamports.toLocaleString()} lamports` : undefined}
            />
            <Stat
              label="This session" icon="receipt_long"
              value={analysed}
              hint={
                <>
                  {analysed} report{analysed === 1 ? '' : 's'} analysed ·{' '}
                  {quote ? `${(analysed * quote.price_sol).toFixed(3)} SOL` : '—'} at list
                </>
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
            <Card
              title="Settlement gate"
              subtitle="Whether payment is enforced before an analysis can be read."
              icon="toll"
              className="lg:col-span-7"
            >
              <div className={`flex items-start gap-md p-md rounded-md border
                ${gated ? 'border-warning/30 bg-warning/5' : 'border-hairline bg-surface-container-low'}`}>
                <Icon
                  name={gated ? 'lock' : 'lock_open'}
                  className={`text-[24px] shrink-0 ${gated ? 'text-warning' : 'text-on-surface-variant'}`}
                />
                <div className="min-w-0">
                  <b className="block text-body-md text-primary">
                    {gated ? 'Metering enforced' : 'Metering bypassed'}
                  </b>
                  <p className="text-body-sm text-on-surface-variant mt-xs">
                    {gated
                      ? 'Each session must settle before /analysis returns a result.'
                      : 'PAYMENT_REQUIRED is false, so every analysis is readable. This is the default, and it is deliberate — an RPC timeout must never stand between a reviewer and the reconciliation engine.'}
                  </p>
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-sm mt-md">
                {([
                  ['Cluster', quote?.cluster ?? '—'],
                  ['Core version', network?.version ?? '—'],
                  ['This document', analysis?.paid ? 'settled' : gated ? 'unsettled' : 'not metered'],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-md bg-surface-container-low p-md">
                    <dt className="eyebrow">{label}</dt>
                    <dd className="mono text-body-md text-primary mt-xs truncate">{value}</dd>
                  </div>
                ))}
              </dl>

              {quote?.treasury ? (
                <div className="mt-md rounded-md border border-hairline p-md">
                  <span className="eyebrow">Treasury account</span>
                  <b className="mono block text-body-sm text-primary mt-xs break-all">
                    {quote.treasury}
                  </b>
                  <a
                    className="btn-ghost btn-sm mt-sm -ml-sm"
                    href={`https://explorer.solana.com/address/${quote.treasury}?cluster=${quote.cluster}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    View on Solana Explorer
                    <Icon name="open_in_new" className="text-[14px]" />
                  </a>
                </div>
              ) : (
                <div className="mt-md">
                  <NotConfigured
                    icon="wallet"
                    title="No treasury account configured"
                    body="Without a destination account no transaction can be requested from this build, and no balance can be read."
                    requirement={
                      <>
                        Set <code className="mono text-secondary">SOLANA_TREASURY</code> to a
                        Solana address in the <code className="mono text-secondary">.env</code> at
                        the repository root, then restart the engine.
                        {network?.reason && (
                          <p className="mt-sm">{network.reason}</p>
                        )}
                      </>
                    }
                  />
                </div>
              )}

              {network?.reason && quote?.treasury && (
                <p className="flex items-start gap-xs mt-md text-body-sm text-warning">
                  <Icon name="info" className="text-[16px] shrink-0 mt-px" />
                  {network.reason}
                </p>
              )}
            </Card>

            <Card title="Why this shape" icon="lightbulb" className="lg:col-span-5">
              <div className="space-y-md">
                {[
                  ['Metering matches the product',
                    'Credit decisioning is already sold per query. A per-document price is the same unit an analyst thinks in, and it prices honestly for a firm reviewing forty reports a year rather than four thousand.'],
                  ['Settlement is not the product',
                    'The gate defaults off because an external network dependency must never sit upstream of the reconciliation engine. Payment is a separate beat.'],
                  ['Verification is server-side',
                    'A signature is confirmed against the cluster before a session unlocks. A client claiming it paid is not evidence of anything.'],
                ].map(([title, body]) => (
                  <div key={title}>
                    <b className="block text-body-md text-primary">{title}</b>
                    <p className="text-body-sm text-on-surface-variant mt-xs">{body}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card
            title="What settlement costs at volume"
            subtitle="Flat per-document pricing, no tiering."
            icon="calculate"
            bodyClassName=""
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-right">Reports / month</th>
                    <th className="text-right">SOL</th>
                    <th className="text-right">Lamports</th>
                    <th>Per report</th>
                  </tr>
                </thead>
                <tbody>
                  {[10, 100, 1000, 10000].map(volume => (
                    <tr key={volume} className="row-hover">
                      <td className="mono text-right">{volume.toLocaleString()}</td>
                      <td className="mono text-right text-primary font-semibold">
                        {quote ? (volume * quote.price_sol).toFixed(2) : '—'}
                      </td>
                      <td className="mono text-right text-on-surface-variant">
                        {quote ? (volume * quote.price_lamports).toLocaleString() : '—'}
                      </td>
                      <td className="mono">{quote ? `${quote.price_sol} SOL` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex items-start gap-xs px-lg py-md border-t border-hairline
                          text-body-sm text-on-surface-variant">
              <Icon name="info" className="text-[16px] shrink-0 mt-px" />
              The cost of analysing a report does not depend on its length — page targeting
              sends the same handful of pages whether the document runs to 40 pages or 400.
            </p>
          </Card>

          <PaperOrderPanel />

          <Card title="Not built, and not faked" icon="construction">
            <p className="text-body-md text-on-surface-variant">
              Asset tokenisation, B2B settlement rails and programmatic payroll all belong on
              this screen in the product this design describes. They are absent here because
              SOLFV holds no assets and runs no on-chain programs beyond the metering
              transfer above — and a total with no account behind it is the one thing a
              reconciliation product cannot ship.
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-md mt-md">
              {[
                ['token', 'Asset tokenisation', 'Needs an SPL mint authority and a custody arrangement.'],
                ['sync_alt', 'B2B settlement', 'Needs counterparty accounts and KYB records.'],
                ['payments', 'Programmatic payroll', 'Needs a streaming program and an employee roster.'],
              ].map(([icon, title, need]) => (
                <li key={title} className="p-md rounded-md border border-dashed
                                           border-outline-variant bg-surface-container-low/50">
                  <Icon name={icon} className="text-on-surface-variant" />
                  <b className="block text-body-md text-primary mt-xs">{title}</b>
                  <p className="text-body-sm text-on-surface-variant mt-xs">{need}</p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Paper-order panel — the ledger view for the x402 flow                       */
/*                                                                            */
/*   Reads /paper/status for what settlement is bound to, and /paper/history   */
/*   for every verified payment on the ledger. Individual payments settle on   */
/*   the Crypto Candidates tab; this panel is the audit trail.                 */
/* -------------------------------------------------------------------------- */

function PaperOrderPanel() {
  const [status, setStatus] = useState<PaperStatus | null>(null)
  const [rows, setRows] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    Promise.all([api.paperStatus(), api.paperHistory(50)])
      .then(([nextStatus, history]) => {
        if (!live) return
        setStatus(nextStatus)
        setRows(history.rows)
      })
      .catch(caught => live && setError(
        caught instanceof Error ? caught.message : String(caught)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [])

  return (
    <Card
      title="Devnet x402 paper-order ledger"
      subtitle="Every verified USDC settlement, and the paper order it unlocked. This is the SOLANA TRACK flow."
      icon="receipt_long"
    >
      {error && (
        <div className="flex items-start gap-md p-md rounded-md
                        border border-danger/30 bg-danger/5">
          <Icon name="error" className="text-danger shrink-0" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">Could not read the paper-order ledger.</b>
            <p className="text-body-sm text-on-surface-variant mt-xs break-words">{error}</p>
          </div>
        </div>
      )}

      {status && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-md">
          <div className="rounded-md bg-surface-container-low p-md">
            <dt className="eyebrow">Network</dt>
            <dd className="mono text-body-md text-primary mt-xs">{status.network}</dd>
            <small className={`text-body-sm mt-xs block ${
              status.rpc.reachable ? 'text-success' : 'text-danger'}`}>
              {status.rpc.reachable
                ? `slot ${status.rpc.slot?.toLocaleString()}`
                : status.rpc.reason || 'unreachable'}
            </small>
          </div>
          <div className="rounded-md bg-surface-container-low p-md">
            <dt className="eyebrow">Settlement</dt>
            <dd className="mono text-body-md text-primary mt-xs">
              {status.amount_usdc} USDC
            </dd>
            <small className="text-body-sm text-on-surface-variant mt-xs block">
              {status.amount_base_units.toLocaleString()} base units
            </small>
          </div>
          <div className="rounded-md bg-surface-container-low p-md">
            <dt className="eyebrow">Ledger backend</dt>
            <dd className="mono text-body-md text-primary mt-xs">
              {status.ledger.backend ?? '—'}
            </dd>
            <small className={`text-body-sm mt-xs block ${
              status.ledger.backend === 'postgres' ? 'text-success' : 'text-on-surface-variant'}`}>
              {status.ledger.backend === 'postgres'
                ? 'Supabase Postgres'
                : status.ledger.backend === 'sqlite'
                  ? 'local SQLite fallback'
                  : status.ledger.reason || 'not initialised'}
            </small>
          </div>
          <div className="rounded-md bg-surface-container-low p-md">
            <dt className="eyebrow">Payments recorded</dt>
            <dd className="mono text-body-md text-primary mt-xs">{rows.length}</dd>
            <small className="text-body-sm text-on-surface-variant mt-xs block">
              verified on the ledger
            </small>
          </div>
        </dl>
      )}

      {status?.recipient && (
        <div className="rounded-md border border-hairline p-md mb-md">
          <span className="eyebrow">Merchant wallet (devnet)</span>
          <b className="mono block text-body-sm text-primary mt-xs break-all">
            {status.recipient}
          </b>
          <a className="btn-ghost btn-sm mt-sm -ml-sm"
             href={`https://explorer.solana.com/address/${status.recipient}?cluster=${status.network}`}
             target="_blank" rel="noreferrer noopener">
            View on Solana Explorer
            <Icon name="open_in_new" className="text-[14px]" />
          </a>
        </div>
      )}

      {loading ? <Spinner label="Reading the payment ledger…" /> : rows.length === 0 ? (
        <Empty
          icon="inbox"
          title="No paper orders yet"
          body="Every verified devnet USDC payment lands here. Open the Analysis → Crypto Candidates tab and click 'Simulate purchase' on a candidate to add the first one."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th>When</th>
                <th>Resource</th>
                <th>Signature</th>
                <th>Payer</th>
                <th>Slot</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                // resource_key has shape "session:{sid}:asset:{id}:usd:{amount}"
                const parts = row.resource_key.split(':')
                const asset = parts[3] ?? '—'
                const usd = parts[5] ?? '—'
                return (
                  <tr key={String(row.id)} className="row-hover">
                    <td className="mono text-body-sm text-on-surface-variant">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td>
                      <b className="mono uppercase text-body-md text-primary">{asset}</b>
                      <small className="block text-body-sm text-on-surface-variant">${usd} notional</small>
                    </td>
                    <td className="mono text-body-sm">
                      <a href={`https://explorer.solana.com/tx/${row.transaction_signature}?cluster=${row.network}`}
                         target="_blank" rel="noreferrer noopener"
                         className="text-secondary hover:underline">
                        {row.transaction_signature.slice(0, 8)}…{row.transaction_signature.slice(-8)}
                        <Icon name="open_in_new" className="text-[12px] ml-xs" />
                      </a>
                    </td>
                    <td className="mono text-body-sm text-on-surface-variant break-all">
                      {row.payer_wallet.slice(0, 6)}…{row.payer_wallet.slice(-6)}
                    </td>
                    <td className="mono text-right text-body-sm">
                      {row.slot?.toLocaleString() ?? '—'}
                    </td>
                    <td className="mono text-right text-primary">
                      {(row.expected_amount_base_units / 1_000_000).toFixed(3)} USDC
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
