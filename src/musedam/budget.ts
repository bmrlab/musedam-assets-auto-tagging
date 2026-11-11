/** Ingress in front of the app closes the request at about 60s. */
export const MUSE_CALL_BUDGET_MS = 45_000;
export const MUSE_TIMEOUT_MESSAGE = "MuseDAM 请求超时，请稍后重试";

/** Remaining time for every upstream call in one user action. */
export function museCallBudget(budgetMs = MUSE_CALL_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  return () => {
    const left = deadline - Date.now();
    if (left < 1_000) throw new Error(MUSE_TIMEOUT_MESSAGE);
    return left;
  };
}
