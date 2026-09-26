/**
 * A °F field with a ± key. Frozen readings are negative, and a tablet's decimal keypad often has no
 * minus sign; one tap flips the sign of what is typed.
 */
export function TempInput({
  id,
  value,
  onChange,
  className = 'field text-2xl',
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
}) {
  const flip = () => {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '-') onChange(trimmed === '-' ? '' : '-');
    else onChange(trimmed.startsWith('-') ? trimmed.slice(1) : `-${trimmed}`);
  };
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className="btn btn-secondary telemetry min-w-14 shrink-0 px-0 text-xl"
        aria-label={value.trim().startsWith('-') ? 'Make the reading positive' : 'Make the reading negative'}
        aria-controls={id}
        onClick={flip}
      >
        ±
      </button>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`${className} telemetry min-w-0`}
        value={value}
        required={required}
        aria-required={required}
        // Digits, one point and a leading minus; anything else is not a reading.
        onChange={(event) => {
          if (/^-?\d*\.?\d*$/.test(event.target.value)) onChange(event.target.value);
        }}
      />
    </div>
  );
}
