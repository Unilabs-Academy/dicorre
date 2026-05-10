import { describe, it, expect } from 'vitest'
import { configId } from './configId'

describe('configId', () => {
  it('is deterministic for same object regardless of key order', async () => {
    const a = { x: 1, y: { b: 2, a: 3 }, arr: [1, 2, 3] }
    const b = { arr: [1, 2, 3], y: { a: 3, b: 2 }, x: 1 }
    const idA = await configId(a, { len: 8 })
    const idB = await configId(b, { len: 8 })
    expect(idA).toEqual(idB)
    expect(idA).toHaveLength(8)
  })

  it('changes when values change', async () => {
    const a = { foo: 'bar' }
    const b = { foo: 'baz' }
    const idA = await configId(a, { len: 8 })
    const idB = await configId(b, { len: 8 })
    expect(idA).not.toEqual(idB)
  })

  it('ignores specified keys', async () => {
    const a = { projectName: 'A', settings: { opt: true } }
    const b = { projectName: 'B', settings: { opt: true } }
    const idA = await configId(a, { len: 8, ignoreKeys: ['projectName'] })
    const idB = await configId(b, { len: 8, ignoreKeys: ['projectName'] })
    expect(idA).toEqual(idB)
  })
})


