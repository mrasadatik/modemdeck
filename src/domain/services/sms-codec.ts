/** Strategy facade for SMS encoding decisions; protocol remains the stable API. */
import { isGsm7, splitSms } from './protocol.js';
import type { DecodedPdu, PduSegment } from '../entities/types.js';

export const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
export const GSM7_EXT: Record<number, string> = {
  10: '\f',
  20: '^',
  40: '{',
  41: '}',
  47: '\\',
  60: '[',
  61: '~',
  62: ']',
  64: '|',
  101: '€',
};
const reverseExt: Record<string, number> = Object.fromEntries(
  Object.entries(GSM7_EXT).map(([key, value]) => [value, +key]),
);
const g7 = (values: number[]): string =>
  values.reduce((text: string, value: number, index: number, all: number[]) => {
    if (value === 27) return text;
    const previous = all[index - 1];
    return text + (previous === 27 ? GSM7_EXT[value] || ' ' : GSM7[value]);
  }, '');
const unpack7 = (bytes: Buffer, count: number, offset = 0): number[] =>
  Array.from({ length: count }, (_, i) => {
    const bit = offset + i * 7,
      byte = bit >> 3,
      shift = bit & 7;
    return (((bytes[byte] || 0) >> shift) | ((bytes[byte + 1] || 0) << (8 - shift))) & 127;
  });
const pack7 = (values: number[]): Buffer => {
  const out = Buffer.alloc(Math.ceil((values.length * 7) / 8));
  values.forEach((value, i) => {
    const bit = i * 7,
      byte = bit >> 3,
      shift = bit & 7;
    out[byte] |= (value << shift) & 255;
    if (shift > 1) out[byte + 1] |= value >> (8 - shift);
  });
  return out;
};
const swap = (value: number): number => (value & 15) * 10 + (value >> 4);
const pad = (value: number): string => String(value).padStart(2, '0');

