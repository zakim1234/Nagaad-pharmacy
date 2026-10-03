import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-20 text-center">
      <p className="text-6xl font-bold text-slate-200">404</p>
      <p className="mt-2 text-lg font-semibold text-slate-700">Page not found</p>
      <Link to="/dashboard" className="mt-4 text-sm font-medium text-indigo-600 hover:underline">
        Go back to Dashboard
      </Link>
    </div>
  );
}
