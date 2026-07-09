export function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function keyToDate(key: string) {
  const [year = "0", month = "1", day = "1"] = key.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
