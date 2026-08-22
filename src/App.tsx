import { useMemo, useState } from 'react'

type Page = 'dashboard' | 'analysis' | 'market' | 'expenses' | 'solana' | 'privacy'

const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'analysis', label: 'Analysis Lab', icon: 'query_stats' },
  { id: 'market', label: 'Market Intelligence', icon: 'analytics' },
  { id: 'expenses', label: 'Expense Management', icon: 'receipt_long' },
  { id: 'solana', label: 'Solana Investments', icon: 'account_balance_wallet' },
  { id: 'privacy', label: 'Privacy Settings', icon: 'security' },
]

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

function Logo() {
  return <div className="brand-mark"><Icon name="account_balance" /></div>
}

const amount = (number: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number)

function Trend({ children, down = false }: { children: React.ReactNode; down?: boolean }) {
  return <span className={`trend ${down ? 'down' : ''}`}><Icon name={down ? 'south_east' : 'north_east'} />{children}</span>
}

function Metric({ label, value, trend, down = false, wave = 0 }: { label: string; value: string; trend: string; down?: boolean; wave?: number }) {
  const paths = ['M0 34 L18 28 L35 33 L54 15 L74 22 L100 5', 'M0 33 L18 29 L34 24 L53 10 L75 17 L100 4', 'M0 6 L18 14 L35 9 L56 27 L76 19 L100 35']
  return <article className="metric card">
    <p>{label}</p><strong className="mono">{value}</strong><Trend down={down}>{trend} vs last month</Trend>
    <svg className={`metric-wave ${down ? 'red' : ''}`} viewBox="0 0 100 40" preserveAspectRatio="none"><path d={paths[wave]} /><path className="fill" d={`${paths[wave]} L100 40 L0 40Z`} /></svg>
  </article>
}

function AppShell({ page, setPage, children, notify }: { page: Page; setPage: (p: Page) => void; children: React.ReactNode; notify: (message: string) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = (p: Page) => { setPage(p); setMobileOpen(false) }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-line"><Logo /><div><h1>Solv</h1><p>Solana · Finance · Investment</p></div></div></div>
      <nav className="side-nav">{pages.map(item => <button className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon} />{item.label}</button>)}</nav>
      <div className="procurement"><span><Icon name="bolt" /> B2B PROCUREMENT</span><h3>Automated vendor risk & payment reconciliation.</h3><p>Solv's AI monitors vendor health and automates 3-way matching.</p><small><Icon name="check" />Real-time vendor risk assessments</small><small><Icon name="check" />Automated payment reconciliation</small></div>
      <div className="sidebar-bottom"><button className="primary full" onClick={() => notify('Wallet connection flow opened')}>Connect Wallet</button><span><Icon name="verified_user" />PDPA Compliant</span><span><Icon name="security" />SOC2 Type II Certified</span><button className="plain" onClick={() => notify('Support request created')}><Icon name="help" />Support</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="mobile-logo" onClick={() => setMobileOpen(true)}><Logo /><b>Solv</b><Icon name="menu" /></button><div className="topbar-spacer" /><label className="search"><Icon name="search" /><input placeholder="Search entity, document, or wallet..." /></label><div className="top-actions"><button><Icon name="notifications" /></button><button><Icon name="shield" /></button><button className="avatar">AN</button></div></header>
      <div className="ticker"><div><b>KLCI</b> 1,544.71 <em>↗ (+0.45%)</em><b>MAYBANK</b> 9.78 <i>↘ (-0.12%)</i><b>CIMB</b> 6.65 <em>↗ (+1.20%)</em><b>SOL/USD</b> $142.50 <em>↗ (+5.67%)</em><b>BTC/USD</b> $64,210.00 <i>↘ (-2.10%)</i></div></div>
      {children}
    </main>
    <div className={`mobile-drawer ${mobileOpen ? 'open' : ''}`}><div className="drawer-panel"><button className="drawer-close" onClick={() => setMobileOpen(false)}><Icon name="close" /></button><div className="brand-line"><Logo /><h1>Solv</h1></div><nav className="side-nav">{pages.map(item => <button className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon} />{item.label}</button>)}</nav></div><button aria-label="Close menu" onClick={() => setMobileOpen(false)} /></div>
    <nav className="bottom-nav">{pages.slice(0, 4).map(item => <button className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon} /><span>{item.label.split(' ')[0]}</span></button>)}</nav>
  </div>
}

