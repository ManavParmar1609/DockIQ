import { useTaxonomy } from '../api/hooks';

/** The filing group (product, people, systems) of an issue type, from GET /api/taxonomy. */
function useIssueGroup(issueType: string): string | undefined {
  return useTaxonomy().data?.issue_types.find((type) => type.name === issueType)?.group;
}

/** A dot in the issue's filing colour. It files; it never alarms — severity has its own channel. */
export function IssueGroupDot({ issueType }: { issueType: string }) {
  const group = useIssueGroup(issueType);
  if (!group) return null;
  return <span className={`file-dot file-${group} shrink-0`} aria-hidden="true" />;
}

/** The issue type as a category word in its filing colour, as the reference sets its labels. */
export function IssueTypeLabel({ issueType }: { issueType: string }) {
  const group = useIssueGroup(issueType);
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${group ? `file-${group} file-label` : 'text-ink-mute'}`}
    >
      {group && <span className="file-dot" aria-hidden="true" />}
      {issueType}
    </span>
  );
}
