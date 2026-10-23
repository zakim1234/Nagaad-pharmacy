export function Table({ children }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200/80 bg-white">
      <table className="min-w-full divide-y divide-neutral-100 text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }) {
  return <thead className="bg-neutral-50/70">{children}</thead>;
}

export function Th({ children, className = '' }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-neutral-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-neutral-100 bg-white">{children}</tbody>;
}

export function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle text-neutral-700 ${className}`}>{children}</td>;
}

export function TableEmpty({ colSpan, message = 'No records found.' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center text-sm text-slate-400">
        {message}
      </td>
    </tr>
  );
}

export function TableLoading({ colSpan, rows = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          <td colSpan={colSpan} className="px-4 py-3">
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
          </td>
        </tr>
      ))}
    </>
  );
}
