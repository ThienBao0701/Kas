/**
 * Renders the persisted room-type summary string (e.g. "Superior Double (2)" or
 * "Superior Double (2) | Deluxe Double (1)") with one type per line, so multiple
 * room types stay readable on desktop and wrap cleanly on compact layouts. Data
 * is never re-derived — it is exactly the backend `roomSummary`.
 */
export function RoomSummary({ summary }: { summary: string | null | undefined }) {
  const parts = (summary ?? '').split(' | ').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return <>—</>;
  return (
    <div className="space-y-0.5">
      {parts.map((line, i) => (
        <div key={`${line}-${i}`} className="whitespace-nowrap">
          {line}
        </div>
      ))}
    </div>
  );
}
