import { HOLD_TTL_MINUTES } from "@/lib/config";
import { Card } from "./ui";

/** Short statement of the rules the backend enforces (these describe the API, not UI behaviour). */
export function BusinessRules() {
  const rules: Array<[string, string]> = [
    ["Holds expire", `A hold lasts ${HOLD_TTL_MINUTES} minutes, then its tickets return to inventory (checked on every read).`],
    ["No overselling", "Holds on one tier are serialized by a row lock; a request for more than is available gets 409 OVERSOLD."],
    ["Idempotent webhooks", "The same event_id twice changes nothing the second time. The same order under a new event_id is also a no-op."],
    ["Partial refunds", "Do not release inventory. Only cumulative refunds equal to the order total (a full refund) do."],
    ["Refund before payment", "Is stored (200, pending) and applied automatically when the matching order.paid arrives."],
    ["Payment after expiry", "Creates the order if stock is free; otherwise it is recorded and flagged for manual refund."],
  ];
  return (
    <Card title="How the API behaves" description="Rules enforced by the backend, so you know what to expect from each response.">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rules.map(([term, desc]) => (
          <div key={term}>
            <dt className="text-xs font-semibold text-zinc-800">{term}</dt>
            <dd className="mt-0.5 text-xs leading-5 text-zinc-500">{desc}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
