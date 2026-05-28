/**
 * Shared FAQ row used by both the marketing home and the public pricing page.
 *
 * Renders semantic <dt>/<dd> pairs — must live inside a parent <dl>.
 */
export function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b pb-6 last:border-0">
      <dt className="font-semibold mb-2">{q}</dt>
      <dd className="text-muted-foreground leading-relaxed">{a}</dd>
    </div>
  );
}
