import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { formatCurrency } from '../../utils/format.js';

// One look for every report chart: quiet axes, horizontal grid only,
// rounded bars, gradient areas and a shared tooltip.
export const PALETTE = ['#dc2626', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#171717', '#14b8a6', '#64748b'];
export const COLORS = { revenue: '#dc2626', profit: '#10b981', cost: '#f59e0b', loss: '#f43f5e', count: '#0ea5e9', muted: '#cbd5e1' };

export const axisProps = { tick: { fontSize: 11, fill: '#94a3b8' }, axisLine: false, tickLine: false };
export const gridProps = { vertical: false, stroke: '#eef2f7' };
export const vGridProps = { horizontal: false, stroke: '#eef2f7' };

export function compactMoney(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

// Vertical fade for an Area fill: put inside <defs> of the chart.
export function gradient(id, color) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.3} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

export function ChartTooltip({ active, payload, label, money = true, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur">
      {label != null && label !== '' && <p className="mb-1.5 font-semibold text-slate-700">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} /> {p.name}
          </span>
          <span className="font-semibold tabular-nums text-slate-800">{money ? formatCurrency(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function LegendDots({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
      {items.map(({ label, color }) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
        </span>
      ))}
    </div>
  );
}

// Donut with the total in the middle and a legend list (value + share)
// beside it -- easier to read than labels drawn around a pie.
export function DonutChart({ data, valueKey, nameKey, colors = PALETTE, money = true, centerLabel = 'Total', height = 220 }) {
  const total = data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0);
  const fmt = (v) => (money ? formatCurrency(v) : v);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="62%" outerRadius="92%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d[nameKey]} fill={d.color || colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip money={money} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">{centerLabel}</span>
          <span className="text-sm font-bold tabular-nums text-slate-800">{fmt(total)}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0;
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <li key={d[nameKey]} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-slate-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color || colors[i % colors.length] }} />
                <span className="truncate">{d[nameKey]}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold text-slate-800">{fmt(v)}</span>
                <span className="ml-1.5 text-xs text-slate-400">{pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
