import { describe, expect, it } from 'vitest'
import { createPlan, createItem } from '../../../shared/models'
import { analyzeLayout, getItemBounds, normalizeRotation } from '../../../shared/layoutRules'

describe('workspace rules', () => {
  it('normalizes rotation and calculates rotated bounds around the item center', () => {
    const item = { ...createItem('monitor'), x: 100, y: 100, widthMm: 400, heightMm: 200, rotation: 90 }
    const bounds = getItemBounds(item)
    expect(normalizeRotation(-15)).toBe(345)
    expect(Math.round(bounds.width)).toBe(200)
    expect(Math.round(bounds.height)).toBe(400)
    expect(Math.round(bounds.left)).toBe(200)
  })

  it('detects overlap and out-of-bounds items', () => {
    const plan = createPlan('test', false)
    const first = { ...createItem('monitor'), x: 100, y: 100, widthMm: 400, heightMm: 200 }
    const second = { ...createItem('keyboard'), x: 300, y: 150, widthMm: 400, heightMm: 200 }
    const outside = { ...createItem('lamp'), x: 1500, y: 700 }
    const analysis = analyzeLayout({ ...plan, items: [first, second, outside] })
    expect(analysis.overlapIds).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(analysis.outOfBoundsIds).toContain(outside.id)
    expect(analysis.status).toBe('attention')
  })

  it('returns a healthy state for separated items', () => {
    const plan = createPlan('test', false)
    const first = { ...createItem('monitor'), x: 100, y: 100 }
    const second = { ...createItem('keyboard'), x: 800, y: 500 }
    const analysis = analyzeLayout({ ...plan, items: [first, second] })
    expect(analysis.status).toBe('clear')
    expect(analysis.coveragePercent).toBeGreaterThan(0)
  })

  it('counts overlapping projections only once', () => {
    const plan = createPlan('test', false)
    const first = { ...createItem('monitor'), x: 100, y: 100, widthMm: 400, heightMm: 200, rotation: 0 }
    const second = { ...createItem('keyboard'), x: 100, y: 100, widthMm: 400, heightMm: 200, rotation: 0 }
    const analysis = analyzeLayout({ ...plan, items: [first, second] })
    // 并集 400×200=80000，桌面 1600×800=1280000 → 6.25%，重叠部分不重复计数
    expect(analysis.coveragePercent).toBe(6)
  })

  it('stays stable when many identical items are stacked on the same spot', () => {
    const plan = createPlan('test', false)
    const items = Array.from({ length: 50 }, () => ({ ...createItem('monitor'), x: 100, y: 100, widthMm: 400, heightMm: 200, rotation: 0 }))
    const analysis = analyzeLayout({ ...plan, items })
    expect(analysis.coveragePercent).toBe(6)
    expect(Number.isFinite(analysis.coveragePercent)).toBe(true)
  })

  it('measures rotated items by their projected footprint', () => {
    const plan = createPlan('test', false)
    const straight = analyzeLayout({ ...plan, items: [{ ...createItem('monitor'), x: 200, y: 100, widthMm: 400, heightMm: 200, rotation: 0 }] })
    const rotated = analyzeLayout({ ...plan, items: [{ ...createItem('monitor'), x: 200, y: 100, widthMm: 400, heightMm: 200, rotation: 45 }] })
    // 0° 投影 80000mm²（6%）；45° 投影约 600/√2 见方 ≈ 180000mm²（14%）
    expect(straight.coveragePercent).toBe(6)
    expect(rotated.coveragePercent).toBe(14)
    expect(rotated.coveragePercent).toBeGreaterThan(straight.coveragePercent)
  })

  it('reports coverage above 100% truthfully instead of clamping it', () => {
    const plan = createPlan('test', false)
    const huge = { ...createItem('monitor'), x: 0, y: 0, widthMm: 1200, heightMm: 1200, rotation: 0 }
    const analysis = analyzeLayout({ ...plan, items: [huge] })
    // 1440000 / 1280000 = 112.5% → 113%，不再被压到 100
    expect(analysis.coveragePercent).toBe(113)
    expect(analysis.isCrowded).toBe(true)
    expect(analysis.status).toBe('attention')
  })

  it('flags a fully tiled desk as crowded even without overlaps or out-of-bounds items', () => {
    const plan = createPlan('test', false)
    const top = { ...createItem('monitor'), x: 0, y: 0, widthMm: 1600, heightMm: 400, rotation: 0 }
    const bottom = { ...createItem('monitor'), x: 0, y: 400, widthMm: 1600, heightMm: 400, rotation: 0 }
    const analysis = analyzeLayout({ ...plan, items: [top, bottom] })
    expect(analysis.overlapIds).toHaveLength(0)
    expect(analysis.outOfBoundsIds).toHaveLength(0)
    expect(analysis.coveragePercent).toBe(100)
    expect(analysis.isCrowded).toBe(true)
    expect(analysis.status).toBe('attention')
  })

  it('returns finite results when the desk is shrunk to an unusable size', () => {
    const plan = createPlan('test', false)
    const item = { ...createItem('monitor'), x: 100, y: 100 }
    const withItems = analyzeLayout({ ...plan, deskWidthMm: 0, deskHeightMm: 0, items: [item] })
    expect(withItems.coveragePercent).toBe(100)
    expect(withItems.isCrowded).toBe(true)
    expect(Number.isNaN(withItems.coveragePercent)).toBe(false)
    const empty = analyzeLayout({ ...plan, deskWidthMm: 0, deskHeightMm: 0, items: [] })
    expect(empty.coveragePercent).toBe(0)
    expect(empty.status).toBe('clear')
  })

  it('ignores items with corrupted dimensions instead of producing NaN', () => {
    const plan = createPlan('test', false)
    const broken = { ...createItem('monitor'), x: 100, y: 100, widthMm: Number.NaN, heightMm: 200 }
    const analysis = analyzeLayout({ ...plan, items: [broken] })
    expect(Number.isFinite(analysis.coveragePercent)).toBe(true)
    expect(analysis.coveragePercent).toBe(0)
    expect(analysis.overlapIds).toEqual([])
  })
})
