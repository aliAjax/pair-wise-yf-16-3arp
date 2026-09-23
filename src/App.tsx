// 界面层：雪板调校工位派发台（状态编排与渲染；规则见 rules.ts，存储见 storage.ts）

import { useEffect, useMemo, useState } from "react";
import {
  BOARD_LABELS,
  BOARD_TYPES,
  STATUS_LABELS,
  WAX_LABELS,
  WAX_TYPES,
  ZONE_HINTS,
  ZONE_LABELS,
  completeOrder,
  customerHistory,
  dispatchOrder,
  getOccupancy,
  getStats,
  isReadOnly,
  nextOrderId,
  patchOrder,
  stationAcceptsWax,
  stationZoneText,
  uniqueCustomers,
  type BoardType,
  type OrderPatch,
  type OrderStatus,
  type StoreState,
  type WaxType,
  type WorkOrder,
} from "./rules";
import { loadState, resetState, saveState } from "./storage";

const SHIFT_MINUTES = 240; // 技师全班时间，用于余时条
const NAVY = "#0369a1";
const TEAL = "#14b8a6";
const ORANGE = "#f97316";

type StatusFilter = OrderStatus | "all";
type BoardFilter = BoardType | "all";
type CardMessage = { tone: "ok" | "error"; text: string };

interface DraftForm {
  customer: string;
  brand: string;
  lengthCm: number;
  boardType: BoardType;
  sideEdgeDeg: number;
  baseEdgeDeg: number;
  waxType: WaxType;
  baseDamage: string;
  repairLocation: string;
  preference: string;
  estimatedMinutes: number;
}