export function decodePdu(hex: string): DecodedPdu | null {
  if (typeof hex !== 'string' || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = Buffer.from(hex, 'hex');
  // Minimum deliver PDU: SMSC len + MTI octet + length/type + address(1) + PID + DCS + SCTS(7) + UDL = 13
  if (bytes.length < 13) return null;
  let p = 1 + bytes[0];
  if (p + 1 > bytes.length) return null;
  const flags = bytes[p++];
  const mti = flags & 3;
  // SMS-DELIVER (0) is the common path; SMS-SUBMIT (1, stored sent mail) and
  // SMS-STATUS-REPORT (2, delivery receipts) appear in modem/SIM storage too.
  if (mti !== 0 && mti !== 1 && mti !== 2) return null;
  if (mti === 2) return decodeStatusReport(bytes, p);
  if (mti === 1) {
    p++; // SMS-SUBMIT carries a message reference octet here; DELIVER does not.
    if (p >= bytes.length) return null;
  }
  const addressLength = bytes[p++];
  if (p + 2 > bytes.length) return null;
  const type = bytes[p++],
    addressBytes = Math.ceil(addressLength / 2);
  if (p + addressBytes > bytes.length) return null;
  const from = decodeAddress(bytes, p, addressLength, type, addressBytes);
  p += addressBytes;
  if (mti === 1) return decodeSubmit(bytes, p, from, flags);
  if (p + 10 > bytes.length) return null;
  p++;
  const dcs = bytes[p++],
    timestamp = bytes.subarray(p, p + 7);
  p += 7;
  const ts = decodeTimestamp(timestamp);
  if (!ts) return null;
  const userLength = bytes[p++],
    userData = bytes.subarray(p);
  if (userLength > userData.length) return null;
  let ref = 0,
    seq = 1,
    total = 1,
    headerBytes = 0;
  if (flags & 0x40) {
    const parsed = parseConcatHeader(userData);
    ref = parsed.ref;
    seq = parsed.seq;
    total = parsed.total;
    headerBytes = parsed.headerBytes;
  }
  const text = decodeUserData(userData, userLength, headerBytes, dcs);
  return { from, ts, text, ref, seq, total };
}

function decodeAddress(
  bytes: Buffer,
  p: number,
  addressLength: number,
  type: number,
  addressBytes: number,
): string {
  if (((type >> 4) & 7) === 5)
    return g7(unpack7(bytes.subarray(p, p + addressBytes), Math.floor((addressLength * 4) / 7)));
  let digits = '';
  for (let i = 0; i < addressBytes; i++)
    digits += (bytes[p + i] & 15).toString(16) + (bytes[p + i] >> 4).toString(16);
  return (((type >> 4) & 7) === 1 ? '+' : '') + digits.replace(/f/gi, '').slice(0, addressLength);
}

function decodeTimestamp(timestamp: Buffer): string | null {
  if (timestamp.length < 7) return null;
  const tz = timestamp[6],
    quarterHours = (tz & 7) * 10 + (tz >> 4);
  return `20${pad(swap(timestamp[0]))}-${pad(swap(timestamp[1]))}-${pad(swap(timestamp[2]))}T${pad(swap(timestamp[3]))}:${pad(swap(timestamp[4]))}:${pad(swap(timestamp[5]))}${tz & 8 ? '-' : '+'}${pad(Math.floor(quarterHours / 4))}:${pad((quarterHours % 4) * 15)}`;
}

function parseConcatHeader(userData: Buffer): {
  ref: number;
  seq: number;
  total: number;
  headerBytes: number;
} {
  let ref = 0,
    seq = 1,
    total = 1;
  const length = userData[0];
  const headerBytes = length + 1;
  for (let i = 1; i < length && i + 2 <= (userData[0] ?? 0);) {
    const id = userData[i],
      size = userData[i + 1];
    if (size === undefined || i + 2 + size > userData.length) break;
    if (id === 0) {
      ref = userData[i + 2];
      total = userData[i + 3];
      seq = userData[i + 4];
    } else if (id === 8) {
      ref = (userData[i + 2] << 8) | userData[i + 3];
      total = userData[i + 4];
      seq = userData[i + 5];
    }
    i += 2 + size;
  }
  return { ref, seq, total, headerBytes };
}

function decodeUserData(
  userData: Buffer,
  userLength: number,
  headerBytes: number,
  dcs: number,
): string {
  if ((dcs & 12) === 8) {
    const unicode = Buffer.from(userData.subarray(headerBytes, userLength));
    return unicode
      .subarray(0, unicode.length & ~1)
      .swap16()
      .toString('utf16le');
  }
  if ((dcs & 12) === 4) return userData.subarray(headerBytes, userLength).toString('latin1');
  return g7(
    unpack7(userData, Math.max(0, userLength - Math.ceil((headerBytes * 8) / 7)), headerBytes * 8),
  );
}

/** SMS-SUBMIT as stored by other devices (sent mail kept on SIM/modem). No timestamp on the air. */
function decodeSubmit(bytes: Buffer, p: number, from: string, flags: number): DecodedPdu | null {
  p++;
  const dcs = bytes[p++];
  let vpLength = 0;
  const vpf = (flags >> 3) & 3;
  if (vpf === 2) vpLength = 1;
  else if (vpf === 3) vpLength = 7;
  p += vpLength;
  if (p >= bytes.length) return null;
  const userLength = bytes[p++],
    userData = bytes.subarray(p);
  if (userLength > userData.length) return null;
  let ref = 0,
    seq = 1,
    total = 1,
    headerBytes = 0;
  if (flags & 0x40) {
    const parsed = parseConcatHeader(userData);
    ref = parsed.ref;
    seq = parsed.seq;
    total = parsed.total;
    headerBytes = parsed.headerBytes;
  }
  const text = decodeUserData(userData, userLength, headerBytes, dcs);
  return { from, ts: '', text, ref, seq, total };
}

const STATUS_WORDS: Record<number, string> = {
  0: 'delivered',
  1: 'forwarded, destination unreachable',
  2: 'forwarded, destination unknown',
  4: 'forwarded, destination absent (retrying)',
  16: 'forwarded',
  32: 'memory capacity exceeded',
  33: 'protocol error',
  64: 'expired',
  96: 'deleted by sender',
};

/** SMS-STATUS-REPORT (delivery receipts kept in SR storage). */
function decodeStatusReport(bytes: Buffer, p: number): DecodedPdu | null {
  p++;
  const addressLength = bytes[p++];
  if (p + 2 > bytes.length) return null;
  const type = bytes[p++],
    addressBytes = Math.ceil(addressLength / 2);
  if (p + addressBytes + 15 > bytes.length) return null;
  const from = decodeAddress(bytes, p, addressLength, type, addressBytes);
  p += addressBytes;
  const ts = decodeTimestamp(bytes.subarray(p, p + 7));
  if (!ts) return null;
  p += 7;
  const deliveredAt = decodeTimestamp(bytes.subarray(p, p + 7));
  p += 7;
  if (p >= bytes.length) return null;
  const status = bytes[p],
    word = STATUS_WORDS[status] ?? `status ${status}`;
  return {
    from,
    ts,
    text: `Delivery report: ${word}${deliveredAt ? ` at ${deliveredAt}` : ''}.`,
    ref: 0,
    seq: 1,
    total: 1,
  };
}

function address(number: string): Buffer {
  const plus = number.trim().startsWith('+'),
    digits = number.replace(/\D/g, ''),
    encoded = digits.length % 2 ? digits + 'F' : digits;
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 2) bytes.push(parseInt(encoded[i + 1] + encoded[i], 16));
  return Buffer.from([digits.length, plus ? 0x91 : 0x81, ...bytes]);
}

