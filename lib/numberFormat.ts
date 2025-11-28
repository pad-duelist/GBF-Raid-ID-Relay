export function formatNumberWithComma(n: number): string {
  const s = Math.floor(n).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