function Dashboard({ notify }: { notify: (message: string) => void }) {
  return <div className="content"><PageIntro title="Dashboard" text="Real-time overview of assets, security protocols, and market intelligence." />
    <section className="metric-grid"><Metric label="Total Balance" value="$3,543.65" trend="1.76%" /><Metric label="Income" value="$1,543.53" trend="2.44%" wave={1} /><Metric label="Expense" value="$1,143.77" trend="2.44%" down wave={2} /></section>
    <section className="dashboard-mid"><Card title="Vendor Liabilities & Payments" action="View all" onAction={() => notify('Showing all vendor liabilities')}><TransactionList items={[['cloud', 'Amazon Web Services', 'Infrastructure · Awaiting Approval', '-$12,450.00'], ['hub', 'Salesforce', 'CRM · Scheduled', '-$8,200.00'], ['badge', 'Workday', 'HRIS · Paid', '-$4,120.00']]} /></Card><div className="digest card"><div className="card-title no-border"><h3>Weekly email digest</h3><span>new insights</span></div><Insight color="blue" icon="savings" title="Identify savings" text="You found $1,240 in potential savings" /><Insight color="green" icon="error" title="Budget alert" text="Marketing spend is at 92% of monthly." /><Insight color="purple" icon="policy" title="Policy violation" text="3 transactions need review" /></div></section>
    <section className="dashboard-bottom"><Card title="Recent transactions" action="View all" onAction={() => notify('Showing all transactions')}><TransactionList items={[['S', 'Shopify', 'May 24, 2024 · Subscription', '-$79.00'], ['flight', 'Delta Airlines', 'Feb 8, 2024 · Travel', '-$320.00'], ['#', 'Slack', 'Dec 12, 2024 · Software', '-$12.75']]} /></Card><div className="stack"><BudgetCard /><div className="invoice card"><div className="scan-success"><Icon name="check_circle" />Invoice scanned successfully</div><div className="invoice-paper"><b>R&D</b><div><small>BALANCE DUE</small><strong className="mono">$20,550.86</strong></div><p /><p /><p /></div></div></div></section>
    <SystemFooter notify={notify} />
  </div>
}

function Analysis() {
  const [query, setQuery] = useState('What would happen to our runway if revenue grows 12% next quarter?')
  const [answered, setAnswered] = useState(true)
  return <div className="content"><PageIntro title="Analysis Lab" text="Model financial scenarios and find the signals that matter to your operating plan." action="New analysis" />
    <section className="analysis-layout"><div className="card analysis-workspace"><div className="card-title"><h3>Ask Solv Intelligence</h3><span className="secure"><Icon name="lock" />SECURE ANALYSIS</span></div><div className="prompt"><Icon name="auto_awesome" /><textarea value={query} onChange={e => setQuery(e.target.value)} /><button className="primary" onClick={() => setAnswered(true)}><Icon name="arrow_upward" /></button></div>{answered && <div className="answer"><div className="answer-head"><Icon name="smart_toy" /><b>Solv Intelligence</b><span>Updated just now</span></div><p>At a 12% revenue lift, estimated runway extends to <strong>18.4 months</strong>, adding 3.1 months from the current plan. The strongest contribution comes from Enterprise and Mid-Market cohorts.</p><div className="answer-metrics"><div><small>RUNWAY</small><b>18.4 mo</b><Trend>+20.3%</Trend></div><div><small>NET BURN</small><b>$194k</b><Trend>−$36k</Trend></div><div><small>CONFIDENCE</small><b>87%</b><span className="positive">High</span></div></div></div>}</div><aside className="card saved-analysis"><div className="card-title"><h3>Saved analyses</h3><button className="icon-button"><Icon name="more_horiz" /></button></div>{['CAPEX optimization', 'Burn rate alert', 'Q3 operating plan'].map((item, i) => <button key={item}><span className={`analysis-dot dot-${i}`}><Icon name={i === 0 ? 'trending_down' : i === 1 ? 'warning' : 'query_stats'} /></span><span><b>{item}</b><small>{i === 0 ? 'Potential savings of $48,200' : i === 1 ? 'Marketing variance detected' : 'Last edited yesterday'}</small></span><Icon name="chevron_right" /></button>)}</aside></section>
    <section className="chart-card card"><div className="card-title"><div><h3>Cash flow forecast</h3><span>Rolling 6-month projection</span></div><div className="segmented"><button className="selected">Forecast</button><button>Actual</button></div></div><ForecastChart /></section>
  </div>
}

