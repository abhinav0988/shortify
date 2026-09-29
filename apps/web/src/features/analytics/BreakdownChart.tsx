export function BreakdownChart({
  items,
  emptyLabel,
}: {
  items: Array<{ label: string; clicks: number }>;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((item) => item.clicks), 1);
  return (
    <ul className="bars">
      {items.map((item) => (
        <li key={item.label}>
          <span className="bar-label" title={item.label}>
            {item.label}
          </span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${Math.max(4, (item.clicks / max) * 100)}%` }} />
          </span>
          <span className="bar-value">{item.clicks}</span>
        </li>
      ))}
    </ul>
  );
}
