/**
 * Robust pt-BR monetary string parser.
 * Handles: "7,91" → 7.91, "5.000,00" → 5000, "5000" → 5000, "100.00" → 100,
 *          "1.234.567,89" → 1234567.89, "R$ 1.000" → 1000, "" → 0,
 *          "-7,91" → -7.91, "5.000" → 5000
 */
export function parseMoney(raw: string | number): number {
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  if (!raw || typeof raw !== 'string') return 0;

  let s = raw.trim().replace(/\s/g, '');
  // Remove currency symbol
  s = s.replace(/R\$\s?/gi, '');
  // Preserve negative sign
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);

  if (s === '') return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // "5.000,00" or "1.234.567,89" → remove dots, replace comma with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Only comma: "7,91" → replace comma with dot
    s = s.replace(',', '.');
  } else if (hasDot) {
    // Only dot: check if it's pt-BR thousands separator
    // "5.000" → 5000, "1.234.567" → 1234567
    // But "100.50" → 100.50 (decimal)
    const dotParts = s.split('.');
    // If ALL groups after the first dot have exactly 3 digits, it's thousands
    const allThousands = dotParts.slice(1).every(part => part.length === 3);
    if (allThousands && dotParts.length >= 2) {
      s = s.replace(/\./g, '');
    }
    // else "100.00" stays as 100.00
  }

  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return negative ? -n : n;
}
