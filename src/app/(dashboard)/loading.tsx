export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <div className="skeleton h-9 w-52 rounded-lg" />
        <div className="skeleton h-4 w-96 max-w-full rounded-md" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="skeleton h-56 rounded-xl" />
        <div className="skeleton h-56 rounded-xl" />
      </div>

      <div className="skeleton h-80 rounded-xl" />
    </div>
  );
}
