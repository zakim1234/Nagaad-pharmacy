// A ring of 12 dots, deep blue fading to pale blue, turning in steps so the
// colour seems to chase round the ring.
const DOT_COLORS = ['#0b3ea8', '#1250c4', '#1d63db', '#2f78ec', '#4a8ef4', '#64a2f8', '#7db4fb', '#95c4fd', '#acd2fe', '#c2defe', '#d5e8ff', '#e4f0ff'];

export default function Spinner({ className = 'h-6 w-6' }) {
  return (
    <svg className={`dot-spinner ${className}`} viewBox="0 0 40 40" role="status" aria-label="Loading">
      {DOT_COLORS.map((color, i) => {
        // Dot 0 (darkest) at 12 o'clock, the rest going anticlockwise, so the
        // clockwise step turn leads with the dark end.
        const angle = (-i * 30 - 90) * (Math.PI / 180);
        return <circle key={i} cx={20 + 15 * Math.cos(angle)} cy={20 + 15 * Math.sin(angle)} r={3.4} fill={color} />;
      })}
    </svg>
  );
}

export function PageSpinner() {
  return (
    <div className="flex h-64 w-full items-center justify-center">
      <Spinner className="h-14 w-14" />
    </div>
  );
}
