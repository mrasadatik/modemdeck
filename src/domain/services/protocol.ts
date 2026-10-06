export const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
export const GSM7_EXT = new Set<string>(['\f', '^', '{', '}', '\\', '[', '~', ']', '|', '€']);

export function isGsm7(text: string): boolean {
  return [...String(text)].every((c) => GSM7.includes(c) || GSM7_EXT.has(c));
}

export function splitSms(text: string): string[] {
  const value = String(text ?? '');
  if (isGsm7(value)) {
    const units = [...value].reduce((n, c) => n + (GSM7_EXT.has(c) ? 2 : 1), 0);
    if (units <= 160) return [value];
    const out: string[] = [];
    let part = '',
      count = 0;
    for (const c of [...value]) {
      const size = GSM7_EXT.has(c) ? 2 : 1;
      if (count + size > 153) {
        out.push(part);
        part = '';
        count = 0;
      }
      part += c;
      count += size;
    }
    if (part) out.push(part);
    return out;
  }
  const segmenter =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  const chars = segmenter ? [...segmenter.segment(value)].map((part) => part.segment) : [...value];
  // Segment on grapheme clusters so combining marks and emoji are never split.
  // Modems differ in how they count supplementary characters; 67 clusters is
  // the interoperable limit used by the UCS-2 submit path.
  const units = (_part: string): number => 1;
  if (chars.reduce((n, part) => n + units(part), 0) <= 70) return [value];
  const out: string[] = [];
  let part = '',
    count = 0;
  for (const character of chars) {
    const size = units(character);
    if (count + size > 67) {
      out.push(part);
      part = '';
      count = 0;
    }
    part += character;
    count += size;
  }
  if (part) out.push(part);
  return out;
}

export function validatePhone(value: string): boolean {
  const text = String(value ?? '').trim();
  return /^(?:\+?[1-9]\d{2,14}|[1-9]\d{2,20})$/.test(text);
}

export function validateUssd(value: string): boolean {
  const text = String(value ?? '').trim();
  return /^\*[\d*#]{1,80}#$/.test(text);
}
