import Spinner from './Spinner.jsx';

const variants = {
  primary: 'bg-brand-400 text-neutral-950 hover:bg-brand-300 focus-visible:outline-brand-600',
  secondary: 'bg-white text-neutral-800 ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300 hover:bg-neutral-50',
  danger: 'bg-brand-400 text-neutral-950 hover:bg-brand-300 focus-visible:outline-brand-600',
  ghost: 'text-neutral-600 hover:bg-neutral-100',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

const sizes = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-4 py-2.5 text-sm',
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
