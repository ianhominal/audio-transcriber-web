/** Límite de transcripciones que un usuario puede crear por día. */
export const DAILY_LIMIT = 50;

/** True si `count` ya alcanzó o superó `limit` (límite diario de transcripciones). */
export function isOverDailyLimit(count: number, limit: number): boolean {
  return count >= limit;
}
