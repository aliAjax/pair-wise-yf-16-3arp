import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import "./styles.css";
import {
  addOrder,
  boardTypeLabel,
  cancelDispatch,
  completeOrder,
  damageNeedsLocation,
  dispatchOrder,
  getMetrics,
  patchOrder,
  stationFreeSlots,
  stationOccupancy,
  technicianRemaining,
  waxHint,
  waxLabel,
  waxMatchesZone,
  zoneLabel,
  BOARD_TYPES,
  WAX_TYPES,
} from "./rules";
import type {
  BoardType,
  NewOrderDraft,
  ShopState,
  Station,
  Technician,
  WaxType,
  WorkOrder,
} from "./rules";
import { loadState, resetState, saveState } from "./storage";

type StatusFilter = "all" | "queued" | "dispatched" | "done";
type BoardFilter = "all" | BoardType;

type EditableDraft = NewOrderDraft;

interface Toast {
  id: number;
  kind: "error" | "success" | "warn";
  text: string;
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "queued", label: "待派发" },
  { value: "dispatched", label: "施工中" },
  { value: "done", label: "已完工" },
];

function emptyDraft(): EditableDraft {
  return {
    customer: "",
    phone: "",
    brand: "",
    length: 155,
    boardType: "all-mountain",
    edge: { side: 88, base: 1 },
    wax: "universal",
    baseDamage: "",
    repairLocation: "",
    note: "",
    minutes: 60,
  };
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

function statusBadge(status: WorkOrder["status"]): {
  label: string;
  cls: string;
} {
  if (status === "queued") return { label: "待派发", cls: "badge queued" };
  if (status === "dispatched") return { label: "施工中", cls: "badge dispatched" };
  return { label: "已完工", cls: "badge done" };
}

function App() {
  const [state, setState] = useState<ShopState>(() => loadState());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableDraft>(emptyDraft());
  const [showNewForm, setShowNewForm] = useState(false);
  const [newDraft, setNewDraft] = useState<EditableDraft>(emptyDraft());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dispatchChoice, setDispatchChoice] = useState<
    Record<string, { techId: string; stationId: string }>
  >({});

  // 仅存浏览器：任何状态变化都同步 localStorage
  useEffect(() => {
    saveState(state);
  }, [state]);

  const metrics = useMemo(() => getMetrics(state), [state]);
  const techById = useMemo(() => {
    const map = new Map<string, Technician>();
    state.techs.forEach((t) => map.set(t.id, t));
    return map;
  }, [state.techs]);
  const stationById = useMemo(() => {
    const map = new Map<string, Station>();
    state.stations.forEach((s) => map.set(s.id, s));
    return map;
  }, [state.stations]);

  const pushToast = (kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 4200);
  };

  // ---------- 派发 ----------
  const handleDispatch = (order: WorkOrder) => {
    const choice = dispatchChoice[order.id];
    if (!choice) {
      pushToast("error", "请先选择技师与工位");
      return;
    }
    const result = dispatchOrder(
      state,
      order.id,
      choice.techId,
      choice.stationId
    );
    if (result.error) {
      // 整单拒绝：队列与占用都不变
      pushToast("error", result.error);
      return;
    }
    setState(result.state);
    pushToast("success", `已派发：${order.id} → ${order.brand} ${order.length}cm`);
  };

  // ---------- 编辑（可能触发强制撤单） ----------
  const startEdit = (order: WorkOrder) => {
    setEditingId(order.id);
    setDraft({
      customer: order.customer,
      phone: order.phone,
      brand: order.brand,
      length: order.length,
      boardType: order.boardType,
      edge: { ...order.edge },
      wax: order.wax,
      baseDamage: order.baseDamage,
      repairLocation: order.repairLocation,
      note: order.note,
      minutes: order.minutes,
    });
  };

  const saveEdit = (order: WorkOrder) => {
    if (draft.brand.trim() === "" || draft.customer.trim() === "") {
      pushToast("error", "客户与品牌不能为空");
      return;
    }
    const result = patchOrder(state, order.id, { ...draft });
    setState(result.state);
    setEditingId(null);
    if (result.withdrawn) {
      pushToast(
        "warn",
        `已自动撤单：${order.id} 的${
          order.status === "dispatched" ? "损伤/刃角" : "信息"
        }被改动，工位与技师余时已释放，工单回到待派发队列`
      );
    } else {
      pushToast("success", `工单 ${order.id} 已更新`);
    }
  };

  const handleComplete = (order: WorkOrder) => {
    setState(completeOrder(state, order.id));
    pushToast("success", `${order.id} 已完工，进入只读档案`);
  };

  const handleCancel = (order: WorkOrder) => {
    setState(cancelDispatch(state, order.id));
    pushToast("warn", `${order.id} 已撤回，工位与余时已释放`);
  };

  const handleCreate = () => {
    if (newDraft.customer.trim() === "" || newDraft.brand.trim() === "") {
      pushToast("error", "请填写客户与雪板品牌");
      return;
    }
    if (newDraft.length < 100 || newDraft.length > 210) {
      pushToast("error", "板长需在 100–210cm 之间");
      return;
    }
    setState(addOrder(state, newDraft));
    setNewDraft(emptyDraft());
    setShowNewForm(false);
    pushToast("success", "新工单已进入待派发队列");
  };

  // ---------- 筛选 ----------
  const visibleOrders = useMemo(() => {
    return state.orders
      .filter((o) => statusFilter === "all" || o.status === statusFilter)
      .filter((o) => boardFilter === "all" || o.boardType === boardFilter)
      .filter((o) => customerFilter === null || o.phone === customerFilter)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [state.orders, statusFilter, boardFilter, customerFilter]);

  // ---------- 客户历史（与工单数据同源同步） ----------
  const customerHistory = useMemo(() => {
    const map = new Map<
      string,
      { name: string; phone: string; count: number; latest: number; boards: string[] }
    >();
    for (const o of state.orders) {
      const prev = map.get(o.phone);
      const entry = prev ?? {
        name: o.customer,
        phone: o.phone,
        count: 0,
        latest: 0,
        boards: [],
      };
      entry.count += 1;
      entry.latest = Math.max(entry.latest, o.updatedAt);
      entry.boards.push(`${o.brand} ${o.length}`);
      map.set(o.phone, entry);
    }
    return [...map.values()].sort((a, b) => b.latest - a.latest);
  }, [state.orders]);

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="kicker">SNOWBOARD TUNING DISPATCH</p>
          <h1>雪板调校工位派发台</h1>
        </div>
        <div className="topbar-actions">
          <span className="local-note">数据仅保存在本浏览器</span>
          <button
            onClick={() => {
              if (window.confirm("恢复预置工单、技师与工位？当前修改将被清空。")) {
                setState(resetState());
                setEditingId(null);
                setCustomerFilter(null);
                pushToast("success", "已恢复预置数据");
              }
            }}
          >
            恢复预置数据
          </button>
        </div>
      </header>

      <section className="metrics">
        <article>
          <small>待维护（待派发 + 施工中）</small>
          <strong>{metrics.activeCount}</strong>
          <span className="metric-sub">
            队列 {metrics.queuedCount} · 工位 {metrics.dispatchedCount}
          </span>
        </article>
        <article>
          <small>完工工单</small>
          <strong>{metrics.doneCount}</strong>
          <span className="metric-sub">只读档案，不再占工位</span>
        </article>
        <article>
          <small>平均侧刃角</small>
          <strong>{metrics.averageSideEdge.toFixed(1)}°</strong>
          <span className="metric-sub">底刃另在工单内记录</span>
        </article>
        <article>
          <small>底板损伤登记</small>
          <strong>{metrics.damageCount}</strong>
          <span className="metric-sub">须登记修补位置才可派发</span>
        </article>
      </section>

      <div className="board-grid">
        {/* 左栏：工位负载 + 技师余时 + 客户历史 */}
        <aside className="sidebar">
          <section className="panel">
            <h2>工位负载</h2>
            <div className="station-list">
              {state.stations.map((station) => {
                const used = stationOccupancy(state, station.id);
                const free = stationFreeSlots(state, station.id);
                const pct = Math.round((used / station.capacity) * 100);
                const assigned = state.orders.filter(
                  (o) => o.status === "dispatched" && o.stationId === station.id
                );
                return (
                  <div key={station.id} className="station-card">
                    <div className="station-head">
                      <b>{station.name}</b>
                      <span className="zone-tag">{zoneLabel(station.zone)}</span>
                    </div>
                    <div className="load-line">
                      <div className="bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <span>
                        {used}/{station.capacity}
                        {free === 0 && <em className="full"> 满</em>}
                      </span>
                    </div>
                    <p className="wax-line">
                      接收：
                      {WAX_TYPES.filter((w) =>
                        waxMatchesZone(w.value, station.zone)
                      ).map((w) => w.label).join(" / ")}
                    </p>
                    {assigned.length > 0 && (
                      <ul className="assigned">
                        {assigned.map((o) => (
                          <li key={o.id}>
                            {o.id} · {o.brand} {o.length}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <h2 className="second">技师余时</h2>
            <div className="station-list">
              {state.techs.map((tech) => {
                const remaining = technicianRemaining(state, tech.id);
                const pct = Math.round((remaining / tech.capacity) * 100);
                const assigned = state.orders.filter(
                  (o) => o.status === "dispatched" && o.techId === tech.id
                );
                return (
                  <div key={tech.id} className="station-card">
                    <div className="station-head">
                      <b>{tech.name}</b>
                      <span className="tech-title">{tech.title}</span>
                    </div>
                    <div className="load-line">
                      <div className="bar teal">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <span className={remaining < 60 ? "time-low" : ""}>
                        余 {remaining}′ / {tech.capacity}′
                      </span>
                    </div>
                    {assigned.length > 0 && (
                      <ul className="assigned">
                        {assigned.map((o) => (
                          <li key={o.id}>
                            {o.id} · 占用 {o.minutes}′
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <h2>客户历史</h2>
            <ul className="history-list">
              {customerHistory.map((c) => (
                <li key={c.phone}>
                  <button
                    className={
                      customerFilter === c.phone ? "history-item active" : "history-item"
                    }
                    onClick={() =>
                      setCustomerFilter(
                        customerFilter === c.phone ? null : c.phone
                      )
                    }
                  >
                    <span className="history-name">
                      {c.name}
                      {customerFilter === c.phone && <em> 筛选中</em>}
                    </span>
                    <span className="history-meta">
                      {c.count} 单 · 最近 {timeAgo(c.latest)}
                    </span>
                    <span className="history-boards">{c.boards.join("；")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {/* 右栏：工单队列 */}
        <section className="main-col">
          <section className="panel queue-panel">
            <div className="heading">
              <div>
                <p className="kicker">WORK ORDERS</p>
                <h2>工单队列</h2>
              </div>
              <button
                className="primary"
                onClick={() => setShowNewForm((v) => !v)}
              >
                {showNewForm ? "收起新工单" : "+ 登记新工单"}
              </button>
            </div>

            {showNewForm && (
              <OrderForm
                draft={newDraft}
                onChange={setNewDraft}
                onSubmit={handleCreate}
                submitLabel="进入待派发队列"
              />
            )}

            <div className="filters">
              <div className="tabs">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    className={statusFilter === tab.value ? "tab active" : "tab"}
                    onClick={() => setStatusFilter(tab.value)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="chips">
                <button
                  className={boardFilter === "all" ? "chip active" : "chip"}
                  onClick={() => setBoardFilter("all")}
                >
                  全部板型
                </button>
                {BOARD_TYPES.map((b) => (
                  <button
                    key={b.value}
                    className={boardFilter === b.value ? "chip active" : "chip"}
                    onClick={() => setBoardFilter(b.value)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {customerFilter !== null && (
              <div className="customer-chip">
                正在查看客户历史：<b>{customerFilter}</b>
                <button onClick={() => setCustomerFilter(null)}>清除筛选</button>
              </div>
            )}

            <div className="orders">
              {visibleOrders.length === 0 && (
                <p className="empty">当前筛选下没有工单。</p>
              )}
              {visibleOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  state={state}
                  techName={order.techId ? techById.get(order.techId)?.name : undefined}
                  stationName={
                    order.stationId ? stationById.get(order.stationId)?.name : undefined
                  }
                  editing={editingId === order.id}
                  draft={draft}
                  choice={
                    dispatchChoice[order.id] ?? {
                      techId: state.techs[0]?.id ?? "",
                      stationId: state.stations[0]?.id ?? "",
                    }
                  }
                  onChoiceChange={(choice) =>
                    setDispatchChoice((map) => ({ ...map, [order.id]: choice }))
                  }
                  onStartEdit={() => startEdit(order)}
                  onCancelEdit={() => setEditingId(null)}
                  onDraftChange={setDraft}
                  onSave={() => saveEdit(order)}
                  onDispatch={() => handleDispatch(order)}
                  onComplete={() => handleComplete(order)}
                  onCancelDispatch={() => handleCancel(order)}
                />
              ))}
            </div>
          </section>
        </section>
      </div>

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </main>
  );
}

interface OrderFormProps {
  draft: EditableDraft;
  onChange: (draft: EditableDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
}

function OrderForm({ draft, onChange, onSubmit, submitLabel }: OrderFormProps) {
  const set = <K extends keyof EditableDraft>(key: K, value: EditableDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const damageWithoutLocation =
    draft.baseDamage.trim() !== "" && draft.repairLocation.trim() === "";

  return (
    <div className="order-form">
      <div className="field-grid">
        <label>
          <span>客户</span>
          <input
            value={draft.customer}
            onChange={(e) => set("customer", e.target.value)}
            placeholder="如：陈野"
          />
        </label>
        <label>
          <span>联系电话</span>
          <input
            value={draft.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="用于归并客户历史"
          />
        </label>
        <label>
          <span>雪板品牌</span>
          <input
            value={draft.brand}
            onChange={(e) => set("brand", e.target.value)}
            placeholder="如：Burton Custom"
          />
        </label>
        <label>
          <span>长度 (cm)</span>
          <input
            type="number"
            min={100}
            max={210}
            value={draft.length}
            onChange={(e) => set("length", Number(e.target.value))}
          />
        </label>
        <label>
          <span>板型</span>
          <select
            value={draft.boardType}
            onChange={(e) => set("boardType", e.target.value as BoardType)}
          >
            {BOARD_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>蜡型</span>
          <select
            value={draft.wax}
            onChange={(e) => set("wax", e.target.value as WaxType)}
          >
            {WAX_TYPES.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}（{w.hint}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>侧刃角 (°) · 87–90</span>
          <input
            type="number"
            step={0.5}
            min={85}
            max={90}
            value={draft.edge.side}
            onChange={(e) =>
              set("edge", { ...draft.edge, side: Number(e.target.value) })
            }
          />
        </label>
        <label>
          <span>底刃角 (°) · 0–2</span>
          <input
            type="number"
            step={0.25}
            min={0}
            max={2}
            value={draft.edge.base}
            onChange={(e) =>
              set("edge", { ...draft.edge, base: Number(e.target.value) })
            }
          />
        </label>
        <label>
          <span>底板损伤（无则留空）</span>
          <input
            value={draft.baseDamage}
            onChange={(e) => set("baseDamage", e.target.value)}
            placeholder="如：底板深划痕 12cm"
          />
        </label>
        <label>
          <span>修补位置{damageWithoutLocation && <b className="req"> *必填</b>}</span>
          <input
            className={damageWithoutLocation ? "invalid" : ""}
            value={draft.repairLocation}
            onChange={(e) => set("repairLocation", e.target.value)}
            placeholder={
              draft.baseDamage.trim() !== ""
                ? "如：板头左侧 3cm 范围"
                : "无损伤时无需填写"
            }
          />
        </label>
        <label>
          <span>预计工时（分钟）</span>
          <select
            value={draft.minutes}
            onChange={(e) => set("minutes", Number(e.target.value))}
          >
            {[45, 60, 75, 90, 105, 120, 150].map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>客户偏好 / 备注</span>
          <input
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="如：偏好弱咬雪"
          />
        </label>
      </div>
      {damageWithoutLocation && (
        <p className="form-warn">
          ⚠ 已登记底板损伤但未填写修补位置 —— 工单可保存，但派发会被整单拒绝。
        </p>
      )}
      <div className="form-actions">
        <button className="primary" onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface OrderCardProps {
  order: WorkOrder;
  state: ShopState;
  techName?: string;
  stationName?: string;
  editing: boolean;
  draft: EditableDraft;
  choice: { techId: string; stationId: string };
  onChoiceChange: (choice: { techId: string; stationId: string }) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (draft: EditableDraft) => void;
  onSave: () => void;
  onDispatch: () => void;
  onComplete: () => void;
  onCancelDispatch: () => void;
}

function OrderCard({
  order,
  state,
  techName,
  stationName,
  editing,
  draft,
  choice,
  onChoiceChange,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onSave,
  onDispatch,
  onComplete,
  onCancelDispatch,
}: OrderCardProps) {
  const b = statusBadge(order.status);
  const readOnly = order.status === "done";

  // 派发预检：把三条拒绝规则实时显示在派发区
  const previewOrder: WorkOrder =
    editing && order.status !== "done"
      ? { ...order, ...draft, edge: { ...draft.edge } }
      : order;
  const damageBlocked = damageNeedsLocation(previewOrder);
  const chosenTech = state.techs.find((t) => t.id === choice.techId);
  const chosenStation = state.stations.find((s) => s.id === choice.stationId);
  const remaining = choice.techId
    ? technicianRemaining(state, choice.techId)
    : 0;
  const timeBlocked = chosenTech ? remaining < previewOrder.minutes : false;
  const zoneBlocked = chosenStation
    ? !waxMatchesZone(previewOrder.wax, chosenStation.zone)
    : false;
  const slotBlocked = chosenStation
    ? stationFreeSlots(state, chosenStation.id) <= 0
    : false;

  return (
    <article className={`order-card ${order.status}`}>
      <div className="order-head">
        <div className="order-title">
          <h3>{order.id}</h3>
          <span className={b.cls}>{b.label}</span>
        </div>
        <div className="order-meta">
          <span>
            {order.customer} · {order.phone}
          </span>
          <span>更新于 {timeAgo(order.updatedAt)}</span>
        </div>
      </div>

      {editing && !readOnly ? (
        <>
          <OrderForm
            draft={draft}
            onChange={onDraftChange}
            onSubmit={onSave}
            submitLabel="保存改动"
          />
          {order.status === "dispatched" && (
            <p className="form-warn">
              ⚠ 该单正在工位上施工。保存时若改动了底板损伤 / 修补位置 / 刃角，
              将立即撤单并释放工位与技师余时。
            </p>
          )}
          <div className="form-actions inline">
            <button className="primary" onClick={onSave}>
              保存
            </button>
            <button onClick={onCancelEdit}>取消</button>
          </div>
        </>
      ) : (
        <>
          <div className="spec-grid">
            <Spec label="品牌 / 长度">
              {order.brand} · {order.length}cm
            </Spec>
            <Spec label="板型">{boardTypeLabel(order.boardType)}</Spec>
            <Spec label="刃角">
              侧刃 {order.edge.side}° / 底刃 {order.edge.base}°
            </Spec>
            <Spec label="蜡型">
              {waxLabel(order.wax)}
              <em className="hint"> {waxHint(order.wax)}</em>
            </Spec>
            <Spec label="底板损伤">
              {order.baseDamage || <em className="none">无</em>}
            </Spec>
            <Spec label="修补位置">
              {order.repairLocation || <em className="none">—</em>}
            </Spec>
            <Spec label="预计工时">{order.minutes} 分钟</Spec>
            <Spec label="备注">
              {order.note || <em className="none">—</em>}
            </Spec>
          </div>

          {order.status === "dispatched" && (
            <div className="assign-line">
              <span className="assign-tag">🔧 {techName}</span>
              <span className="assign-tag">📍 {stationName}</span>
              <span className="assign-since">
                派发于 {timeAgo(order.updatedAt)}
              </span>
            </div>
          )}
          {order.status === "done" && (
            <div className="assign-line">
              <span className="assign-tag muted">完工技师：{techName ?? "—"}</span>
              <span className="assign-since">
                完工于 {order.completedAt ? timeAgo(order.completedAt) : "—"}
              </span>
              <em className="readonly-note">已完工工单只读</em>
            </div>
          )}

          <div className="card-actions">
            {order.status === "queued" && (
              <>
                <button onClick={onStartEdit}>编辑工单</button>
                <div className="dispatch-box">
                  <select
                    value={choice.techId}
                    onChange={(e) =>
                      onChoiceChange({ ...choice, techId: e.target.value })
                    }
                  >
                    {state.techs.map((t) => {
                      const rem = technicianRemaining(state, t.id);
                      return (
                        <option key={t.id} value={t.id}>
                          {t.name}（余 {rem}′）
                          {rem < order.minutes ? " · 余时不足" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    value={choice.stationId}
                    onChange={(e) =>
                      onChoiceChange({ ...choice, stationId: e.target.value })
                    }
                  >
                    {state.stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {zoneLabel(s.zone)} · 余位{" "}
                        {stationFreeSlots(state, s.id)}
                      </option>
                    ))}
                  </select>
                  <button className="primary" onClick={onDispatch}>
                    派发
                  </button>
                </div>
              </>
            )}
            {order.status === "dispatched" && (
              <>
                <button onClick={onStartEdit}>编辑（改损伤/刃角会撤单）</button>
                <button className="primary" onClick={onComplete}>
                  完工
                </button>
                <button onClick={onCancelDispatch}>撤回派发</button>
              </>
            )}
            {readOnly && <span className="readonly-lock">🔒 只读档案</span>}
          </div>

          {order.status === "queued" && (
            <ul className="precheck">
              {damageBlocked && (
                <li className="block">✕ 底板损伤未登记修补位置，派发将被整单拒绝</li>
              )}
              {timeBlocked && chosenTech && (
                <li className="block">
                  ✕ {chosenTech.name} 余时不足（需 {previewOrder.minutes}′，仅剩 {remaining}′）
                </li>
              )}
              {zoneBlocked && chosenStation && (
                <li className="block">
                  ✕ {waxLabel(previewOrder.wax)}不符合「{chosenStation.name}」
                  的{zoneLabel(chosenStation.zone)}温区
                </li>
              )}
              {slotBlocked && chosenStation && (
                <li className="block">✕ 「{chosenStation.name}」余位已满</li>
              )}
              {!damageBlocked && !timeBlocked && !zoneBlocked && !slotBlocked && (
                <li className="ok">✓ 规则预检通过，可派发</li>
              )}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="spec">
      <small>{label}</small>
      <p>{children}</p>
    </div>
  );
}

export default App;
