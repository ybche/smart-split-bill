// Indonesian phone number normalization (ported as-is from server.ts)
export function normalizeIndonesianPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    digits = "62" + digits.substring(1);
  }
  return digits;
}
