// A ring of 12 dots, deep blue fading to pale blue and shrinking as they fade,
// turning smoothly -- the pale tail trails the deep blue head.
const DOTS = [
  ['#0b3ea8', 4.2],
  ['#1250c4', 4.0],
  ['#1d63db', 3.85],
  ['#2f78ec', 3.7],
  ['#4a8ef4', 3.55],
  ['#64a2f8', 3.4],
  ['#7db4fb', 3.25],
  ['#95c4fd', 3.1],
  ['#acd2fe', 2.95],
  ['#c2defe', 2.8],
  ['#d5e8ff', 2.65],
  ['#e4f0ff', 2.5],
];

export default function Spinner({ className = 'h-6 w-6' }) {
  return (
    <svg className={`dot-spinner ${className}`} viewBox="0 0 44 44" role="status" aria-label="Loading">
      {DOTS.map(([color, r], i) => {
        // The head (darkest) at 12 o'clock, the tail going anticlockwise, so
        // the clockwise turn leads with the head.
        const angle = (-i * 30 - 90) * (Math.PI / 180);
        return <circle key={i} cx={22 + 16 * Math.cos(angle)} cy={22 + 16 * Math.sin(angle)} r={r} fill={color} />;
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
