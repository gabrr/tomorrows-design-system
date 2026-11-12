import type { Project } from "../../domain/types";
import { canonical, clone, priceReason } from "../../domain/evidence.js";
type RecordData = { id: string; provider: string; [key: string]: any };
export function checkQuote(
  before: Project,
  proposal: Project,
  record: RecordData,
  returned: RecordData,
  nodeId: string,
) {
  if (
    !returned ||
    priceReason(returned) ||
    canonical(returned) !== canonical(record)
  )
    throw new Error(
      "Cached quote changed or is unsupported. Refresh and review again.",
    );
  const actual = proposal.nodes.find((n) => n.id === nodeId)?.config;
  if (!actual) throw new Error("Proposal lost its target component.");
  const mapped: Record<string, string> = {
    input_per_million: "input_cost_per_million",
    output_per_million: "output_cost_per_million",
    request_cost: "cost_per_request",
  };
  for (const key of [
    "hourly_cost",
    "input_per_million",
    "output_per_million",
    "request_cost",
  ])
    if (key in record && actual[mapped[key] || key] !== record[key])
      throw new Error("Returned rate differs from the reviewed quote.");
  // Pricing may update only this component's rate and descriptive pricing fields.
  const allowed = new Set([
    "provider",
    "model",
    "pricing_provenance",
    ...(record.region ? ["region"] : []),
    ...(record.sku ? ["instance_class"] : []),
    ...Object.keys(record)
      .filter((k) =>
        [
          "hourly_cost",
          "input_per_million",
          "output_per_million",
          "request_cost",
        ].includes(k),
      )
      .map((k) => mapped[k] || k),
  ]);
  const cleaned = clone(proposal) as Project,
    target = cleaned.nodes.find((n) => n.id === nodeId),
    old = before.nodes.find((n) => n.id === nodeId);
  if (!target || !old) throw new Error("Unknown price target.");
  for (const key of allowed) {
    delete target.config[key];
    if (key in old.config) target.config[key] = clone(old.config[key]);
  }
  if (canonical(before) !== canonical(cleaned))
    throw new Error(
      "Pricing proposal changed fields outside the selected rate and pricing metadata.",
    );
}
