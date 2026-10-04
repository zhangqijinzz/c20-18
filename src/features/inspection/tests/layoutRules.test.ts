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

  it('counts overlapping items only once instead of summing every footprint', () => {
    const plan = createPlan('test', false)
    const first = { ...createItem('lamp'), x: 200, y: 200, widthMm: 200, heightMm: 100 }
    const second = { ...createItem('speaker'), x: 200, y: 200, widthMm: 200, heightMm: 100 }
    const analysis = analyzeLayout({ ...plan, items: [first, second] })
    // 桌面 1600×800，完全重合时覆盖等于一件：20000 / 1280000 ≈ 2%，而不是累加的 3%
    expect(analysis.coveragePercent).toBe(2)
  })

  it('grows coverage when an item is rotated, following its projected footprint', () => {
    const plan = createPlan('test', false)
    const upright = { ...createItem('monitor'), x: 600, y: 300, widthMm: 400, heightMm: 200, rotation: 0 }
    const rotated = { ...upright, rotation: 45 }
    const uprightAnalysis = analyzeLayout({ ...plan, items: [upright] })
    const rotatedAnalysis = analyzeLayout({ ...plan, items: [rotated] })
    expect(uprightAnalysis.coveragePercent).toBe(6)
    expect(rotatedAnalysis.coveragePercent).toBe(14)
    expect(rotatedAnalysis.coveragePercent).toBeGreaterThan(uprightAnalysis.coveragePercent)
  })

  it('reports coverage above 100% honestly and flags the desk as over capacity', () => {
    const plan = createPlan('test', false)
    const huge = { ...createItem('stand'), x: 0, y: 0, widthMm: 1000, heightMm: 1000 }
    const analysis = analyzeLayout({ ...plan, deskWidthMm: 600, deskHeightMm: 600, items: [huge] })
    expect(analysis.coveragePercent).toBe(278)
    expect(analysis.overCapacity).toBe(true)
    expect(analysis.status).toBe('attention')
  })

  it('stays finite with a degenerate desk size and with many duplicated items', () => {
    const emptyDesk = createPlan('test', false)
    const emptyAnalysis = analyzeLayout({ ...emptyDesk, deskWidthMm: 0, deskHeightMm: 0 })
    expect(Number.isFinite(emptyAnalysis.coveragePercent)).toBe(true)
    expect(emptyAnalysis.coveragePercent).toBe(0)
    expect(emptyAnalysis.overCapacity).toBe(false)

    const item = { ...createItem('speaker'), x: 0, y: 0, widthMm: 100, heightMm: 100 }
    const crowdedDesk = createPlan('test', false)
    const crowdedAnalysis = analyzeLayout({
      ...crowdedDesk,
      deskWidthMm: 0,
      deskHeightMm: 0,
      items: Array.from({ length: 300 }, () => ({ ...item })),
    })
    expect(crowdedAnalysis.coveragePercent).toBe(999)
    expect(crowdedAnalysis.overCapacity).toBe(true)

    const duplicated = Array.from({ length: 500 }, (_, index) => ({ ...item, id: `${item.id}-${index}` }))
    const stable = analyzeLayout({ ...crowdedDesk, items: duplicated })
    expect(Number.isFinite(stable.coveragePercent)).toBe(true)
    // 500 件完全重合，覆盖仍等于一件：10000 / 1280000 ≈ 1%
    expect(stable.coveragePercent).toBe(1)
  })
})
