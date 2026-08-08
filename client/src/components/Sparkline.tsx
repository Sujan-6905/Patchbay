interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

/** A minimal inline-SVG sparkline: no charting library, since this is the only place one
 * would be needed. `values` is plotted oldest-to-newest, scaled to the tallest value seen. */
export function Sparkline({ values, width = 64, height = 20, className }: SparklineProps) {
  if (values.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }

  const max = Math.max(...values, 1);
  const points = values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
