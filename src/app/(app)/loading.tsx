export default function AppLoading() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div className="h-7 w-48 bg-muted rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 bg-muted rounded animate-pulse" />
        ))}
      </div>
      <div className="h-40 bg-muted rounded animate-pulse" />
    </div>
  );
}
