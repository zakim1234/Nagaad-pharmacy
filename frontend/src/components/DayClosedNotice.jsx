import { Link } from 'react-router-dom';
import { Lock, LockOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

// Shown on Seller/POS while the business day is closed. An admin gets a
// shortcut to Daily Closing, where the day is opened.
export default function DayClosedNotice({ compact = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-rose-700">
          <Lock className="h-4 w-4" /> Maalintu waa xiran tahay — waxba lama iibin karo ilaa maalinta la furo.
        </p>
        {isAdmin && (
          <Link to="/daily-closing" className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700">
            <LockOpen className="h-4 w-4" /> Open the Day
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-100">
        <Lock className="h-7 w-7" />
      </div>
      <p className="text-lg font-semibold text-rose-600">Maalintu waa xiran tahay. Waxba lama iibin karo ilaa maalinta la furo.</p>
      <p className="mt-1 text-sm text-slate-500">The business day is closed. Nothing can be sold until it is opened.</p>
      {isAdmin ? (
        <Link to="/daily-closing" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
          <LockOpen className="h-4 w-4" /> Open the Day in Daily Closing
        </Link>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Fadlan sug Admin inuu furo. (Please wait for an admin to open it.)</p>
      )}
    </div>
  );
}
