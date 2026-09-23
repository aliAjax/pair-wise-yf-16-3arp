// 业务规则层：纯函数，不接触 localStorage，也不依赖 React。
// 所有派发 / 撤单 / 完工 / 编辑是否合法，都在这里判定。

export type BoardType = "all-mountain" | "park" | "race" | "powder";
export type WaxType = "cold" | "mid" | "warm" | "universal";
export type TempZone = "cold" | "mid" | "warm" | "all";
export type OrderStatus = "queued" | "dispatched" | "done";

export interface EdgeAngle {
  /** 侧刃角度（°），常见 87~90 */
  side: number;
  /** 底刃角度（°），常见 0~2 */
  base: number;
}

export interface WorkOrder {
  id: string;
  customer: string;
  phone: string;
  brand: string;
  length: number;
  boardType: BoardType;
  edge: EdgeAngle;
  wax: WaxType;
  /** 底板损伤描述；空串表示无损伤 */
  baseDamage: string;
  /** 修补位置；有损伤时必须登记，否则整单不可派发 */
  repairLocation: string;
  note: string;
  /** 预计工时（分钟），派发时占用技师余时 */
  minutes: number;
  status: OrderStatus;
  techId?: string;
  stationId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface Technician {
  id: string;
  name: string;
  title: string;
  /** 当日可接工时长（分钟） */
  capacity: number;
}

export interface Station {
  id: string;
  name: string;
  /** 工位温区，决定可打的蜡型 */
  zone: TempZone;
  /** 可同时容纳的板数 */
  capacity: number;
}

export interface ShopState {
  orders: WorkOrder[];
  techs: Technician[];
  stations: Station[];
}

export const BOARD_TYPES: ReadonlyArray<{ value: BoardType; label: string }> = [
  { value: "all-mountain", label: "全地域" },
  { value: "park", label: "公园板" },
  { value: "race", label: "竞速板" },
  { value: "powder", label: "粉雪板" },
];

export const WAX_TYPES: ReadonlyArray<{
  value: WaxType;
  label: string;
  hint: string;
}> = [
  { value: "cold", label: "低温蜡", hint: "雪温 < -8°C" },
  { value: "mid", label: "中温蜡", hint: "雪温 -8 ~ -2°C" },
  { value: "warm", label: "温雪蜡", hint: "雪温 > -2°C" },
  { value: "universal", label: "全温蜡", hint: "全温区通用" },
];

export const TEMP_ZONES: ReadonlyArray<{
  value: TempZone;
  label: string;
}> = [
  { value: "cold", label: "冷区" },
  { value: "mid", label: "中温区" },
  { value: "warm", label: "暖雪区" },
  { value: "all", label: "全温区" },
];

export function boardTypeLabel(value: BoardType): string {
  return BOARD_TYPES.find((item) => item.value === value)?.label ?? value;
}

export function waxLabel(value: WaxType): string {
  return WAX_TYPES.find((item) => item.value === value)?.label ?? value;
}

export function waxHint(value: WaxType): string {
  return WAX_TYPES.find((item) => item.value === value)?.hint ?? "";
}

export function zoneLabel(value: TempZone): string {
  return TEMP_ZONES.find((item) => item.value === value)?.label ?? value;
}

/** 有底板损伤却没登记修补位置 —— 三条整单拒绝规则之一 */
export function damageNeedsLocation(order: WorkOrder): boolean {
  return (
    order.baseDamage.trim() !== "" && order.repairLocation.trim() === ""
  );
}

/** 蜡型必须落在工位温区内：全温蜡 / 全温工位两边都兼容 */
export function waxMatchesZone(wax: WaxType, zone: TempZone): boolean {
  return wax === "universal" || zone === "all" || wax === zone;
}

export function activeOrders(orders: WorkOrder[]): WorkOrder[] {
  return orders.filter((order) => order.status !== "done");
}

/** 技师当前被已派发工单占用的分钟数（撤单即释放，完工则离开队列） */
export function technicianUsedMinutes(
  state: ShopState,
  techId: string
): number {
  return state.orders
    .filter((o) => o.status === "dispatched" && o.techId === techId)
    .reduce((sum, o) => sum + o.minutes, 0);
}

export function technicianRemaining(
  state: ShopState,
  techId: string
): number {
  const tech = state.techs.find((t) => t.id === techId);
  if (!tech) return 0;
  return tech.capacity - technicianUsedMinutes(state, techId);
}

export function stationOccupancy(
  state: ShopState,
  stationId: string
): number {
  return state.orders.filter(
    (o) => o.status === "dispatched" && o.stationId === stationId
  ).length;
}

export function stationFreeSlots(state: ShopState, stationId: string): number {
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) return 0;
  return station.capacity - stationOccupancy(state, stationId);
}

export interface DispatchResult {
  state: ShopState;
  error: string | null;
}

/**
 * 尝试派发工单。
 * 任一规则不通过则整单拒绝，返回原 state（队列、技师余时、工位占用均不变）。
 */
