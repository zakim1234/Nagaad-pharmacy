export function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium text-slate-700">
      {children} {required && <span className="text-rose-500">*</span>}
    </label>
  );
}

export function Input({ error, className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${
        error ? 'border-rose-400' : 'border-slate-300'
      } ${className}`}
      {...props}
    />
  );
}

export function Textarea({ error, className = '', ...props }) {
  return (
    <textarea
      className={`w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${
        error ? 'border-rose-400' : 'border-slate-300'
      } ${className}`}
      {...props}
    />
  );
}

export function Select({ error, className = '', children, ...props }) {
  return (
    <select
      className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${
        error ? 'border-rose-400' : 'border-slate-300'
      } ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1 text-xs font-medium text-rose-600">{children}</p>;
}

export function FormField({ label, required, error, children }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
      <FieldError>{error}</FieldError>
    </div>
  );
}
