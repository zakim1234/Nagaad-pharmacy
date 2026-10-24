import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, ArrowDownCircle, ArrowUpCircle, History, PieChart } from 'lucide-react';
import client, { isAllBranchesView } from '../../api/client.js';
import { useBranchNames } from '../../hooks/useBranchNames.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Handles both "Add Partner" (no partner passed) and "Edit Partner" (partner
// passed -- PUT, and only name/phone/notes are ever sent: Total Contributed/
// Withdrawn/Current Equity are derived from the capital ledger and aren't
// editable here at all).
function PartnerFormModal({ open, partner, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = !!partner;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(partner?.name || '');
      setPhone(partner?.phone || '');
      setNotes(partner?.notes || '');
    }
  }, [open, partner]);

  const save = async () => {
    if (!name.trim()) return toast.error('Enter the partner name.');
    setSaving(true);
    try {
      if (isEdit) {
        await client.put(`/partners/${partner.id}`, { name, phone, notes });
        toast.success(`Partner "${name.trim()}" updated.`);
      } else {
        await client.post('/partners', { name, phone, notes });
        toast.success(`Partner "${name.trim()}" added.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save partner.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Partner' : 'Add Partner'} size="sm">
      <div className="space-y-4">
        <FormField label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </FormField>
        <FormField label="Note">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            {isEdit ? 'Save Changes' : 'Save Partner'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Shared by Add Capital Contribution and Withdraw Capital -- same fields,
// opposite direction and validation.
function CapitalModal({ open, mode, partner, onClose, onSaved }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const isWithdraw = mode === 'withdraw';

  useEffect(() => {
    if (open) {
      setAmount('');
      setAccountId(null);
      setDate(today());
      setNote('');
    }
  }, [open, partner?.id]);

  const save = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) return toast.error('Enter an amount greater than zero.');
    if (isWithdraw && amt > partner.currentEquity) return toast.error(`Amount exceeds this partner's current equity of ${formatCurrency(partner.currentEquity)}.`);
    if (!accountId) return toast.error('Select a payment account.');
    setSaving(true);
    try {
      await client.post(`/partners/${partner.id}/${isWithdraw ? 'withdraw' : 'contribute'}`, { amount: amt, paymentAccountId: accountId, date, note });
      toast.success(isWithdraw ? `${formatCurrency(amt)} withdrawn by ${partner.name}.` : `${formatCurrency(amt)} contributed by ${partner.name}.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save this transaction.');
    } finally {
      setSaving(false);
    }
  };

  if (!partner) return null;
  return (
    <Modal open={open} onClose={onClose} title={isWithdraw ? 'Withdraw Capital' : 'Add Capital Contribution'} size="sm">
      <div className="space-y-4">
        <FormField label="Partner">
          <Input value={partner.name} disabled />
        </FormField>
        {isWithdraw && (
          <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
            <span className="text-neutral-500">Current Equity: </span>
            <span className="font-semibold text-neutral-800">{formatCurrency(partner.currentEquity)}</span>
          </div>
        )}
        <FormField label={isWithdraw ? 'Amount to Withdraw' : 'Amount'} required>
          <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Payment Account" required>
          <AccountSelect value={accountId} onChange={setAccountId} placeholder={isWithdraw ? 'Account to pay from...' : 'Account receiving the funds...'} />
        </FormField>
        <FormField label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant={isWithdraw ? 'danger' : 'primary'} loading={saving} onClick={save}>
            {isWithdraw ? 'Confirm Withdrawal' : 'Confirm Contribution'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ partner, onClose }) {
  const toast = useToast();
  const [transactions, setTransactions] = useState(null);

  useEffect(() => {
    if (!partner) return;
    setTransactions(null);
    client
      .get(`/partners/${partner.id}/transactions`)
      .then((res) => setTransactions(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load history.'));
  }, [partner]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={!!partner} onClose={onClose} title={partner ? `${partner.name} — Capital History` : ''} size="lg">
      <Table>
        <THead>
          <tr>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Amount</Th>
            <Th>Account</Th>
            <Th>Equity After</Th>
            <Th>Note</Th>
          </tr>
        </THead>
        <TBody>
          {transactions === null ? (
            <TableLoading colSpan={6} />
          ) : transactions.length === 0 ? (
            <TableEmpty colSpan={6} message="No capital movements yet." />
          ) : (
            transactions.map((t) => (
              <tr key={t.id}>
                <Td>{formatDateTime(t.date)}</Td>
                <Td>
                  {t.type === 'CONTRIBUTION' ? (
                    <span className="text-emerald-600">Contribution</span>
                  ) : t.type === 'PROFIT_SHARE' ? (
                    <span className="font-medium text-neutral-900">Profit share</span>
                  ) : t.type === 'PROFIT_SHARE_CANCELLED' ? (
                    <span className="text-neutral-500">Profit share cancelled</span>
                  ) : (
                    <span className="text-brand-600">Withdrawal</span>
                  )}
                </Td>
                <Td className="font-medium">{formatCurrency(t.amount)}</Td>
                <Td>{t.accountName}</Td>
                <Td>{formatCurrency(t.equityAfter)}</Td>
                <Td>{t.note || '—'}</Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>
    </Modal>
  );
}

function Figure({ label, value, strong = false }) {
  return (
    <div className="px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p className={`figure mt-1 font-extrabold text-neutral-950 ${strong ? 'text-[26px]' : 'text-xl'}`}>{value}</p>
    </div>
  );
}

export default function PartnersPage() {
  const { user } = useAuth();
  const toast = useToast();
  // All-branches view: every branch's partners together, to look at only.
  const overview = isAllBranchesView(user);
  const branchName = useBranchNames(overview);
  const canManage = !overview && (user?.role === 'admin' || user?.role === 'manager');
  const showActions = canManage || overview;
  // All branches together: partners grouped by branch, each branch with a
  // subtotal of what its partners put in.
  const grouped = overview;
  const sumOf = (ps, f) => Math.round(ps.reduce((t, p) => t + (p[f] || 0), 0) * 100) / 100;
  // One group per branch on the all-branches view; a single group otherwise.
  const partnerGroups = () => {
    const list = data?.partners || [];
    const byBranch = new Map();
    for (const p of list) {
      const k = grouped ? String(p.branch || '') : 'all';
      if (!byBranch.has(k)) byBranch.set(k, []);
      byBranch.get(k).push(p);
    }
    return [...byBranch.entries()].map(([key, partners]) => ({ key, partners, total: sumOf(partners, 'currentEquity') }));
  };
  const [data, setData] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editPartner, setEditPartner] = useState(null);
  const [capitalModal, setCapitalModal] = useState(null); // { mode, partner }
  const [historyPartner, setHistoryPartner] = useState(null);

  const load = useCallback(() => {
    client
      .get('/partners')
      .then((res) => setData(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load partners.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Partners / Investors"
        subtitle={overview ? `Showing: All branches. Open a branch to add a partner or move capital.` : "Each partner's capital contributions and withdrawals, and their current equity in the business."}
        actions={
          <>
            {overview && (
            <Link
              to="/partners/profit-sharing"
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-300"
            >
              <PieChart className="h-4 w-4" /> Share Year Profit
            </Link>
            )}
            {canManage && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add Partner
              </Button>
            )}
          </>
        }
      />

      {data === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">Loading…</p>
      ) : (
        <>
          {/* One quiet strip of figures */}
          <div className="mb-6 grid grid-cols-2 divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white sm:grid-cols-4 sm:divide-x">
            <Figure label="Total capital" value={formatCurrency(data.totalEquity)} strong />
            <Figure label="Partners" value={data.partners.length} />
            <Figure label={grouped ? 'Branches' : 'Put in'} value={grouped ? partnerGroups().length : formatCurrency(sumOf(data.partners, 'totalContributed'))} />
            <Figure label="Profit received" value={formatCurrency(sumOf(data.partners, 'totalProfit'))} />
          </div>

          {data.partners.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-white py-14 text-center text-sm text-neutral-400">No partners yet.</div>
          ) : (
            partnerGroups().map((g) => (
              <section key={g.key} className="mb-4 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white">
                {grouped && (
                  <header className="flex items-end justify-between border-b border-neutral-100 px-5 py-3.5">
                    <div>
                      <p className="eyebrow">Branch</p>
                      <h3 className="text-[15px] font-bold text-neutral-950">{branchName(g.key || null)}</h3>
                    </div>
                    <div className="text-right">
                      <p className="eyebrow">Capital</p>
                      <p className="figure text-lg font-extrabold text-neutral-950">{formatCurrency(g.total)}</p>
                    </div>
                  </header>
                )}
                <ul className="divide-y divide-neutral-100">
                  {g.partners.map((p) => {
                    const share = g.total > 0 ? Math.round((p.currentEquity / g.total) * 1000) / 10 : 0;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold uppercase text-neutral-600">
                          {p.name.slice(0, 2)}
                        </span>
                        <div className="min-w-[150px] flex-1">
                          <p className="font-semibold text-neutral-950">{p.name}</p>
                          <p className="text-xs text-neutral-400">
                            Put in {formatCurrency(p.totalContributed)}
                            {p.totalWithdrawn > 0 && ` · took out ${formatCurrency(p.totalWithdrawn)}`}
                            {p.totalProfit > 0 && ` · profit ${formatCurrency(p.totalProfit)}`}
                          </p>
                        </div>
                        <div className="w-36">
                          <div className="flex items-baseline justify-between text-[11px]">
                            <span className="text-neutral-400">Share</span>
                            <span className="figure font-semibold text-neutral-700">{share}%</span>
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100">
                            <div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.min(100, share)}%` }} />
                          </div>
                        </div>
                        <p className="figure w-32 text-right text-base font-extrabold text-neutral-950">{formatCurrency(p.currentEquity)}</p>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setHistoryPartner(p)}>
                            <History className="h-3.5 w-3.5" /> History
                          </Button>
                          {canManage && (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => setEditPartner(p)}>
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setCapitalModal({ mode: 'contribute', partner: p })}>
                                <ArrowDownCircle className="h-3.5 w-3.5" /> Contribute
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setCapitalModal({ mode: 'withdraw', partner: p })}>
                                <ArrowUpCircle className="h-3.5 w-3.5" /> Withdraw
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      <PartnerFormModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />
      <PartnerFormModal open={!!editPartner} partner={editPartner} onClose={() => setEditPartner(null)} onSaved={load} />
      <CapitalModal
        open={!!capitalModal}
        mode={capitalModal?.mode}
        partner={capitalModal?.partner}
        onClose={() => setCapitalModal(null)}
        onSaved={load}
      />
      <HistoryModal partner={historyPartner} onClose={() => setHistoryPartner(null)} />
    </div>
  );
}
