import Card from '../ui/Card.jsx';

// A print-aware wrapper around Card: on paper it never splits a KPI group,
// chart, or table across a page break.
export default function ReportSection({ title, actions, className = '', children }) {
  return (
    <Card title={title} actions={actions} className={`report-section ${className}`}>
      {children}
    </Card>
  );
}
