// 存储层：预置工单 / 技师 / 工位，状态只落在浏览器 localStorage。
import type { ShopState, WorkOrder } from "./rules";

const STORAGE_KEY = "snowboard-tuning-board:v1";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function seedState(): ShopState {
  const now = Date.now();

  const techs = [
    { id: "T01", name: "老周", title: "首席刃磨技师", capacity: 480 },
    { id: "T02", name: "阿宁", title: "打蜡 / P-Tex 修补", capacity: 420 },
    { id: "T03", name: "小柯", title: "学徒技师", capacity: 90 },
  ];

  const stations = [
    { id: "S01", name: "1 号刃磨台", zone: "cold", capacity: 2 },
    { id: "S02", name: "2 号打蜡房", zone: "mid", capacity: 2 },
    { id: "S03", name: "3 号温雪台", zone: "warm", capacity: 1 },
    { id: "S04", name: "4 号全能台", zone: "all", capacity: 2 },
  ] as const;

  const orders: WorkOrder[] = [
    {
      id: "ORD-106",
      customer: "陈野",
      phone: "138-0106-2233",
      brand: "Burton Custom",
      length: 156,
      boardType: "all-mountain",
      edge: { side: 88, base: 1 },
      wax: "cold",
      baseDamage: "",
      repairLocation: "",
      note: "客户偏好锋利抓雪刃",
      minutes: 75,
      status: "queued",
      createdAt: now - 3 * HOUR,
      updatedAt: now - 3 * HOUR,
    },
    {
      id: "ORD-112",
      customer: "高进",
      phone: "139-1128-8801",
      brand: "Volkl Racetiger",
      length: 165,
      boardType: "race",
      edge: { side: 87, base: 0.5 },
      wax: "warm",
      baseDamage: "底板深划痕 12cm，伤及板芯",
      repairLocation: "",
      note: "待补 P-Tex（未登记修补位置，派发将被拒）",
      minutes: 120,
      status: "queued",
      createdAt: now - 5 * HOUR,
      updatedAt: now - 2 * HOUR,
    },
    {
      id: "ORD-118",
      customer: "林岚",
      phone: "137-1180-5566",
      brand: "Jones Hovercraft",
      length: 158,
      boardType: "powder",
      edge: { side: 89, base: 1 },
      wax: "universal",
      baseDamage: "",
      repairLocation: "",
      note: "偏好弱咬雪，底刃别磨太多",
      minutes: 60,
      status: "queued",
      createdAt: now - 90 * MIN,
      updatedAt: now - 90 * MIN,
    },
    {
      id: "ORD-104",
      customer: "赵骁",
      phone: "135-1040-7712",
      brand: "Capita DOA",
      length: 154,
      boardType: "park",
      edge: { side: 89, base: 1 },
      wax: "mid",
      baseDamage: "板底轻微烧痕一处",
      repairLocation: "左脚固定器前 10cm，板刃中线偏右 2cm",
      note: "",
      minutes: 90,
      status: "dispatched",
      techId: "T01",
      stationId: "S02",
      createdAt: now - 26 * HOUR,
      updatedAt: now - 40 * MIN,
    },
    {
      id: "ORD-109",
      customer: "陈野",
      phone: "138-0106-2233",
      brand: "Nitro Team",
      length: 159,
      boardType: "all-mountain",
      edge: { side: 88, base: 0.75 },
      wax: "cold",
      baseDamage: "",
      repairLocation: "",
      note: "",
      minutes: 45,
      status: "dispatched",
      techId: "T02",
      stationId: "S01",
      createdAt: now - 20 * HOUR,
      updatedAt: now - 60 * MIN,
    },
    {
      id: "ORD-101",
      customer: "孙越",
      phone: "136-1012-4430",
      brand: "Salomon Pulse",
      length: 152,
      boardType: "all-mountain",
      edge: { side: 88, base: 1 },
      wax: "universal",
      baseDamage: "",
      repairLocation: "",
      note: "",
      minutes: 60,
      status: "done",
      techId: "T02",
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY + 70 * MIN,
      completedAt: now - 2 * DAY + 70 * MIN,
    },
    {
      id: "ORD-098",
      customer: "高进",
      phone: "139-1128-8801",
      brand: "F2 Race Titanium",
      length: 163,
      boardType: "race",
      edge: { side: 87, base: 0.5 },
      wax: "cold",
      baseDamage: "板头崩边修补",
      repairLocation: "板头尖端左侧 3cm 范围",
      note: "竞速前做的刃线修整",
      minutes: 105,
      status: "done",
      techId: "T01",
      createdAt: now - 5 * DAY,
      updatedAt: now - 5 * DAY + 2 * HOUR,
      completedAt: now - 5 * DAY + 2 * HOUR,
    },
  ];

  return { orders, techs, stations: [...stations] };
}

export function loadState(): ShopState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = seedState();
      saveState(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as ShopState;
    if (!Array.isArray(parsed.orders) || !Array.isArray(parsed.techs)) {
      throw new Error("数据结构不完整");
    }
    return parsed;
  } catch {
    return seedState();
  }
}

export function saveState(state: ShopState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满时静默：本次会话仍可在内存中使用
  }
}

export function resetState(): ShopState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