function Market() {
  const [period, setPeriod] = useState('1M')
  return <div className="content"><PageIntro title="Market Intelligence" text="Institutional-grade signals across traditional and digital assets." action="Create alert" />
    <section className="market-grid"><article className="market-hero card"><div className="card-title"><div><span className="eyebrow">SOLANA</span><h2>$142.50 <Trend>5.67%</Trend></h2><p>Solana / USD · Real-time composite</p></div><button className="icon-button"><Icon name="more_horiz" /></button></div><div className="chart-toolbar"><div className="periods">{['1D','1W','1M','3M','1Y'].map(x => <button onClick={() => setPeriod(x)} className={period === x ? 'selected' : ''} key={x}>{x}</button>)}</div><span><Icon name="show_chart" /> Live data</span></div><MarketChart /></article><aside className="watchlist card"><div className="card-title"><h3>Watchlist</h3><button className="text-button">Edit</button></div>{[['BTC', '$64,210.00', '-2.10%', true], ['ETH', '$3,422.18', '1.38%', false], ['KLCI', '1,544.71', '0.45%', false], ['MAYBANK', '9.78', '-0.12%', true]].map(([name, price, change, down]) => <div className="watch" key={String(name)}><span className="ticker-symbol">{name}</span><span className="mono">{price}</span><Trend down={Boolean(down)}>{change}</Trend></div>)}</aside></section>
    <section className="signals"><Card title="Market signals" action="View all"><Signal icon="bolt" title="Momentum accelerating" body="SOL has outperformed the L1 basket by 8.2% over 7 days." tone="blue" /><Signal icon="account_balance" title="Institutional inflows" body="$48.6M net inflow to digital-asset funds this week." tone="green" /><Signal icon="warning" title="Volatility watch" body="Options implied volatility is 16% above its 30-day average." tone="amber" /></Card><Card title="Macro calendar"><div className="calendar-event"><span>28<br/><small>AUG</small></span><div><b>US GDP revision</b><p>High impact · 20:30 MYT</p></div><em>USD</em></div><div className="calendar-event"><span>30<br/><small>AUG</small></span><div><b>Malaysia CPI</b><p>Medium impact · 12:00 MYT</p></div><em>MYR</em></div></Card></section>
  </div>
}

function Expenses({ notify }: { notify: (message: string) => void }) {
  const [filter, setFilter] = useState('All transactions')
  const rows = useMemo(() => [['Amazon Web Services', 'Infrastructure', 'May 24, 2024', '$12,450.00', 'Pending'], ['Shopify', 'Software', 'May 24, 2024', '$79.00', 'Approved'], ['Delta Airlines', 'Travel', 'May 18, 2024', '$320.00', 'Reviewed'], ['Figma', 'Design', 'May 17, 2024', '$210.00', 'Approved']], [])
  return <div className="content"><PageIntro title="Expense Management" text="Control company spend with intelligent automation and real-time policy checks." action="Upload invoice" />
    <section className="expense-summary"><Metric label="This month" value="$114,382.47" trend="8.4%" down wave={2} /><Metric label="Pending approval" value="$18,240.00" trend="12 items" wave={1} /><article className="budget-summary card"><div><p>Marketing budget</p><strong>$46,200 <small>/ $50,000</small></strong></div><div className="progress"><i /></div><span><Icon name="warning" />92% utilized</span></article></section>
    <section className="expense-main"><Card title="Transactions" action="Export CSV" onAction={() => notify('CSV export prepared')}><div className="table-filters"><div className="filter-tabs">{['All transactions','Needs review','Policy flags'].map(x => <button className={filter === x ? 'selected' : ''} onClick={() => setFilter(x)} key={x}>{x}</button>)}</div><button className="outline"><Icon name="filter_list" />Filter</button></div><div className="transaction-table"><div className="table-head"><span>MERCHANT</span><span>CATEGORY</span><span>DATE</span><span>AMOUNT</span><span>STATUS</span></div>{rows.map(row => <div className="table-row" key={row[0]}><span><i className="merchant-icon">{row[0][0]}</i><b>{row[0]}</b></span><span>{row[1]}</span><span>{row[2]}</span><strong className="mono">{row[3]}</strong><em className={`status ${row[4] === 'Pending' ? 'pending' : ''}`}>{row[4]}</em></div>)}</div></Card><div className="stack"><Card title="Policy controls"><div className="control"><div><b>Auto-approve limit</b><p>Transactions below $500</p></div><button className="switch on" aria-label="Auto approve enabled" /></div><div className="control"><div><b>Receipt verification</b><p>Require receipt for all expenses</p></div><button className="switch on" aria-label="Receipt verification enabled" /></div><button className="outline full">Manage policies <Icon name="arrow_forward" /></button></Card><Card title="Smart recommendations"><Signal icon="savings" title="Consolidate software tools" body="3 duplicate collaboration subscriptions detected." tone="green" /></Card></div></section>
  </div>
}

