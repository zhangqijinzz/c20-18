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

interface CoverageInterval {
  start: number
  end: number
}

/**
 * 计算一组包围盒在平面上的真实覆盖面积（并集面积）：
 * 设备互相叠放的部分只计一次。按 y 坐标切条、合并 x 区间的扫描线方式实现，
 * 设备数量较多（大量重复摆放）时结果同样稳定。
 */
export function unionCoverageArea(allBounds: ItemBounds[]): number {
  const validBounds = allBounds.filter(
    (candidate) => Number.isFinite(candidate.left)
      && Number.isFinite(candidate.right)
      && candidate.right > candidate.left
      && candidate.bottom > candidate.top,
  )
  if (validBounds.length === 0) return 0

  const yCoordinates = [...new Set(validBounds.flatMap((candidate) => [candidate.top, candidate.bottom]))]
    .sort((first, second) => first - second)

  let area = 0
  for (let index = 0; index < yCoordinates.length - 1; index += 1) {
    const slabTop = yCoordinates[index]
    const slabBottom = yCoordinates[index + 1]
    if (slabBottom <= slabTop) continue

    const crossing = validBounds
      .filter((candidate) => candidate.top <= slabTop && candidate.bottom >= slabBottom)
      .map((candidate): CoverageInterval => ({ start: candidate.left, end: candidate.right }))
      .sort((first, second) => first.start - second.start)

    let slabWidth = 0
    let mergedStart = 0
    let mergedEnd = 0
    crossing.forEach((interval, intervalIndex) => {
      if (intervalIndex === 0 || interval.start > mergedEnd) {
        slabWidth += intervalIndex === 0 ? 0 : mergedEnd - mergedStart
        mergedStart = interval.start
        mergedEnd = interval.end
      } else {
        mergedEnd = Math.max(mergedEnd, interval.end)
      }
    })
    if (crossing.length > 0) slabWidth += mergedEnd - mergedStart

    area += slabWidth * (slabBottom - slabTop)
  }
  return area
}

export function analyzeLayout(plan: WorkspacePlan): LayoutAnalysis {
  const overlapIds = new Set<string>()
  const outOfBoundsIds = new Set<string>()
  const bounds = new Map(plan.items.map((item) => [item.id, getItemBounds(item)]))

  plan.items.forEach((item) => {
    const itemBounds = bounds.get(item.id)
    if (!itemBounds) return
    if (itemBounds.left < 0 || itemBounds.top < 0 || itemBounds.right > plan.deskWidthMm || itemBounds.bottom > plan.deskHeightMm) {
      outOfBoundsIds.add(item.id)
    }
  })

  for (let index = 0; index < plan.items.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < plan.items.length; nextIndex += 1) {
      const first = plan.items[index]
      const second = plan.items[nextIndex]
      const firstBounds = bounds.get(first.id)
      const secondBounds = bounds.get(second.id)
      if (firstBounds && secondBounds && rectanglesOverlap(firstBounds, secondBounds)) {
        overlapIds.add(first.id)
        overlapIds.add(second.id)
      }
    }
  }

  // 真实覆盖：每件设备取旋转后在桌面上的投影外接框，投影之间的重叠只计一次
  const occupiedArea = unionCoverageArea([...bounds.values()])
  const deskArea = plan.deskWidthMm * plan.deskHeightMm
  // 桌面被改小到没有可用面积时，只要还有设备就按最拥挤处理，避免出现 NaN / Infinity
  const coveragePercent = deskArea > 0
    ? Math.min(999, Math.round((occupiedArea / deskArea) * 100))
    : (occupiedArea > 0 ? 999 : 0)
  const overCapacity = deskArea > 0 ? occupiedArea > deskArea : occupiedArea > 0
  const hasIssue = overlapIds.size > 0 || outOfBoundsIds.size > 0 || overCapacity
  return {
    overlapIds: [...overlapIds],
    outOfBoundsIds: [...outOfBoundsIds],
    coveragePercent,
    overCapacity,
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
