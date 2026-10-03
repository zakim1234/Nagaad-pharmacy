import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

const TYPES = [
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK', label: 'Bank' },
  { value: 'MERCHANT', label: 'Merchant' },
  { value: 'OTHER', label: 'Other' },
];

export default function AccountFormModal({ open, onClose, onSaved, account }) {
  const toast = useToast();
  const isEdit = !!account;
  const [name, setName] = useState('');
  const [type, setType] = useState('MOBILE_MONEY');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(account?.name || '');
      setType(account?.type || 'MOBILE_MONEY');
      setAccountNumber(account?.accountNumber || '');
      setOpeningBalance(account ? String(account.openingBalance) : '0');
    }
  }, [open, account]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Please enter an account name.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await client.put(`/accounts/${account.id}`, { name, type, accountNumber });
        toast.success('Account updated.');
      } else {
        await client.post('/accounts', { name, type, accountNumber, openingBalance: Number(openingBalance) || 0 });
        toast.success('Account created.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save this account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Account' : 'New Account'} size="sm">
      <div className="space-y-4">
        <FormField label="Account Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premier Bank" />
        </FormField>
        <FormField label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Account Number (optional)">
          <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Optional" />
        </FormField>
        {!isEdit && (
          <FormField label="Opening Balance">
            <Input type="number" min="0" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
          </FormField>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            {isEdit ? 'Save Changes' : 'Create Account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
