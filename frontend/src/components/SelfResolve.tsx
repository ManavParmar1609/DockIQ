import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';

import { useSelfResolve, useTaxonomy } from '../api/hooks';
import { VoiceButton } from './Evidence';
import { ChoiceGroup, FieldLabel, MutationError } from './ui';

/**
 * The worker closes their own issue: what they did (the taxonomy's operator resolutions) and a note.
 * The note is required when the issue is escalated — the server says so (`self_resolve_needs_note`).
 */
export function SelfResolveForm({
  issueId,
  needsNote,
  columns = 2,
  disabled = false,
  onResolved,
  onCancel,
}: {
  issueId: number;
  needsNote: boolean;
  columns?: 2 | 3 | 4;
  /** Another action on the same issue is under way. */
  disabled?: boolean;
  onResolved?: () => void;
  onCancel?: () => void;
}) {
  const taxonomy = useTaxonomy();
  const resolve = useSelfResolve();
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const noteId = useId();
  const missingNote = needsNote && !note.trim();

  return (
    <div>
      <p className="mb-3 text-base">
        {needsNote
          ? 'Your supervisor has this one, but you can still close it. Pick what you did, say what happened, and confirm: your supervisor is told.'
          : 'Did the procedure fix it? Pick what you did, add a note if it helps, and confirm.'}
      </p>
      <ChoiceGroup
        label="What you did"
        options={(taxonomy.data?.operator_resolutions ?? []).map((option) => ({
          value: option,
          label: option,
        }))}
        value={choice}
        onChange={setChoice}
        columns={columns}
      />
      <div className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex-1">
            <FieldLabel
              htmlFor={noteId}
              hint={needsNote ? 'Required: the issue is with your supervisor' : 'Optional'}
            >
              Note for the record
            </FieldLabel>
          </div>
          <div className="mb-2">
            <VoiceButton
              onText={(text) => setNote((current) => (current ? `${current} ${text}` : text).slice(0, 2000))}
            />
          </div>
        </div>
        <textarea
          id={noteId}
          rows={2}
          className="field text-lg"
          maxLength={2000}
          required={needsNote}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What you did, what you saw"
        />
      </div>
      <div className="mt-3">
        <MutationError error={resolve.error} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary min-w-56 flex-1 text-lg"
          disabled={!choice || missingNote || resolve.isPending || disabled}
          onClick={() => {
            if (!choice) return;
            resolve.mutate(
              { id: issueId, resolution_type: choice, resolution_notes: note.trim() },
              { onSuccess: () => onResolved?.() },
            );
          }}
        >
          <Check size={22} aria-hidden="true" />
          {resolve.isPending ? 'Closing…' : 'Confirm — mark it resolved'}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary flex-1 sm:flex-none"
            disabled={resolve.isPending}
            onClick={onCancel}
          >
            <X size={20} aria-hidden="true" /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