function Solana({ notify }: { notify: (message: string) => void }) {
  return <div className="content"><PageIntro title="Solana Investments" text="Securely manage your corporate digital asset strategy." action="Request audit" />
    <section className="solana-summary"><article className="portfolio card"><div><span className="eyebrow">CORPORATE PORTFOLIO</span><h2>$1,842,902.60</h2><Trend>2.4% today</Trend></div><div className="portfolio-art"><Icon name="token" /></div><small>Last updated just now · Multi-sig secured</small></article><article className="card allocation"><div className="card-title"><h3>Asset allocation</h3><button className="text-button">Details</button></div><div className="donut"><div><b>100%</b><small>Invested</small></div></div><ul><li><i className="sol" />SOL <b>62%</b></li><li><i className="usdc" />USDC <b>28%</b></li><li><i className="jito" />JitoSOL <b>10%</b></li></ul></article></section>
    <section className="solana-main"><Card title="Corporate wallet"><div className="wallet-address"><div><Icon name="account_balance_wallet" /><span><small>PRIMARY TREASURY</small><b className="mono">G3cX...P94r</b></span></div><button className="icon-button" onClick={() => notify('Wallet address copied')}><Icon name="content_copy" /></button></div><div className="wallet-stats"><div><small>SOL BALANCE</small><b className="mono">8,252.62 SOL</b></div><div><small>USD VALUE</small><b className="mono">$1,176,012.40</b></div><div><small>STAKED</small><b className="mono">6,000 SOL</b></div></div><button className="outline full" onClick={() => notify('Transfer workflow opened')}>Initiate transfer <Icon name="north_east" /></button></Card><Card title="Recent activity" action="View all"><TransactionList items={[['sync_alt', 'SOL swapped for USDC', 'Today · Jupiter Aggregator', '+$42,000.00'], ['payments', 'Validator rewards', 'Yesterday · Stake account', '+42.83 SOL'], ['policy', 'Governance vote cast', 'May 19 · Proposal #482', 'Completed']]} /></Card></section>
  </div>
}

function Privacy({ notify }: { notify: (message: string) => void }) {
  const [masking, setMasking] = useState(true); const [alerts, setAlerts] = useState(true)
  return <div className="content"><PageIntro title="Privacy & Security Settings" text="Your financial data is protected by institutional-grade security controls." />
    <section className="privacy-grid"><Card title="Data privacy"><Setting icon="visibility_off" title="Mask sensitive financial data" text="Hide balances and transaction values by default." checked={masking} onChange={() => setMasking(!masking)} /><Setting icon="notifications_active" title="Security activity alerts" text="Notify administrators about unusual account activity." checked={alerts} onChange={() => setAlerts(!alerts)} /><div className="privacy-note"><Icon name="verified_user" /><span>PDPA compliant <small>Your data remains encrypted in transit and at rest.</small></span></div></Card><Card title="Access & signing"><div className="multi-sig"><div><Icon name="key" /><span><b>Multi-signature policy</b><small>2 of 3 approvals required for transfers</small></span></div><em>ACTIVE</em></div><div className="signers"><div className="signer"><span className="avatar">AN</span><div><b>Amelia Ng</b><small>Finance administrator · Approved</small></div><Icon name="check_circle" /></div><div className="signer"><span className="avatar green">KY</span><div><b>Kenneth Yap</b><small>Operations approver · Approved</small></div><Icon name="check_circle" /></div><div className="signer"><span className="avatar purple">SL</span><div><b>Sarah Lim</b><small>Legal approver · Pending verification</small></div><Icon name="pending" /></div></div><button className="outline full" onClick={() => notify('Signer invitation flow opened')}><Icon name="add" />Add signer</button></Card><Card title="Session protection"><Setting icon="timer" title="Session timeout" text="Sign out after 20 minutes of inactivity." checked /><Setting icon="devices" title="Trusted devices" text="Manage the devices that can access your account." checked={false} /></Card><article className="security-score"><Icon name="shield_locked" /><div><span>SECURITY POSTURE</span><h2>Strong</h2><p>All critical controls are active.</p></div><button className="outline" onClick={() => notify('Security report generated')}>Download report</button></article></section>
  </div>
}