export function dispatchOrder(
  state: ShopState,
  orderId: string,
  techId: string,
  stationId: string
): DispatchResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { state, error: "工单不存在" };
  if (order.status !== "queued")
    return { state, error: "只有待派发工单可以派发" };

  // 规则 1：底板有损伤必须先登记修补位置
  if (damageNeedsLocation(order)) {
    return {
      state,
      error: "整单拒绝：底板损伤未登记修补位置，请补录后再派发",
    };
  }

  const tech = state.techs.find((t) => t.id === techId);
  if (!tech) return { state, error: "请选择技师" };

  // 规则 2：技师余时必须覆盖工单工时
  const remaining = technicianRemaining(state, techId);
  if (remaining < order.minutes) {
    return {
      state,
      error: `整单拒绝：技师余时不足（需 ${order.minutes} 分钟，${tech.name} 仅剩 ${remaining} 分钟）`,
    };
  }

  const station = state.stations.find((s) => s.id === stationId);
  if (!station) return { state, error: "请选择工位" };

  // 规则 3：蜡型必须符合工位温区
  if (!waxMatchesZone(order.wax, station.zone)) {
    return {
      state,
      error: `整单拒绝：${waxLabel(order.wax)}（${waxHint(
        order.wax
      )}）不符合「${station.name}」的${zoneLabel(station.zone)}温区`,
    };
  }

  if (stationFreeSlots(state, stationId) <= 0) {
    return { state, error: `整单拒绝：${station.name} 余位不足` };
  }

  const orders = state.orders.map((o) =>
    o.id === orderId
      ? {
          ...o,
          status: "dispatched" as const,
          techId,
          stationId,
          updatedAt: Date.now(),
        }
      : o
  );
  return { state: { ...state, orders }, error: null };
}

export interface PatchResult {
  state: ShopState;
  /** 派发后改动了损伤或刃角，已被规则强制撤单 */
  withdrawn: boolean;
}

/**
 * 编辑工单。
 * 派发后一旦改动底板损伤 / 修补位置 / 刃角，立即撤单并释放工位与技师余时。
 * 已完工工单只读，任何改动都会被原样退回。
 */
export function patchOrder(
  state: ShopState,
  orderId: string,
  patch: Partial<Omit<WorkOrder, "id" | "createdAt">>
): PatchResult {
  const current = state.orders.find((o) => o.id === orderId);
  if (!current || current.status === "done") {
    return { state, withdrawn: false };
  }

  const next: WorkOrder = { ...current, ...patch, updatedAt: Date.now() };
  let withdrawn = false;

  if (current.status === "dispatched") {
    const damageChanged =
      next.baseDamage !== current.baseDamage ||
      next.repairLocation !== current.repairLocation;
    const edgeChanged =
      next.edge.side !== current.edge.side ||
      next.edge.base !== current.edge.base;

    if (damageChanged || edgeChanged) {
      next.status = "queued";
      next.techId = undefined;
      next.stationId = undefined;
      withdrawn = true;
    }
  }

  const orders = state.orders.map((o) => (o.id === orderId ? next : o));
  return { state: { ...state, orders }, withdrawn };
}

/** 手动撤回派发（同样释放工位与技师余时） */
export function cancelDispatch(state: ShopState, orderId: string): ShopState {
  const orders = state.orders.map((o) =>
    o.id === orderId && o.status === "dispatched"
      ? {
          ...o,
          status: "queued" as const,
          techId: undefined,
          stationId: undefined,
          updatedAt: Date.now(),
        }
      : o
  );
  return { ...state, orders };
}

/** 完工：工单转为只读，离开工位；技师工时保持已消耗 */
export function completeOrder(state: ShopState, orderId: string): ShopState {
  const now = Date.now();
  const orders = state.orders.map((o) =>
    o.id === orderId && o.status === "dispatched"
      ? {
          ...o,
          status: "done" as const,
          stationId: undefined,
          completedAt: now,
          updatedAt: now,
        }
      : o
  );
  return { ...state, orders };
}

export type NewOrderDraft = Omit<
  WorkOrder,
  "id" | "status" | "techId" | "stationId" | "createdAt" | "updatedAt" | "completedAt"
>;

export function addOrder(state: ShopState, draft: NewOrderDraft): ShopState {
  const maxNo = state.orders.reduce((max, o) => {
    const no = parseInt(o.id.replace(/\D/g, ""), 10);
    return Number.isFinite(no) ? Math.max(max, no) : max;
  }, 100);
  const now = Date.now();
  const order: WorkOrder = {
    ...draft,
    id: `ORD-${maxNo + 1}`,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, orders: [order, ...state.orders] };
}

export interface BoardMetrics {
  activeCount: number;
  queuedCount: number;
  dispatchedCount: number;
  doneCount: number;
  averageSideEdge: number;
  damageCount: number;
}

export function getMetrics(state: ShopState): BoardMetrics {
  const { orders } = state;
  const queuedCount = orders.filter((o) => o.status === "queued").length;
  const dispatchedCount = orders.filter(
    (o) => o.status === "dispatched"
  ).length;
  const doneCount = orders.filter((o) => o.status === "done").length;
  const averageSideEdge = orders.length
    ? orders.reduce((sum, o) => sum + o.edge.side, 0) / orders.length
    : 0;
  const damageCount = orders.filter(
    (o) => o.baseDamage.trim() !== ""
  ).length;
  return {
    activeCount: queuedCount + dispatchedCount,
    queuedCount,
    dispatchedCount,
    doneCount,
    averageSideEdge,
    damageCount,
  };
}
