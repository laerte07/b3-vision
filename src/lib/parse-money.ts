/**
 * Robust pt-BR monetary string parser.
 * Handles: "7,91" → 7.91, "5.000,00" → 5000, "5000" → 5000, "100.00" → 100, "" → 0
 */
export function parseMoney(raw: string | number): number {
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  if (!raw || typeof raw !== 'string') return 0;

  let s = raw.trim().replace(/\s/g, '');
  // Remove currency symbol
  s = s.replace(/R\$\s?/gi, '');

  if (s === '') return 0;

  // Detect pt-BR format: dots as thousands, comma as decimal
  // e.g. "5.000,00" or "7,91"
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Both present: "5.000,00" → remove dots, replace comma with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Only comma: "7,91" → replace comma with dot
    s = s.replace(',', '.');
  }
  // If only dot: could be "5000.00" (English) or "5.000" (pt-BR thousands)
  // Heuristic: if dot is followed by exactly 3 digits at end, it's thousands separator
  else if (hasDot) {
    const match = s.match(/^(\d+)\.(\d{3})$/);
    if (match) {
      // "5.000" → 5000 (thousands separator)
      s = s.replace('.', '');
    }
    // else "100.00" stays as 100.00
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
