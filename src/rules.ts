// 业务规则层：领域模型、派发校验与工单状态流转（纯函数，不接触 DOM 与存储）

export type BoardType = "all" | "park" | "race" | "powder";
export type WaxType = "cold" | "warm" | "universal";
export type TemperatureZone = "cold" | "warm";
export type OrderStatus = "queued" | "dispatched" | "completed";

export interface WorkOrder {
  id: string;
  customer: string;
  brand: string;
  lengthCm: number;
  boardType: BoardType;
  sideEdgeDeg: number; // 侧刃角
  baseEdgeDeg: number; // 底刃角
  waxType: WaxType; // 蜡型
  baseDamage: string; // 底板损伤（空字符串表示无损伤）
  repairLocation: string; // 修补位置
  preference: string; // 客户偏好
  estimatedMinutes: number; // 预估工时
  status: OrderStatus;
  technicianId?: string;
  stationId?: string;
  createdAt: number;
  dispatchedAt?: number;
  completedAt?: number;
}

export interface Technician {
  id: string;
  name: string;
  availableMinutes: number; // 当日余时
}

export interface Station {
  id: string;
  name: string;
  zones: TemperatureZone[]; // 工位支持的温区
}

export interface StoreState {
  orders: WorkOrder[];
  technicians: Technician[];
  stations: Station[];
}

export const BOARD_TYPES: BoardType[] = ["all", "park", "race", "powder"];
export const WAX_TYPES: WaxType[] = ["cold", "warm", "universal"];

export const BOARD_LABELS: Record<BoardType, string> = {
  all: "全地域板",
  park: "公园板",
  race: "竞速板",
  powder: "粉雪板",
};

export const WAX_LABELS: Record<WaxType, string> = {
  cold: "低温蜡",
  warm: "暖温蜡",
  universal: "全温蜡",
};

export const ZONE_LABELS: Record<TemperatureZone, string> = {
  cold: "低温区",
  warm: "暖温区",
};

export const ZONE_HINTS: Record<TemperatureZone, string> = {
  cold: "约 -12℃ ~ -4℃",
  warm: "约 -3℃ ~ 0℃",
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  queued: "待派发",
  dispatched: "施工中",
  completed: "已完工",
};

export type DispatchOutcome =
  | { ok: true }
  | { ok: false; reason: string };

// 派发后一旦改动就必须立即撤单的字段：底板损伤相关 + 刃角
const CRITICAL_FIELDS = [
  "baseDamage",
  "repairLocation",
  "sideEdgeDeg",
  "baseEdgeDeg",
] as const;

export function isReadOnly(order: WorkOrder): boolean {
  return order.status === "completed";
}

// 全温蜡可在任意温区施工；低温/暖温蜡必须落在对应温区
export function stationAcceptsWax(station: Station, wax: WaxType): boolean {
  if (wax === "universal") return true;
  return station.zones.includes(wax);
}

export function stationZoneText(station: Station): string {
  return station.zones.map((z) => ZONE_LABELS[z]).join(" / ");
}

// 派发前的整单校验：任一条不通过即整单拒绝，队列与工位占用保持不变
export function evaluateDispatch(
  state: StoreState,
  orderId: string,
  technicianId: string,
  stationId: string,
): DispatchOutcome {
  const order = state.orders.find((o) => o.id === orderId);
  const technician = state.technicians.find((t) => t.id === technicianId);
  const station = state.stations.find((s) => s.id === stationId);

  if (!order || order.status !== "queued") {
    return { ok: false, reason: "工单不在待派发队列，无法派发。" };
  }
  if (!technician) return { ok: false, reason: "请选择技师。" };
  if (!station) return { ok: false, reason: "请选择工位。" };

  const occupant = state.orders.find(
    (o) => o.status === "dispatched" && o.stationId === station.id && o.id !== order.id,
  );
  if (occupant) {
    return { ok: false, reason: `工位已被 ${occupant.id} 占用，整单拒绝。` };
  }

  if (order.baseDamage.trim() !== "" && order.repairLocation.trim() === "") {
    return { ok: false, reason: "底板损伤已登记但未填写修补位置，整单拒绝。" };
  }

  if (technician.availableMinutes < order.estimatedMinutes) {
    return {
      ok: false,
      reason: `技师余时 ${technician.availableMinutes} 分钟，不足本单预估 ${order.estimatedMinutes} 分钟，整单拒绝。`,
    };
  }

  if (!stationAcceptsWax(station, order.waxType)) {
    return {
      ok: false,
      reason: `蜡型「${WAX_LABELS[order.waxType]}」不符合工位温区（${stationZoneText(
        station,
      )}），整单拒绝。`,
    };
  }

  return { ok: true };
}