export function encodeSubmitPdus(to: string, text: string): PduSegment[] {
  const gsm = isGsm7(text),
    parts = splitSms(text),
    reference = Math.floor(Math.random() * 256),
    multi = parts.length > 1;
  return parts.map((part, index) => {
    const header = multi
      ? Buffer.from([5, 0, 3, reference, parts.length, index + 1])
      : Buffer.alloc(0);
    let userData, length;
    if (gsm) {
      const values = [...part].flatMap((character: string): number[] => {
        const value = GSM7.indexOf(character);
        return value >= 0 ? [value] : [27, reverseExt[character] ?? 32];
      });
      userData = multi
        ? (() => {
            const bits = header.length * 8,
              out = Buffer.alloc(Math.ceil((bits + values.length * 7) / 8));
            header.copy(out);
            values.forEach((value, i) => {
              const bit = bits + i * 7,
                byte = bit >> 3,
                shift = bit & 7;
              out[byte] |= (value << shift) & 255;
              if (shift > 1) out[byte + 1] |= value >> (8 - shift);
            });
            return out;
          })()
        : pack7(values);
      length = multi ? Math.ceil((header.length * 8 + values.length * 7) / 7) : values.length;
    } else {
      const unicode = Buffer.from(part, 'utf16le').swap16();
      userData = multi ? Buffer.concat([header, unicode]) : unicode;
      length = userData.length;
    }
    const pdu = Buffer.concat([
      Buffer.from([multi ? 0x41 : 0x01, 0]),
      address(to),
      Buffer.from([0, gsm ? 0 : 8, length]),
      userData,
    ]);
    return { length: pdu.length, hex: `00${pdu.toString('hex').toUpperCase()}` };
  });
}

export class SmsEncodingStrategy {
  canEncode(text: string): boolean {
    return isGsm7(text);
  }
  split(text: string): string[] {
    return splitSms(text);
  }
  dataCodingScheme(text: string): number {
    return this.canEncode(text) ? 0 : 8;
  }
  encodeSubmitPdus(to: string, text: string): PduSegment[] {
    return encodeSubmitPdus(to, text);
  }
}

export function createSmsCodec() {
  return new SmsEncodingStrategy();
}
