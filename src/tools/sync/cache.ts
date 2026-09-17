/**
 * 卡牌详情本地缓存（localStorage）。
 * 目的：1266 次 cardDetail 请求量大且可能触发网关限流；
 * 缓存后重跑可跳过已拉取部分，实现续跑。
 */
import type { ApiCardDetail } from './riftboundApi'

const KEY = 'riftbound_sync_detail_cache_v1'

export function loadDetailCache(): Record<string, ApiCardDetail> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ApiCardDetail>) : {}
  } catch {
    return {}
  }
}

export function cacheCount(cache: Record<string, ApiCardDetail>): number {
  return Object.keys(cache).length
}

/** 写入缓存；超出配额时返回 false（不抛错） */
export function saveDetailCache(cache: Record<string, ApiCardDetail>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
    return true
  } catch {
    return false
  }
}

export function clearDetailCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