export interface DispatchResult {
  state: StoreState;
  outcome: DispatchOutcome;
}

// 派发成功才扣减技师余时并占用工位；被拒绝时返回原状态，队列与占用不变
export function dispatchOrder(
  state: StoreState,
  orderId: string,
  technicianId: string,
  stationId: string,
): DispatchResult {
  const outcome = evaluateDispatch(state, orderId, technicianId, stationId);
  if (!outcome.ok) return { state, outcome };

  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { state, outcome };

  const orders = state.orders.map((o) =>
    o.id === orderId
      ? {
          ...o,
          status: "dispatched" as const,
          technicianId,
          stationId,
          dispatchedAt: Date.now(),
        }
      : o,
  );
  const technicians = state.technicians.map((t) =>
    t.id === technicianId
      ? { ...t, availableMinutes: t.availableMinutes - order.estimatedMinutes }
      : t,
  );

  return { state: { ...state, orders, technicians }, outcome };
}

export type OrderPatch = Partial<Omit<WorkOrder, "id">>;

export interface PatchResult {
  state: StoreState;
  withdrew: boolean;
}

// 改动工单字段：施工中工单一旦修改损伤信息或刃角，立即撤单、释放工位并返还余时；
// 已完工工单只读，任何改动都不生效。
export function patchOrder(
  state: StoreState,
  orderId: string,
  patch: OrderPatch,
): PatchResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || isReadOnly(order)) return { state, withdrew: false };

  let withdrew = false;

  const orders = state.orders.map((o) => {
    if (o.id !== orderId) return o;
    const touchedCritical = CRITICAL_FIELDS.some((field) => {
      const p = patch as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(p, field) && p[field] !== o[field];
    });
    if (o.status === "dispatched" && touchedCritical) {
      withdrew = true;
      return {
        ...o,
        ...patch,
        status: "queued" as const,
        technicianId: undefined,
        stationId: undefined,
        dispatchedAt: undefined,
      };
    }
    return { ...o, ...patch };
  });

  let technicians = state.technicians;
  if (withdrew && order.technicianId) {
    const refund = order.estimatedMinutes;
    technicians = state.technicians.map((t) =>
      t.id === order.technicianId
        ? { ...t, availableMinutes: t.availableMinutes + refund }
        : t,
    );
  }

  return { state: { ...state, orders, technicians }, withdrew };
}

// 完工：释放工位（占用由施工中状态推导），余时不返还，工单转为只读
export function completeOrder(state: StoreState, orderId: string): StoreState {
  return {
    ...state,
    orders: state.orders.map((o) =>
      o.id === orderId && o.status === "dispatched"
        ? { ...o, status: "completed" as const, completedAt: Date.now() }
        : o,
    ),
  };
}

// 工位占用情况：stationId -> 施工中工单
export function getOccupancy(state: StoreState): Map<string, WorkOrder> {
  const map = new Map<string, WorkOrder>();
  for (const o of state.orders) {
    if (o.status === "dispatched" && o.stationId) map.set(o.stationId, o);
  }
  return map;
}

export interface ConsoleStats {
  queued: number;
  dispatched: number;
  completed: number;
  damaged: number;
}

export function getStats(state: StoreState): ConsoleStats {
  return {
    queued: state.orders.filter((o) => o.status === "queued").length,
    dispatched: state.orders.filter((o) => o.status === "dispatched").length,
    completed: state.orders.filter((o) => o.status === "completed").length,
    damaged: state.orders.filter((o) => o.baseDamage.trim() !== "").length,
  };
}

export function uniqueCustomers(state: StoreState): string[] {
  return Array.from(new Set(state.orders.map((o) => o.customer.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

// 客户历史：始终从当前工单数据同步推导
export function customerHistory(state: StoreState, customer: string): WorkOrder[] {
  const key = customer.trim();
  return state.orders
    .filter((o) => o.customer.trim() === key)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function nextOrderId(state: StoreState): string {
  const max = state.orders.reduce((acc, o) => {
    const n = parseInt(o.id.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 100);
  return `ORD-${max + 1}`;
}
