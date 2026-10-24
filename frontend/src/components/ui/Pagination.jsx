export default function Pagination({ page, pages, total, limit, onChange }) {
  if (!pages || pages <= 1) return null;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3 text-sm text-neutral-500">
      <span>
        Showing <span className="font-medium text-neutral-700">{start}</span>–
        <span className="font-medium text-neutral-700">{end}</span> of{' '}
        <span className="font-medium text-neutral-700">{total}</span>
      </span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-md px-3 py-1.5 font-medium ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <span className="px-2 py-1.5 text-neutral-600">
          Page {page} of {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="rounded-md px-3 py-1.5 font-medium ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
