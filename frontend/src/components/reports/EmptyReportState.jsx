import { BarChart3 } from 'lucide-react';

export default function EmptyReportState({ message = 'No data for this range yet.' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-slate-300 ring-1 ring-slate-100 print:hidden">
        <BarChart3 className="h-5 w-5" />
      </div>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
