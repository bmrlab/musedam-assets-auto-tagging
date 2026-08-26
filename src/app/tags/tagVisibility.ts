export const getTagVisibilityPreview = <T>(items: T[], maxVisible = 2) => {
  const visibleItems = items.slice(0, maxVisible);
  return {
    visibleItems,
    remainingCount: Math.max(items.length - visibleItems.length, 0),
  };
};
