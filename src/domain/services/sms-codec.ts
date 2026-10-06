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
  if ((flags & 3) !== 0) return null;
  const addressLength = bytes[p++];
  if (p + 2 > bytes.length) return null;
  const type = bytes[p++],
    addressBytes = Math.ceil(addressLength / 2);
  if (p + addressBytes + 10 > bytes.length) return null;
  let from;
  if (((type >> 4) & 7) === 5)
    from = g7(unpack7(bytes.subarray(p, p + addressBytes), Math.floor((addressLength * 4) / 7)));
  else {
    let digits = '';
    for (let i = 0; i < addressBytes; i++)
      digits += (bytes[p + i] & 15).toString(16) + (bytes[p + i] >> 4).toString(16);
    from = (((type >> 4) & 7) === 1 ? '+' : '') + digits.replace(/f/gi, '').slice(0, addressLength);
  }
  p += addressBytes;
  if (p + 10 > bytes.length) return null;
  p++;
  const dcs = bytes[p++],
    timestamp = bytes.subarray(p, p + 7);
  p += 7;
  const tz = timestamp[6],
    quarterHours = (tz & 7) * 10 + (tz >> 4);
  const ts = `20${pad(swap(timestamp[0]))}-${pad(swap(timestamp[1]))}-${pad(swap(timestamp[2]))}T${pad(swap(timestamp[3]))}:${pad(swap(timestamp[4]))}:${pad(swap(timestamp[5]))}${tz & 8 ? '-' : '+'}${pad(Math.floor(quarterHours / 4))}:${pad((quarterHours % 4) * 15)}`;
  const userLength = bytes[p++],
    userData = bytes.subarray(p);
  if (userLength > userData.length) return null;
  let ref = 0,
    seq = 1,
    total = 1,
    headerBytes = 0;
  if (flags & 0x40) {
    const length = userData[0];
    headerBytes = length + 1;
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
  }
  let text;
  if ((dcs & 12) === 8) {
    const unicode = Buffer.from(userData.subarray(headerBytes, userLength));
    text = unicode
      .subarray(0, unicode.length & ~1)
      .swap16()
      .toString('utf16le');
  } else if ((dcs & 12) === 4) text = userData.subarray(headerBytes, userLength).toString('latin1');
  else
    text = g7(
      unpack7(
        userData,
        Math.max(0, userLength - Math.ceil((headerBytes * 8) / 7)),
        headerBytes * 8,
      ),
    );
  return { from, ts, text, ref, seq, total };
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
