const styles = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-rose-100 text-rose-700',
  blue: 'bg-indigo-100 text-indigo-700',
};

export default function Badge({ color = 'slate', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[color]} ${className}`}
    >
      {children}
    </span>
  );
}

export function stockStatusBadge(status) {
  switch (status) {
    case 'in_stock':
      return { color: 'green', label: 'In Stock' };
    case 'low_stock':
      return { color: 'amber', label: 'Low Stock' };
    case 'out_of_stock':
      return { color: 'red', label: 'Out of Stock' };
    default:
      return { color: 'slate', label: status };
  }
}

export function expiryStatusBadge(status) {
  switch (status) {
    case 'expired':
      return { color: 'red', label: 'Expired' };
    case 'near_expiry':
      return { color: 'amber', label: 'Near Expiry' };
    case 'ok':
      return { color: 'green', label: 'OK' };
    default:
      return { color: 'slate', label: status || 'Unknown' };
  }
}

export function quotationStatusBadge(status) {
  switch (status) {
    case 'Accepted':
      return { color: 'green', label: 'Accepted' };
    case 'Rejected':
      return { color: 'red', label: 'Rejected' };
    case 'Expired':
      return { color: 'slate', label: 'Expired' };
    case 'Converted':
      return { color: 'blue', label: 'Converted' };
    default:
      return { color: 'amber', label: status || 'Pending' };
  }
}
