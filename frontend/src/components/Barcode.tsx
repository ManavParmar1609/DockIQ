import { encodeEan13, toEan13 } from '../lib/ean13';

/** An EAN-13 symbol with its human-readable digits. Black on white with quiet zones, so it scans. */
export function Barcode({ code, label }: { code: string; label?: string }) {
  const ean = toEan13(code);
  if (!ean) return <span className="telemetry text-sm text-ink-mute">{code}</span>;
  const bits = encodeEan13(ean);
  const quiet = 9;
  const width = bits.length + quiet * 2;
  return (
    <figure
      className="inline-flex flex-col items-center rounded-md bg-white px-2 pt-2"
      aria-label={label ?? `Barcode ${ean}`}
    >
      <svg
        viewBox={`0 0 ${width} 50`}
        width={width * 2}
        height={70}
        role="img"
        aria-hidden="true"
        shapeRendering="crispEdges"
      >
        <rect width={width} height="50" fill="var(--color-white)" />
        {Array.from(bits).map((bit, index) =>
          bit === '1' ? (
            <rect key={index} x={quiet + index} y="0" width="1" height="50" fill="var(--color-black)" />
          ) : null,
        )}
      </svg>
      <figcaption className="telemetry pb-1 text-sm tracking-widest text-black">{ean}</figcaption>
    </figure>
  );
}
