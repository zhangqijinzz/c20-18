import type { DeskItem, ItemBounds, LayoutAnalysis, WorkspacePlan } from './models'

export function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function getItemBounds(item: DeskItem): ItemBounds {
  const radians = (normalizeRotation(item.rotation) * Math.PI) / 180
  const width = Math.abs(item.widthMm * Math.cos(radians)) + Math.abs(item.heightMm * Math.sin(radians))
  const height = Math.abs(item.widthMm * Math.sin(radians)) + Math.abs(item.heightMm * Math.cos(radians))
  const centerX = item.x + item.widthMm / 2
  const centerY = item.y + item.heightMm / 2
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
    width,
    height,
  }
}

export function rectanglesOverlap(first: ItemBounds, second: ItemBounds): boolean {
  const horizontal = Math.min(first.right, second.right) - Math.max(first.left, second.left)
  const vertical = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
  return horizontal > 1 && vertical > 1
}

interface ProjectedRect {
  left: number
  right: number
  top: number
  bottom: number
}

/** 数据可能来自损坏的本地存储，尺寸/坐标非法时跳过该设备，避免污染计算结果 */
function isValidProjectedRect(rect: ItemBounds): rect is ItemBounds {
  return Number.isFinite(rect.left) && Number.isFinite(rect.right)
    && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)
    && rect.right > rect.left && rect.bottom > rect.top
}

interface SweepEvent {
  x: number
  kind: 'start' | 'end'
  top: number
  bottom: number
}

/**
 * 多个轴对齐矩形的并集面积（扫描线法）：
 * 重叠区域只计一次，完全重合的设备也不会重复累加。
 */
export function unionRectanglesArea(rects: ProjectedRect[]): number {
  const events: SweepEvent[] = []
  rects.forEach((rect) => {
    events.push({ x: rect.left, kind: 'start', top: rect.top, bottom: rect.bottom })
    events.push({ x: rect.right, kind: 'end', top: rect.top, bottom: rect.bottom })
  })
  events.sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x
    // 同一坐标先移除后加入，相邻但不重叠的矩形不会被并成一段
    return a.kind === 'end' ? -1 : 1
  })

  let area = 0
  let sweepX = 0
  const active: Array<{ top: number; bottom: number }> = []
  const mergedLength = (): number => {
    if (active.length === 0) return 0
    const sorted = [...active].sort((a, b) => a.top - b.top)
    let length = 0
    let current = { ...sorted[0] }
    for (let index = 1; index < sorted.length; index += 1) {
      const segment = sorted[index]
      if (segment.top <= current.bottom) {
        current.bottom = Math.max(current.bottom, segment.bottom)
      } else {
        length += current.bottom - current.top
        current = { ...segment }
      }
    }
    return length + current.bottom - current.top
  }

  events.forEach((event) => {
    if (event.x !== sweepX) {
      area += (event.x - sweepX) * mergedLength()
      sweepX = event.x
    }
    const interval = { top: event.top, bottom: event.bottom }
    if (event.kind === 'start') {
      active.push(interval)
    } else {
      const index = active.findIndex((item) => item.top === interval.top && item.bottom === interval.bottom)
      if (index >= 0) active.splice(index, 1)
    }
  })
  return area
}

export function analyzeLayout(plan: WorkspacePlan): LayoutAnalysis {
  const overlapIds = new Set<string>()
  const outOfBoundsIds = new Set<string>()

  // 每件设备按旋转后的轴对齐投影框参与计算，而非原始宽高
  const entries = plan.items.map((item) => ({ item, bounds: getItemBounds(item) }))
    .filter((entry) => isValidProjectedRect(entry.bounds))
  const bounds = new Map(entries.map((entry) => [entry.item.id, entry.bounds]))

  entries.forEach(({ item, bounds: itemBounds }) => {
    if (itemBounds.left < 0 || itemBounds.top < 0 || itemBounds.right > plan.deskWidthMm || itemBounds.bottom > plan.deskHeightMm) {
      outOfBoundsIds.add(item.id)
    }
  })

  for (let index = 0; index < entries.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex += 1) {
      const first = entries[index].item
      const second = entries[nextIndex].item
      const firstBounds = bounds.get(first.id)
      const secondBounds = bounds.get(second.id)
      if (firstBounds && secondBounds && rectanglesOverlap(firstBounds, secondBounds)) {
        overlapIds.add(first.id)
        overlapIds.add(second.id)
      }
    }
  }

  // 并集面积：重叠部分只计一次；面积不做裁剪，越界摆放同样如实计入占用
  const occupiedArea = unionRectanglesArea(entries.map((entry) => entry.bounds))
  const deskArea = plan.deskWidthMm * plan.deskHeightMm
  const hasUsableDesk = Number.isFinite(deskArea) && deskArea > 0
  // 桌面被改到无法使用（面积为 0 等异常情况）时，只要还有设备就视为挤满
  const ratio = hasUsableDesk ? occupiedArea / deskArea : (occupiedArea > 0 ? 1 : 0)
  const coveragePercent = Math.max(0, Math.round(ratio * 100))
  const isCrowded = coveragePercent >= 100
  const hasIssue = overlapIds.size > 0 || outOfBoundsIds.size > 0 || isCrowded
  return {
    overlapIds: [...overlapIds],
    outOfBoundsIds: [...outOfBoundsIds],
    coveragePercent,
    isCrowded,
    status: hasIssue ? 'attention' : 'clear',
  }
}

export function clampDeskSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(4000, Math.max(600, Math.round(value)))
}

export function clampItemDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(2000, Math.max(40, Math.round(value)))
}
