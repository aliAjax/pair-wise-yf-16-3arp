// 存储层：仅负责浏览器本地持久化与预置数据（localStorage，不依赖任何后端）

import type { StoreState } from "./rules";

const STORAGE_KEY = "hxyfront-62004-snowboard-dispatch-v1";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// 预置数据：3 名技师、3 个工位、7 张覆盖各场景的工单
export function createSeedState(): StoreState {
  return {
    technicians: [
      // 陈岩余时 45 分钟，不足以接 60 分钟以上的单（用于校验技师余时拒绝）
      { id: "TECH-1", name: "陈岩", availableMinutes: 45 },
      { id: "TECH-2", name: "林晓", availableMinutes: 150 },
      { id: "TECH-3", name: "老周", availableMinutes: 90 },
    ],
    stations: [
      { id: "ST-A", name: "A 工位 · 低温区", zones: ["cold"] },
      { id: "ST-B", name: "B 工位 · 暖温区", zones: ["warm"] },
      { id: "ST-C", name: "C 工位 · 全温区", zones: ["cold", "warm"] },
    ],
    orders: [
      {
        id: "ORD-106",
        customer: "赵鹏",
        brand: "Burton Custom",
        lengthCm: 156,
        boardType: "all",
        sideEdgeDeg: 88,
        baseEdgeDeg: 1,
        waxType: "cold",
        baseDamage: "",
        repairLocation: "",
        preference: "常规竞技手感",
        estimatedMinutes: 50,
        status: "queued",
        createdAt: now - 5 * DAY,
      },
      {
        id: "ORD-112",
        customer: "孙悦",
        brand: "Fischer RC4",
        lengthCm: 165,
        boardType: "race",
        sideEdgeDeg: 87,
        baseEdgeDeg: 0.5,
        waxType: "warm",
        baseDamage: "底板划痕 12cm，深度约 1mm",
        // 已登记损伤但未填修补位置：派发时整单拒绝
        repairLocation: "",
        preference: "偏好强咬雪",
        estimatedMinutes: 70,
        status: "queued",
        createdAt: now - 4 * DAY,
      },
      {
        id: "ORD-118",
        customer: "李棠",
        brand: "Jones Hovercraft",
        lengthCm: 158,
        boardType: "powder",
        sideEdgeDeg: 89,
        baseEdgeDeg: 1,
        // 暖温蜡：派到 A 低温工位会被拒绝，B 或 C 可派
        waxType: "warm",
        baseDamage: "",
        repairLocation: "",
        preference: "弱咬雪，滑行轻快",
        estimatedMinutes: 40,
        status: "queued",
        createdAt: now - 3 * DAY,
      },
      {
        id: "ORD-121",
        customer: "赵鹏",
        brand: "Nitro Prime",
        lengthCm: 152,
        boardType: "park",
        sideEdgeDeg: 88,
        baseEdgeDeg: 1,
        waxType: "universal",
        baseDamage: "板头磕碰掉片 3cm",
        repairLocation: "板头右侧距端点 6cm",
        preference: "公园道具友好",
        estimatedMinutes: 90,
        // 预置一张施工中工单，占用 C 工位、占用林晓 90 分钟
        status: "dispatched",
        technicianId: "TECH-2",
        stationId: "ST-C",
        createdAt: now - 2 * DAY,
        dispatchedAt: now - 3 * 60 * 60 * 1000,
      },
      {
        id: "ORD-103",
        customer: "王凯",
        brand: "Atomic Redster",
        lengthCm: 172,
        boardType: "race",
        sideEdgeDeg: 86,
        baseEdgeDeg: 0.5,
        waxType: "cold",
        baseDamage: "",
        repairLocation: "",
        preference: "刻滑稳定性优先",
        estimatedMinutes: 45,
        // 已完工：只读
        status: "completed",
        technicianId: "TECH-1",
        stationId: "ST-A",
        createdAt: now - 12 * DAY,
        dispatchedAt: now - 12 * DAY,
        completedAt: now - 11 * DAY,
      },
      {
        id: "ORD-125",
        customer: "何苗",
        brand: "Ride Warpig",
        lengthCm: 148,
        boardType: "all",
        sideEdgeDeg: 88,
        baseEdgeDeg: 1,
        waxType: "universal",
        baseDamage: "",
        repairLocation: "",
        preference: "新手容错高一些",
        estimatedMinutes: 35,
        status: "queued",
        createdAt: now - DAY,
      },
      {
        id: "ORD-128",
        customer: "赵鹏",
        brand: "Salomon Pulse",
        lengthCm: 160,
        boardType: "all",
        sideEdgeDeg: 89,
        baseEdgeDeg: 1.5,
        waxType: "cold",
        baseDamage: "底板中段烧痕 5cm",
        repairLocation: "固定器间距正中偏尾 3cm",
        preference: "老客户，按惯例处理",
        estimatedMinutes: 55,
        status: "queued",
        createdAt: now - 6 * 60 * 60 * 1000,
      },
    ],
  };
}

function isValidState(value: unknown): value is StoreState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.orders) &&
    Array.isArray(v.technicians) &&
    Array.isArray(v.stations)
  );
}

// 读取：浏览器无数据或数据损坏时回到预置数据
export function loadState(): StoreState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed: unknown = JSON.parse(raw);
    if (!isValidState(parsed)) return createSeedState();
    return parsed;
  } catch {
    return createSeedState();
  }
}

// 写入：仅存浏览器
export function saveState(state: StoreState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级为本轮内存状态
  }
}

export function resetState(): StoreState {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return createSeedState();
}
