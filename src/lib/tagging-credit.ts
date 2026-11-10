/** Per-asset price follows the image mode captured when the task is enqueued. */
export function getTaggingCreditCost(featureImageMode: boolean): 1 | 2 {
  return featureImageMode ? 2 : 1;
}
