import { Lock } from 'lucide-react';

// Shown on Seller/POS while the business day is closed. Text only: the day
// is opened from Daily Closing, never from Seller/POS.
export default function DayClosedNotice({ compact = false }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-rose-700">
          <Lock className="h-4 w-4" /> Maalintu waa xiran tahay — waxba lama iibin karo ilaa maalinta la furo.
        </p>
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
    </div>
  );
}
