/**
 * Photo evidence and voice dictation for an issue report.
 * Photos are downscaled on the device before upload: the API caps them at 600 kB and 4 per issue
 * (business-rules §9), and a tablet on warehouse Wi-Fi should not push 5 MB camera originals.
 */
import { ImagePlus, Mic, MicOff, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { usePhotoBlob, usePhotos } from '../api/hooks';
import { formatDateTime } from '../lib/format';

export const MAX_PHOTOS = 4;
const MAX_EDGE = 1280;
const QUALITY = 0.72;

export async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process the photo'))),
      'image/jpeg',
      QUALITY,
    );
  });
}

function Thumb({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="relative border-2 border-ink">
      <img src={url} alt="Photo to attach" className="aspect-square w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute right-0 top-0 w-11 border-b-2 border-l-2 border-ink bg-light"
      >
        <Trash2 size={18} className="mx-auto" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Pick photos (the camera on a tablet); returns downscaled JPEGs to upload after the issue exists. */
export function PhotoPicker({ photos, onChange }: { photos: Blob[]; onChange: (photos: Blob[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    setProblem(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const processed = await Promise.all([...files].slice(0, room).map(downscale));
      onChange([...photos, ...processed]);
    } catch {
      setProblem('One photo could not be read. Try taking it again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {photos.map((photo, index) => (
          <Thumb key={index} blob={photo} onRemove={() => onChange(photos.filter((_, i) => i !== index))} />
        ))}
        {photos.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="flex aspect-square flex-col items-center justify-center gap-2 border-2 border-dashed border-ink bg-light"
          >
            <ImagePlus size={28} aria-hidden="true" />
            <span className="heading text-base">{busy ? 'Processing…' : 'Add photo'}</span>
            <span className="text-sm text-ink-mute">
              {photos.length} of {MAX_PHOTOS}
            </span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void add(event.target.files)}
        aria-label="Add photos"
      />
      {problem && <p className="mt-2 font-semibold text-hazard-deep">{problem}</p>}
    </div>
  );
}

function StoredPhoto({ id, createdAt }: { id: number; createdAt: string }) {
  const blob = usePhotoBlob(id);
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <figure className="border-2 border-ink bg-light">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={`Evidence photo taken ${formatDateTime(createdAt)}`}
            className="aspect-square w-full object-cover"
          />
        </a>
      ) : (
        <div className="label grid aspect-square place-items-center">
          {blob.isError ? 'Unavailable' : 'Loading…'}
        </div>
      )}
      <figcaption className="telemetry border-t-2 border-ink px-2 py-1 text-sm">
        {formatDateTime(createdAt)}
      </figcaption>
    </figure>
  );
}

/** The photos attached to an issue. */
export function PhotoStrip({ issueId, count }: { issueId: number; count: number }) {
  const photos = usePhotos(issueId, count > 0);
  if (count === 0) return <p className="text-ink-mute">No photos attached.</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(photos.data ?? []).map((photo) => (
        <StoredPhoto key={photo.id} id={photo.id} createdAt={photo.created_at} />
      ))}
    </div>
  );
}

// ── Voice ──

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Dictate into a text field — for gloved hands. Hidden where the browser has no speech recognition. */
export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const Ctor = recognitionCtor();

  useEffect(() => () => recognition.current?.stop(), []);
  if (!Ctor) return null;

  const toggle = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const instance = new Ctor();
    instance.lang = 'en-US';
    instance.interimResults = false;
    instance.continuous = false;
    instance.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (text) onText(text);
    };
    instance.onend = () => setListening(false);
    instance.onerror = () => setListening(false);
    recognition.current = instance;
    setListening(true);
    instance.start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn ${listening ? 'btn-primary' : 'btn-secondary'}`}
      aria-pressed={listening}
    >
      {listening ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
      {listening ? 'Stop' : 'Dictate'}
    </button>
  );
}
