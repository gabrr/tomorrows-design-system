import { Link } from "@astryxdesign/core/Link";
import type { ReactNode } from "react";
import type { Project } from "../../domain/types";
import { projectChanges } from "../../domain/evidence.js";
import { Disclosure, Text } from "../../ui";
import { proposalSummaryGroups } from "../../domain/proposals";
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export { guard, validateProposal } from "./review-logic";
export function Changes({
  before,
  after,
  actions,
}: {
  before: Project;
  after: Project;
  actions?: ReactNode;
}) {
  const changes = projectChanges(before, after) as string[];
  const summary = proposalSummaryGroups(before, after);
  const primary = summary.changes.length ? summary.changes : summary.inventory;
  return (
    <>
      <div className="proposal-summary" aria-label="Proposed change summary">
        <strong>Proposed changes</strong>
        <ul
          className="proposal-changes"
          role="list"
          aria-label="Change details"
        >
          {(primary.length
            ? primary
            : ["No architecture, scenario or monthly assumption changes."]
          ).map((line) => (
            <li key={line}>
              <Text weight="semibold">{line}</Text>
            </li>
          ))}
        </ul>
        {summary.changes.length > 0 && summary.inventory.length > 0 && (
          <ul aria-label="Affected items">
            {summary.inventory.map((line) => (
              <li key={line}>
                <Text type="supporting" color="secondary">
                  {line}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
      {actions}
      <Disclosure title={`Complete diff (${changes.length} details)`}>
        <ul>
          {(changes.length
            ? changes
            : ["No architecture, scenario or monthly assumption changes."]
          ).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure title="Complete proposal JSON">
        <pre>{JSON.stringify(after, null, 2)}</pre>
      </Disclosure>
    </>
  );
}
export function SourceLink({ source }: { source: unknown }) {
  if (typeof source !== "string") return null;
  try {
    const url = new URL(source);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return (
      <Link href={url.href} isExternalLink>
        Published source
      </Link>
    );
  } catch {
    return null;
  }
}
