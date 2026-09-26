/** Whether (and how) the tablet camera can read barcodes: BarcodeDetector, where the browser has it. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** True where the tablet camera can read barcodes (BarcodeDetector + a camera API). */
export function hasBarcodeCamera(): boolean {
  return detectorCtor() !== null && 'mediaDevices' in navigator;
}

export function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}
