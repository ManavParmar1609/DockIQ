/**
 * EAN-13 symbol encoding, so each order line can show the barcode of the case the operator should
 * be scanning (Scenario 3). Pure; tested in ean13.test.ts.
 */

const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
// Which of L/G each of the first-group digits uses, keyed by the leading digit.
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

export function checkDigit(body12: string): number {
  const sum = Array.from(body12).reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10;
}

/** Accepts a GTIN-14 with a leading 0, a GTIN-13, or a 12-digit body; returns the 13 digits. */
export function toEan13(code: string): string | null {
  const digits = code.replace(/\D/g, '');
  const thirteen = digits.length === 14 && digits.startsWith('0') ? digits.slice(1) : digits;
  if (thirteen.length === 12) return thirteen + String(checkDigit(thirteen));
  if (thirteen.length !== 13) return null;
  return checkDigit(thirteen.slice(0, 12)) === Number(thirteen[12]) ? thirteen : null;
}

/** The 95 modules of an EAN-13 symbol as '1'/'0'. */
export function encodeEan13(ean13: string): string {
  const digits = Array.from(ean13, Number);
  const [lead = 0, ...rest] = digits;
  const parity = PARITY[lead] ?? 'LLLLLL';
  let bits = '101';
  rest.slice(0, 6).forEach((digit, index) => {
    bits += (parity[index] === 'G' ? G : L)[digit] ?? '';
  });
  bits += '01010';
  rest.slice(6, 12).forEach((digit) => {
    bits += R[digit] ?? '';
  });
  return bits + '101';
}
