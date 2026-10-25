export function Label({ children, required }) {
  return (
    <label className="mb-1.5 block text-[13px] font-semibold text-neutral-700">
      {children} {required && <span className="text-brand-500">*</span>}
    </label>
  );
}

export function Input({ error, className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 ${
        error ? 'border-brand-400' : 'border-neutral-200 hover:border-neutral-300'
      } ${className}`}
      {...props}
    />
  );
}

export function Textarea({ error, className = '', ...props }) {
  return (
    <textarea
      className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 ${
        error ? 'border-brand-400' : 'border-neutral-200 hover:border-neutral-300'
      } ${className}`}
      {...props}
    />
  );
}

export function Select({ error, className = '', children, ...props }) {
  return (
    <select
      className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 ${
        error ? 'border-brand-400' : 'border-neutral-200 hover:border-neutral-300'
      } ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1 text-xs font-medium text-brand-600">{children}</p>;
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
