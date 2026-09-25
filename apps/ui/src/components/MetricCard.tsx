interface MetricCardProps {
  label: string;
  value: number | string;
  sub: string;
  variant: "purple" | "blue" | "green" | "amber";
  icon: string;
}

export function MetricCard({ label, value, sub, variant, icon }: MetricCardProps) {
  return (
    <div className={`metric-card metric-card--${variant}`}>
      <div className="metric-label">{icon} {label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}
