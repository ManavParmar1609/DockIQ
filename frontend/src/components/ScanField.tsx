/**
 * Barcode entry. A handheld scanner in keyboard-wedge mode types the code and presses Enter, so the
 * field works with one; so does typing. Where the browser has BarcodeDetector (Chrome on Android),
 * the tablet camera can scan too.
 */
import { Camera, ScanLine, X } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Held in a ref so a new callback from the parent does not restart the camera.
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) return undefined;
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128', 'itf'] });
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;

    const scan = async () => {
      if (stopped || !video.current) return;
      try {
        const found = await detector.detect(video.current);
        const first = found[0];
        if (first) {
          handler.current(first.rawValue);
          return;
        }
      } catch {
        /* a frame that could not be read; try the next */
      }
      timer = window.setTimeout(() => void scan(), 250);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (media) => {
        stream = media;
        if (!video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        await scan();
      })
      .catch(() => setProblem('The camera is unavailable. Allow camera access, or type the code instead.'));

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl bg-black p-2">
      <div className="mb-2 flex items-center justify-between text-white">
        <p className="label text-white">Point the camera at the case barcode</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera"
          className="grid w-11 place-items-center rounded-full bg-white/15 text-white"
        >
          <X size={20} className="mx-auto" aria-hidden="true" />
        </button>
      </div>
      {problem ? (
        <p className="bg-surface p-3 font-semibold">{problem}</p>
      ) : (
        <video
          ref={video}
          className="aspect-video w-full rounded-lg bg-black"
          muted
          playsInline
          aria-label="Camera preview"
        />
      )}
    </div>
  );
}

export function ScanField({
  onScan,
  disabled = false,
  label = 'Scan or type a case barcode',
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasCamera = detectorCtor() !== null && 'mediaDevices' in navigator;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const code = value.trim();
    if (!code) return;
    onScan(code);
    setValue('');
    input.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor="scan-field" className="sr-only">
          {label}
        </label>
        <div className="relative min-w-0 flex-1">
          <ScanLine
            size={22}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            ref={input}
            id="scan-field"
            className="field telemetry pl-11 text-lg"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={label}
            autoComplete="off"
            inputMode="text"
            disabled={disabled}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={disabled || !value.trim()}>
          Check
        </button>
        {hasCamera && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCamera((open) => !open)}
            aria-expanded={camera}
          >
            <Camera size={20} aria-hidden="true" /> Camera
          </button>
        )}
      </form>
      {camera && (
        <CameraScanner
          onCode={(code) => {
            setCamera(false);
            onScan(code);
          }}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  );
}
