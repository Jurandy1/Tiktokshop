export default function MetricCard({ label, value, subValue, accent = 'cyan', children }) {
  const accentHover =
    accent === 'pink' ? 'group-hover:bg-tiktok-pink' : 'group-hover:bg-tiktok-cyan';

  return (
    <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-4 md:p-5 relative overflow-hidden group">
      <div className={`absolute top-0 left-0 w-1 h-full bg-zinc-700 ${accentHover} transition-colors`} />
      <p className="text-[10px] md:text-xs text-tiktok-muted font-medium uppercase tracking-wider mb-2">
        {label}
      </p>
      {children || (
        <>
          <p className="text-2xl md:text-3xl font-bold font-mono tracking-tight">{value}</p>
          {subValue && (
            <p className="text-xs md:text-sm text-tiktok-muted font-mono mt-1">{subValue}</p>
          )}
        </>
      )}
    </div>
  );
}
