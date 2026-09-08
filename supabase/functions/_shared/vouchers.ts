const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion when printed

export function generateVoucherCode(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 4) code += "-";
  }
  return code;
}

// Codes are stored as XXXXX-XXXXX, but phone keyboards/autocomplete drop or
// mangle the dash and customers shouldn't have to type it exactly — strip
// everything but alphanumerics, then re-insert the dash at its canonical
// position so lookups match regardless of how the customer typed it.
export function normalizeVoucherCode(input: string): string {
  const stripped = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return stripped.length === 10 ? `${stripped.slice(0, 5)}-${stripped.slice(5)}` : stripped;
}
