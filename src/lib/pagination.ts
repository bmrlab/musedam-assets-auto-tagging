export function getVisiblePageNumbers(
  currentPage: number,
  totalPages: number,
  maxVisiblePages = 5,
) {
  const normalizedTotal = Math.max(1, Math.floor(totalPages));
  const visibleCount = Math.min(Math.max(1, Math.floor(maxVisiblePages)), normalizedTotal);
  const normalizedCurrent = Math.min(Math.max(1, Math.floor(currentPage)), normalizedTotal);
  const startPage = Math.min(
    Math.max(1, normalizedCurrent - Math.floor(visibleCount / 2)),
    normalizedTotal - visibleCount + 1,
  );

  return Array.from({ length: visibleCount }, (_, index) => startPage + index);
}