function PageIntro({ title, text, action }: { title: string; text: string; action?: string }) { return <div className="page-intro"><div><h2>{title}</h2><p>{text}</p></div>{action && <button className="primary"><Icon name={action === 'Upload invoice' ? 'upload' : action === 'Create alert' ? 'add_alert' : 'add'} />{action}</button>}</div> }
function Card({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) { return <article className="card"><div className="card-title"><h3>{title}</h3>{action && <button className="text-button" onClick={onAction}>{action}</button>}</div>{children}</article> }
function TransactionList({ items }: { items: string[][] }) { return <div className="transaction-list">{items.map(([icon, name, detail, value]) => <button className="list-row" key={name}><span className={`list-icon ${icon.length === 1 ? 'letter' : ''}`}>{icon.length === 1 ? icon : <Icon name={icon} />}</span><span className="list-copy"><b>{name}</b><small>{detail}</small></span><strong className="mono">{value}</strong><Icon name="chevron_right" /></button>)}</div> }
function Insight({ color, icon, title, text }: { color: string; icon: string; title: string; text: string }) { return <div className="insight"><span className={color}><Icon name={icon} /></span><div><b>{title}</b><p>{text}</p></div></div> }
function BudgetCard() { return <article className="budget-card card"><div className="card-title no-border"><h3><Icon name="speed" />Cost Center Governance</h3></div><p>Set spend limits per team. Get real-time alerts before budgets are exceeded.</p><div className="budget-detail"><div><b>R&D</b><span>75%</span></div><div className="budget-line"><i /></div><p><span>Budget</span><b className="mono">$400k</b></p><p><span>Spent</span><b className="mono">$300k</b></p></div></article> }
function SystemFooter({ notify }: { notify: (message: string) => void }) { return <footer className="system-footer"><span><i />System operational. All nodes connected.</span><span><b>3</b> Pending tasks <button onClick={() => notify('Pending tasks opened')}>Review</button></span></footer> }
function ForecastChart() { return <div className="forecast"><div className="y-axis"><span>$800k</span><span>$600k</span><span>$400k</span><span>$200k</span></div><svg viewBox="0 0 800 260" preserveAspectRatio="none"><defs><linearGradient id="forecastfill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#2563eb" stopOpacity=".18" /><stop offset="1" stopColor="#2563eb" stopOpacity="0" /></linearGradient></defs><path className="grid" d="M0 15H800M0 85H800M0 155H800M0 225H800" /><path className="area" d="M0 180 C70 165 92 190 150 144 S248 166 310 120 S420 106 478 88 S565 110 626 56 S710 80 800 25 V260H0Z" /><path className="line" d="M0 180 C70 165 92 190 150 144 S248 166 310 120 S420 106 478 88 S565 110 626 56 S710 80 800 25" /></svg><div className="x-axis"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span></div></div> }
function MarketChart() { return <div className="market-chart"><svg viewBox="0 0 800 280" preserveAspectRatio="none"><defs><linearGradient id="marketfill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#2563eb" stopOpacity=".2" /><stop offset="1" stopColor="#2563eb" stopOpacity="0" /></linearGradient></defs><path className="grid" d="M0 24H800M0 92H800M0 160H800M0 228H800"/><path className="area" d="M0 206 L40 178 88 191 140 157 190 174 240 135 300 152 348 110 408 128 455 95 510 118 565 73 615 88 670 42 730 63 800 18 V280H0Z"/><path className="line" d="M0 206 L40 178 88 191 140 157 190 174 240 135 300 152 348 110 408 128 455 95 510 118 565 73 615 88 670 42 730 63 800 18"/></svg><div><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span></div></div> }
function Signal({ icon, title, body, tone }: { icon: string; title: string; body: string; tone: string }) { return <div className="signal"><span className={tone}><Icon name={icon} /></span><div><b>{title}</b><p>{body}</p></div><Icon name="chevron_right" /></div> }
function Setting({ icon, title, text, checked, onChange }: { icon: string; title: string; text: string; checked: boolean; onChange?: () => void }) { return <div className="setting"><span className="setting-icon"><Icon name={icon} /></span><div><b>{title}</b><p>{text}</p></div><button aria-label={title} onClick={onChange} className={`switch ${checked ? 'on' : ''}`}><i /></button></div> }

export default function App() {
  const [page, setPage] = useState<Page>('dashboard'); const [toast, setToast] = useState('')
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const current = page === 'dashboard' ? <Dashboard notify={notify} /> : page === 'analysis' ? <Analysis /> : page === 'market' ? <Market /> : page === 'expenses' ? <Expenses notify={notify} /> : page === 'solana' ? <Solana notify={notify} /> : <Privacy notify={notify} />
  return <AppShell page={page} setPage={setPage} notify={notify}>{current}{toast && <div className="toast"><Icon name="check_circle" />{toast}</div>}</AppShell>
}