const EMPTY_FORM: DraftForm = {
  customer: "",
  brand: "",
  lengthCm: 156,
  boardType: "all",
  sideEdgeDeg: 88,
  baseEdgeDeg: 1,
  waxType: "universal",
  baseDamage: "",
  repairLocation: "",
  preference: "",
  estimatedMinutes: 45,
};

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function num(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function App() {
  const [state, setState] = useState<StoreState>(() => loadState());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, { technicianId: string; stationId: string }>>({});
  const [messages, setMessages] = useState<Record<string, CardMessage>>({});
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [formMsg, setFormMsg] = useState<CardMessage | null>(null);

  // 仅存浏览器：状态每次变化即写入 localStorage
  useEffect(() => {
    saveState(state);
  }, [state]);

  const occupancy = useMemo(() => getOccupancy(state), [state]);
  const stats = useMemo(() => getStats(state), [state]);
  const customers = useMemo(() => uniqueCustomers(state), [state]);

  const freeStationExists = state.stations.some((s) => !occupancy.has(s.id));

  // 每张待派发工单的默认选择：第一个技师 + 第一个支持其蜡型的空闲工位
  const effectiveChoice = (order: WorkOrder) => {
    const saved = choices[order.id];
    const defaultStation =
      state.stations.find((s) => !occupancy.has(s.id) && stationAcceptsWax(s, order.waxType)) ??
      state.stations.find((s) => !occupancy.has(s.id));
    return {
      technicianId: saved?.technicianId ?? state.technicians[0]?.id ?? "",
      stationId: saved?.stationId ?? defaultStation?.id ?? "",
    };
  };

  const setChoice = (orderId: string, patch: Partial<{ technicianId: string; stationId: string }>) => {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) return;
    const base = effectiveChoice(order);
    setChoices((prev) => ({ ...prev, [orderId]: { ...base, ...patch } }));
  };

  const notify = (orderId: string, msg: CardMessage) =>
    setMessages((prev) => ({ ...prev, [orderId]: msg }));

  const handleDispatch = (orderId: string) => {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) return;
    const choice = effectiveChoice(order);
    const result = dispatchOrder(state, orderId, choice.technicianId, choice.stationId);
    if (result.outcome.ok) {
      setState(result.state);
      notify(orderId, { tone: "ok", text: "派发成功：工位已占用，技师余时已扣减。" });
    } else {
      // 整单拒绝：队列与工位占用不变，state 原样返回
      notify(orderId, { tone: "error", text: result.outcome.reason });
    }
  };

  const handlePatch = (orderId: string, patch: OrderPatch) => {
    const result = patchOrder(state, orderId, patch);
    if (result.state === state) return;
    setState(result.state);
    if (result.withdrew) {
      notify(orderId, {
        tone: "error",
        text: "损伤信息或刃角已改动，立即撤单：工位已释放，技师余时已返还，工单回到队列。",
      });
    }
  };

  const handleComplete = (orderId: string) => {
    setState(completeOrder(state, orderId));
    notify(orderId, { tone: "ok", text: "工单已完工，记录转为只读。" });
  };

  const handleCreate = () => {
    if (form.customer.trim() === "" || form.brand.trim() === "") {
      setFormMsg({ tone: "error", text: "客户姓名与雪板品牌为必填项。" });
      return;
    }
    const id = nextOrderId(state);
    const order: WorkOrder = {
      id,
      ...form,
      customer: form.customer.trim(),
      brand: form.brand.trim(),
      baseDamage: form.baseDamage.trim(),
      repairLocation: form.repairLocation.trim(),
      preference: form.preference.trim(),
      status: "queued",
      createdAt: Date.now(),
    };
    setState((s) => ({ ...s, orders: [...s.orders, order] }));
    setForm(EMPTY_FORM);
    setFormMsg({ tone: "ok", text: `工单 ${id} 已进入待派发队列。` });
  };

  const handleReset = () => {
    setState(resetState());
    setChoices({});
    setMessages({});
    setCustomerFilter(null);
    setFormMsg({ tone: "ok", text: "已恢复预置工单、技师与工位。" });
  };

  const statusRank: Record<OrderStatus, number> = { queued: 0, dispatched: 1, completed: 2 };
  const visibleOrders = state.orders
    .filter((o) => (statusFilter === "all" ? true : o.status === statusFilter))
    .filter((o) => (boardFilter === "all" ? true : o.boardType === boardFilter))
    .filter((o) => (customerFilter === null ? true : o.customer === customerFilter))
    .slice()
    .sort((a, b) => {
      const rank = statusRank[a.status] - statusRank[b.status];
      if (rank !== 0) return rank;
      return a.status === "completed" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
    });

  return (
    <main className="console">
      <header className="topbar">
        <div>
          <p className="eyebrow">SNOWBOARD TUNING DISPATCH</p>
          <h1>雪板调校工位派发台</h1>
          <p className="subtitle">
            工单 · 技师 · 工位三方派发；规则校验不通过即整单拒绝，数据仅保存在本浏览器。
          </p>
        </div>
        <button className="ghost" onClick={handleReset}>
          恢复预置数据
        </button>
      </header>

      <section className="metrics">
        <Metric label="待派发" value={stats.queued} accent={NAVY} />
        <Metric label="施工中" value={stats.dispatched} accent={TEAL} />
        <Metric label="已完工" value={stats.completed} accent="#475569" />
        <Metric label="底板修补在册" value={stats.damaged} accent={ORANGE} />
      </section>

      <div className="layout">
        <aside className="sidebar">
          <section className="card">
            <h2>完工筛选</h2>
            <div className="chips">
              {(["all", "queued", "dispatched", "completed"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  className={statusFilter === s ? "chip active" : "chip"}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "全部状态" : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <h3>板型筛选</h3>
            <div className="chips">
              <button
                className={boardFilter === "all" ? "chip active" : "chip"}
                onClick={() => setBoardFilter("all")}
              >
                全部板型
              </button>
              {BOARD_TYPES.map((b) => (
                <button
                  key={b}
                  className={boardFilter === b ? "chip active" : "chip"}
                  onClick={() => setBoardFilter(b)}
                >
                  {BOARD_LABELS[b]}
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>工位负载</h2>
              <span className="muted">
                空闲 {state.stations.length - occupancy.size}/{state.stations.length}
              </span>
            </div>
            <ul className="station-list">
              {state.stations.map((station) => {
                const occupant = occupancy.get(station.id);
                const tech = occupant
                  ? state.technicians.find((t) => t.id === occupant.technicianId)
                  : undefined;
                return (
                  <li key={station.id} className={occupant ? "station busy" : "station free"}>
                    <div className="station-row">
                      <strong>{station.name}</strong>
                      <span className={occupant ? "tag tag-busy" : "tag tag-free"}>
                        {occupant ? "占用中" : "空闲"}
                      </span>
                    </div>
                    <p className="muted small">
                      温区：{stationZoneText(station)}（
                      {station.zones.map((z) => ZONE_HINTS[z]).join("，")}）
                    </p>
                    <p className="small">
                      {occupant
                        ? `${occupant.id} · ${occupant.customer} · ${occupant.brand} · 技师 ${tech?.name ?? "—"}`
                        : "可接派符合温区的蜡型工单"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <h2>技师余时</h2>
            <ul className="tech-list">
              {state.technicians.map((t) => {
                const ratio = Math.max(0, Math.min(1, t.availableMinutes / SHIFT_MINUTES));
                const active = state.orders.find(
                  (o) => o.status === "dispatched" && o.technicianId === t.id,
                );
                return (
                  <li key={t.id}>
                    <div className="station-row">
                      <strong>{t.name}</strong>
                      <span className={t.availableMinutes < 60 ? "warn" : "muted"}>
                        余 {t.availableMinutes} 分钟
                      </span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${ratio * 100}%` }} />
                    </div>
                    <p className="small muted">{active ? `正在施工 ${active.id}` : "当前无在手工单"}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>客户历史</h2>
              {customerFilter && (
                <button className="link" onClick={() => setCustomerFilter(null)}>
                  清除筛选
                </button>
              )}
            </div>
            <ul className="customer-list">
              {customers.map((name) => {
                const history = customerHistory(state, name);
                const active = customerFilter === name;
                return (
                  <li key={name}>
                    <button
                      className={active ? "customer active" : "customer"}
                      onClick={() => setCustomerFilter(active ? null : name)}
                    >
                      <span>{name}</span>
                      <span className="muted small">
                        {history.length} 单 · 完工 {history.filter((o) => o.status === "completed").length}
                      </span>
                    </button>
                    {active && (
                      <ul className="history">
                        {history.map((o) => (
                          <li key={o.id}>
                            <span className={`dot status-${o.status}`} />
                            <span className="his-id">{o.id}</span>
                            <span className="muted">
                              {BOARD_LABELS[o.boardType]} · {o.brand} {o.lengthCm}cm
                            </span>
                            <span className={`tag tag-status status-tag-${o.status}`}>
                              {STATUS_LABELS[o.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>

        <section className="main-col">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>新建工单</h2>
                <p className="muted small">
                  底板损伤与修补位置、刃角可随时修改；派发后改动这些字段将立即撤单。
                </p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>客户姓名 *</span>
                <input
                  value={form.customer}
                  onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                  placeholder="如：赵鹏"
                />
              </label>
              <label>
                <span>雪板品牌 *</span>
                <input
                  value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                  placeholder="如：Burton Custom"
                />
              </label>
              <label>
                <span>长度 (cm)</span>
                <input
                  type="number"
                  value={form.lengthCm}
                  onChange={(e) => {
                    const n = num(e.target.value);
                    if (n !== null) setForm((f) => ({ ...f, lengthCm: n }));
                  }}
                />
              </label>
              <label>
                <span>板型</span>
                <select
                  value={form.boardType}
                  onChange={(e) => setForm((f) => ({ ...f, boardType: e.target.value as BoardType }))}
                >
                  {BOARD_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {BOARD_LABELS[b]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>侧刃角 (°)</span>
                <input
                  type="number"
                  step={0.5}
                  value={form.sideEdgeDeg}
                  onChange={(e) => {
                    const n = num(e.target.value);
                    if (n !== null) setForm((f) => ({ ...f, sideEdgeDeg: n }));
                  }}
                />
              </label>
              <label>
                <span>底刃角 (°)</span>
                <input
                  type="number"
                  step={0.5}
                  value={form.baseEdgeDeg}
                  onChange={(e) => {
                    const n = num(e.target.value);
                    if (n !== null) setForm((f) => ({ ...f, baseEdgeDeg: n }));
                  }}
                />
              </label>
              <label>
                <span>蜡型</span>
                <select
                  value={form.waxType}
                  onChange={(e) => setForm((f) => ({ ...f, waxType: e.target.value as WaxType }))}
                >
                  {WAX_TYPES.map((w) => (
                    <option key={w} value={w}>
                      {WAX_LABELS[w]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>预估工时 (分钟)</span>
                <input
                  type="number"
                  min={5}
                  value={form.estimatedMinutes}
                  onChange={(e) => {
                    const n = num(e.target.value);
                    if (n !== null && n > 0) setForm((f) => ({ ...f, estimatedMinutes: n }));
                  }}
                />
              </label>
              <label className="wide">
                <span>底板损伤</span>
                <input
                  value={form.baseDamage}
                  onChange={(e) => setForm((f) => ({ ...f, baseDamage: e.target.value }))}
                  placeholder="无损伤留空；如：底板划痕 12cm"
                />
              </label>
              <label className="wide">
                <span>修补位置</span>
                <input
                  value={form.repairLocation}
                  onChange={(e) => setForm((f) => ({ ...f, repairLocation: e.target.value }))}
                  placeholder="有损伤时必填派发位置；如：板头右侧距端点 6cm"
                />
              </label>
              <label className="wide">
                <span>客户偏好</span>
                <input
                  value={form.preference}
                  onChange={(e) => setForm((f) => ({ ...f, preference: e.target.value }))}
                  placeholder="如：弱咬雪、刻滑稳定"
                />
              </label>
            </div>
            <div className="form-foot">
              {formMsg && (
                <p className={formMsg.tone === "error" ? "msg msg-error" : "msg msg-ok"}>
                  {formMsg.text}
                </p>
              )}
              <button className="primary" onClick={handleCreate}>
                加入队列 · {nextOrderId(state)}
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>工单队列（{visibleOrders.length}）</h2>
              <span className="muted small">
                {customerFilter ? `客户：${customerFilter} · ` : ""}
                {!freeStationExists && "当前工位全满 · "}
                排序：待派发 → 施工中 → 已完工
              </span>
            </div>
            <div className="orders">
              {visibleOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  state={state}
                  message={messages[order.id]}
                  choice={effectiveChoice(order)}
                  onChoice={(patch) => setChoice(order.id, patch)}
                  onDispatch={() => handleDispatch(order.id)}
                  onPatch={(patch) => handlePatch(order.id, patch)}
                  onComplete={() => handleComplete(order.id)}
                  onPickCustomer={() =>
                    setCustomerFilter((c) => (c === order.customer ? null : order.customer))
                  }
                />
              ))}
              {visibleOrders.length === 0 && (
                <p className="muted empty">当前筛选条件下没有工单。</p>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <article className="metric">
      <span className="metric-bar" style={{ background: accent }} />
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

interface OrderCardProps {
  order: WorkOrder;
  state: StoreState;
  message?: CardMessage;
  choice: { technicianId: string; stationId: string };
  onChoice: (patch: { technicianId?: string; stationId?: string }) => void;
  onDispatch: () => void;
  onPatch: (patch: OrderPatch) => void;
  onComplete: () => void;
  onPickCustomer: () => void;
}

function OrderCard({
  order,
  state,
  message,
  choice,
  onChoice,
  onDispatch,
  onPatch,
  onComplete,
  onPickCustomer,
}: OrderCardProps) {
  const readOnly = isReadOnly(order);
  const technician = state.technicians.find((t) => t.id === order.technicianId);
  const station = state.stations.find((s) => s.id === order.stationId);
  const damageMissing = order.baseDamage.trim() !== "" && order.repairLocation.trim() === "";

  return (
    <article className={`order status-card-${order.status}`}>
      <div className="order-head">
        <div className="order-title">
          <h3>{order.id}</h3>
          <span className={`tag tag-status status-tag-${order.status}`}>
            {STATUS_LABELS[order.status]}
          </span>
        </div>
        <button className="link" onClick={onPickCustomer}>
          客户：{order.customer}
        </button>
      </div>

      <div className="order-grid">
        <label>
          <span>品牌</span>
          <input
            value={order.brand}
            disabled={readOnly}
            onChange={(e) => onPatch({ brand: e.target.value })}
          />
        </label>
        <label>
          <span>长度 (cm)</span>
          <input
            type="number"
            value={order.lengthCm}
            disabled={readOnly}
            onChange={(e) => {
              const n = num(e.target.value);
              if (n !== null) onPatch({ lengthCm: n });
            }}
          />
        </label>
        <label>
          <span>板型</span>
          <select
            value={order.boardType}
            disabled={readOnly}
            onChange={(e) => onPatch({ boardType: e.target.value as BoardType })}
          >
            {BOARD_TYPES.map((b) => (
              <option key={b} value={b}>
                {BOARD_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <label className={order.status === "dispatched" ? "critical" : ""}>
          <span>侧刃角 °{order.status === "dispatched" && "（改动即撤单）"}</span>
          <input
            type="number"
            step={0.5}
            value={order.sideEdgeDeg}
            disabled={readOnly}
            onChange={(e) => {
              const n = num(e.target.value);
              if (n !== null) onPatch({ sideEdgeDeg: n });
            }}
          />
        </label>
        <label className={order.status === "dispatched" ? "critical" : ""}>
          <span>底刃角 °{order.status === "dispatched" && "（改动即撤单）"}</span>
          <input
            type="number"
            step={0.5}
            value={order.baseEdgeDeg}
            disabled={readOnly}
            onChange={(e) => {
              const n = num(e.target.value);
              if (n !== null) onPatch({ baseEdgeDeg: n });
            }}
          />
        </label>
        <label>
          <span>蜡型</span>
          <select
            value={order.waxType}
            disabled={readOnly}
            onChange={(e) => onPatch({ waxType: e.target.value as WaxType })}
          >
            {WAX_TYPES.map((w) => (
              <option key={w} value={w}>
                {WAX_LABELS[w]}
              </option>
            ))}
          </select>
        </label>
        <label className={`wide ${order.status === "dispatched" ? "critical" : ""}`}>
          <span>底板损伤{order.status === "dispatched" && "（改动即撤单）"}</span>
          <input
            value={order.baseDamage}
            disabled={readOnly}
            placeholder="无损伤留空"
            onChange={(e) => onPatch({ baseDamage: e.target.value })}
          />
        </label>
        <label className={`wide ${order.status === "dispatched" ? "critical" : ""}`}>
          <span>修补位置{order.status === "dispatched" && "（改动即撤单）"}</span>
          <input
            className={damageMissing ? "input-warn" : ""}
            value={order.repairLocation}
            disabled={readOnly}
            placeholder={damageMissing ? "有损伤未登记位置，派发将被整单拒绝" : "如：板尾正中"}
            onChange={(e) => onPatch({ repairLocation: e.target.value })}
          />
        </label>
        <label className="wide">
          <span>客户偏好</span>
          <input
            value={order.preference}
            disabled={readOnly}
            onChange={(e) => onPatch({ preference: e.target.value })}
          />
        </label>
        <label>
          <span>预估工时 (分钟)</span>
          <input
            type="number"
            min={5}
            value={order.estimatedMinutes}
            disabled={readOnly || order.status === "dispatched"}
            onChange={(e) => {
              const n = num(e.target.value);
              if (n !== null && n > 0) onPatch({ estimatedMinutes: n });
            }}
          />
        </label>
      </div>

      {order.status === "queued" && (
        <div className="dispatch-row">
          <label>
            <span>派给技师</span>
            <select
              value={choice.technicianId}
              onChange={(e) => onChoice({ technicianId: e.target.value })}
            >
              {state.technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（余 {t.availableMinutes} 分钟）
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>派到工位</span>
            <select value={choice.stationId} onChange={(e) => onChoice({ stationId: e.target.value })}>
              {state.stations.map((s) => {
                const occupied = state.orders.some(
                  (o) => o.status === "dispatched" && o.stationId === s.id,
                );
                const waxOk = stationAcceptsWax(s, order.waxType);
                return (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {occupied ? "（占用）" : waxOk ? "（蜡型适配）" : `（非${WAX_LABELS[order.waxType]}温区）`}
                  </option>
                );
              })}
            </select>
          </label>
          <button className="primary" onClick={onDispatch}>
            校验并派发
          </button>
        </div>
      )}

      {order.status === "dispatched" && (
        <div className="progress-row">
          <p className="small">
            <span className="dot dot-teal" />
            技师 <strong>{technician?.name ?? "—"}</strong> · 工位 <strong>{station?.name ?? "—"}</strong>
            （{station ? station.zones.map((z) => ZONE_LABELS[z]).join("/") : ""}） · 派发于{" "}
            {fmtTime(order.dispatchedAt)}
          </p>
          <button className="primary" onClick={onComplete}>
            完工
          </button>
        </div>
      )}

      {order.status === "completed" && (
        <p className="small muted readonly-note">
          🔒 已完工只读 · 技师 {technician?.name ?? "—"} · 工位 {station?.name ?? "—"} · 完工于{" "}
          {fmtTime(order.completedAt)}
        </p>
      )}

      {message && (
        <p className={message.tone === "error" ? "msg msg-error" : "msg msg-ok"}>{message.text}</p>
      )}
    </article>
  );
}
