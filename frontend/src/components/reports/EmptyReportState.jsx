export default function EmptyReportState({ message = 'No data for this range yet.' }) {
  return <p className="py-10 text-center text-sm text-slate-400">{message}</p>;
}
