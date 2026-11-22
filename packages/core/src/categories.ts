export interface CategoryNode {
  id: string
  parentId: string | null
}

// True if putting category `id` under `parentId` would make it its own
// ancestor. `id` may be new (not in `categories` yet). The walk is capped at
// the number of categories, so a tree that is already broken cannot loop.
export const createsCategoryCycle = (
  categories: readonly CategoryNode[],
  id: string,
  parentId: string | null,
): boolean => {
  const parents = new Map(categories.map((category) => [category.id, category.parentId]))
  let current = parentId
  for (let steps = 0; current !== null && steps <= parents.size; steps++) {
    if (current === id) return true
    current = parents.get(current) ?? null
  }
  return false
}
