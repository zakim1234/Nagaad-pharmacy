import { useEffect, useState } from 'react';
import client from '../api/client.js';
import { Select } from './ui/Field.jsx';

// Populates its options live from the Accounts database -- never a
// hardcoded list -- so new accounts created on the Accounts page are
// immediately selectable here.
export default function AccountSelect({ value, onChange, disabled, className = '', allowEmpty = true, placeholder = 'Select account...' }) {
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    client
      .get('/accounts')
      .then((res) => setAccounts(res.data.data.accounts.filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, []);

  return (
    <Select value={value || ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} className={className}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}

export function useAccounts() {
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    client
      .get('/accounts')
      .then((res) => setAccounts(res.data.data.accounts.filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, []);
  return accounts;
}
