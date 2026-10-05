import { useEffect, useState } from 'react';
import client from '../api/client.js';

// The business day's OPEN/CLOSED status. Seller/POS uses it to lock itself
// for everyone after Close Day; the server enforces the same lock, this is
// only so people see a clear message instead of an error after filling a form.
export function useBusinessDay() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    client
      .get('/day-close/status')
      .then((res) => setStatus(res.data.data?.status || null))
      .catch(() => setStatus(null));
  }, []);
  return { status, closed: status === 'CLOSED' };
}
