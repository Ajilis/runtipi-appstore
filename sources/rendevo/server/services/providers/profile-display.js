export function profileDisplay(data) {
  return { name: String(data?.name || '').slice(0, 120) };
}
