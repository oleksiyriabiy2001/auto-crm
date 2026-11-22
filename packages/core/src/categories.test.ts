import { describe, expect, it } from 'vitest'
import { createsCategoryCycle } from './categories'

// Оливи
// └─ Моторні
//    └─ Синтетика
// Фільтри
const tree = [
  { id: 'oils', parentId: null },
  { id: 'motor', parentId: 'oils' },
  { id: 'synthetic', parentId: 'motor' },
  { id: 'filters', parentId: null },
]

describe('createsCategoryCycle', () => {
  it.each<[string, string | null]>([
    ['synthetic', 'filters'],
    ['motor', null],
    ['filters', 'synthetic'],
    ['new', 'synthetic'],
  ])('allows moving %s under %s', (id, parentId) => {
    expect(createsCategoryCycle(tree, id, parentId)).toBe(false)
  })

  it.each<[string, string]>([
    ['oils', 'oils'],
    ['oils', 'motor'],
    ['oils', 'synthetic'],
    ['motor', 'synthetic'],
  ])('rejects moving %s under %s', (id, parentId) => {
    expect(createsCategoryCycle(tree, id, parentId)).toBe(true)
  })

  it('stops on a tree that already has a cycle', () => {
    const broken = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]
    expect(createsCategoryCycle(broken, 'c', 'a')).toBe(false)
  })
})
