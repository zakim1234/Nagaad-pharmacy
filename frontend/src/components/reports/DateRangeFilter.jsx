import { Select, Input } from '../ui/Field.jsx';

export default function DateRangeFilter({ range, onRangeChange, from, to, onFromChange, onToChange, allowAll = false }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 no-print">
      <Select value={range} onChange={(e) => onRangeChange(e.target.value)}>
        {allowAll && <option value="all">All History</option>}
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">This Week</option>
        <option value="month">This Month</option>
        <option value="year">This Year</option>
      </Select>
      <span className="pb-2 text-sm text-slate-400">or custom range:</span>
      <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="w-40" />
      <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="w-40" />
    </div>
  );
}
