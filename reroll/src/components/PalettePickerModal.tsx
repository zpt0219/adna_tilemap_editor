import { useEffect, useMemo, useState } from "react";
import { roleTreeDistance } from "../pack/compile";
import { PaletteMode, type Palette, type PackRuntime } from "../pack/types";
import { PaletteSwatch } from "./PaletteSwatch";

export interface PaletteAssignRequest {
  title: string;
  role: string | null;
  currentHash?: string;
  hasOverride: boolean;
  onPick: (hash: string) => void;
  onAuto: () => void;
}

export interface PaletteCreateChoice {
  kind: string;
  role: string;
  palette: Palette;
}

export interface PaletteCreateSlot {
  key: string;
  label: string;
  role: string;
  currentHash?: string;
  choices: PaletteCreateChoice[];
  onPick: (hash: string) => void;
}

interface PaletteCreateRequestBase {
  mode: "create";
  title: string;
  subtitle?: string;
  kindOptions: { kind: string; label: string }[];
  selectedKind: string;
  onSelectKind: (kind: string) => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  confirmLabel?: string;
}

export interface PaletteCreateSingleRequest extends PaletteCreateRequestBase {
  selectionMode: "single";
  choices: PaletteCreateChoice[];
  currentHash?: string;
  onPick: (hash: string) => void;
}

export interface PaletteCreateHouseRequest extends PaletteCreateRequestBase {
  selectionMode: "house";
  houseSlots: PaletteCreateSlot[];
}

export type PaletteCreateRequest = PaletteCreateSingleRequest | PaletteCreateHouseRequest;
export type PalettePickerRequest = PaletteAssignRequest | PaletteCreateRequest;

function isCreateRequest(request: PalettePickerRequest): request is PaletteCreateRequest {
  return "mode" in request && request.mode === "create";
}

function isHouseCreateRequest(request: PaletteCreateRequest): request is PaletteCreateHouseRequest {
  return request.selectionMode === "house";
}

export function PalettePickerModal({
  pack,
  request,
  onClose,
}: {
  pack: PackRuntime | null;
  request: PalettePickerRequest | null;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const createRequest = request && isCreateRequest(request) ? request : null;
  const assignRequest = request && !isCreateRequest(request) ? request : null;

  useEffect(() => {
    setShowAll(false);
  }, [request?.title, createRequest ? "create" : "assign"]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  const createChoices = useMemo(() => {
    if (!createRequest || isHouseCreateRequest(createRequest)) return [];
    return createRequest.choices
      .filter((choice) => choice.kind === createRequest.selectedKind)
      .slice()
      .sort((a, b) =>
        a.role.localeCompare(b.role)
        || a.palette.style.localeCompare(b.palette.style)
        || a.palette.hash.localeCompare(b.palette.hash));
  }, [createRequest]);

  const assignChoices = useMemo(() => {
    if (!pack || !assignRequest) return [];
    const arr = pack.palettes
      .filter((p) => assignRequest.role ? true : p.mode === PaletteMode.FIXED_RECT)
      .map((p) => ({ p, d: assignRequest.role ? roleTreeDistance(assignRequest.role, p.role) : 0 }));
    const list = showAll || !assignRequest.role ? arr : arr.filter((x) => x.d <= 2);
    list.sort((a, b) => a.d - b.d || a.p.role.localeCompare(b.p.role) || a.p.style.localeCompare(b.p.style));
    return list;
  }, [pack, assignRequest, showAll]);

  if (!pack || !request) return null;

  return (
    <div className="pal-modal-backdrop" onClick={onClose}>
      <div className="pal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pal-modal-head">
          <div>
            <div className="pal-modal-title">{request.title}</div>
            <div className="pal-modal-sub">
              {createRequest ? (createRequest.subtitle || "Choose type and palette") : (assignRequest?.role || "未指定 role")}
            </div>
          </div>
          <button onClick={onClose} title="关闭">Close</button>
        </div>
        {createRequest ? (
          <div className="pal-modal-toolbar">
            <div className="seg pal-kind-tabs">
              {createRequest.kindOptions.map((option) => (
                <button
                  key={option.kind}
                  className={createRequest.selectedKind === option.kind ? "active" : ""}
                  onClick={() => createRequest.onSelectKind(option.kind)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pal-picker-head pal-modal-toolbar">
            <button className="pal-auto" disabled={!assignRequest?.hasOverride} onClick={assignRequest?.onAuto} title="恢复按 role 自动选">Auto</button>
            <label className="pal-all"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 全部</label>
          </div>
        )}
        {createRequest && isHouseCreateRequest(createRequest) ? (
          <div className="pal-create-sections">
            {createRequest.houseSlots.map((slot) => {
              const current = slot.choices.find((choice) => choice.palette.hash === slot.currentHash)?.palette ?? null;
              return (
                <section key={slot.key} className="pal-create-section">
                  <div className="pal-create-head">
                    <div>
                      <div className="pal-modal-title">{slot.label}</div>
                      <div className="pal-modal-sub">{slot.role}</div>
                    </div>
                    <div className="pal-current pal-create-current">
                      {current ? <PaletteSwatch pack={pack} palette={current} px={36} /> : <div className="pal-placeholder">Pick</div>}
                      <span className="pal-current-text" title={current ? `${current.role}${current.style ? ` · ${current.style}` : ""}` : "未选择"}>
                        {current ? (current.style || current.role.split("/").pop() || current.role) : "未选择"}
                      </span>
                    </div>
                  </div>
                  <div className="pal-grid pal-modal-grid pal-create-grid">
                    {slot.choices.map((choice) => (
                      <button
                        key={choice.palette.hash}
                        className={`pal-cell pal-modal-cell${choice.palette.hash === slot.currentHash ? " sel" : ""}`}
                        title={`${choice.role}${choice.palette.style ? " · " + choice.palette.style : ""} · ${PaletteMode[choice.palette.mode] ?? choice.palette.mode}`}
                        onClick={() => slot.onPick(choice.palette.hash)}
                      >
                        <PaletteSwatch pack={pack} palette={choice.palette} px={52} />
                        <span className="pal-cell-meta">{choice.palette.style || choice.role.split("/").pop() || choice.role}</span>
                      </button>
                    ))}
                    {slot.choices.length === 0 && <span className="prop-empty">无可用 palette</span>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="pal-grid pal-modal-grid">
            {createRequest ? createChoices.map((choice) => (
              <button
                key={choice.palette.hash}
                className={`pal-cell pal-modal-cell${choice.palette.hash === createRequest.currentHash ? " sel" : ""}`}
                title={`${choice.role}${choice.palette.style ? " · " + choice.palette.style : ""} · ${PaletteMode[choice.palette.mode] ?? choice.palette.mode}`}
                onClick={() => createRequest.onPick(choice.palette.hash)}
              >
                <PaletteSwatch pack={pack} palette={choice.palette} px={52} />
                <span className="pal-cell-meta">{choice.palette.style || choice.role.split("/").pop() || choice.role}</span>
              </button>
            )) : assignChoices.map((entry) => (
              <button
                key={entry.p.hash}
                className={`pal-cell pal-modal-cell${entry.p.hash === assignRequest?.currentHash ? " sel" : ""}`}
                title={`${entry.p.role}${entry.p.style ? " · " + entry.p.style : ""} · ${PaletteMode[entry.p.mode] ?? entry.p.mode}${entry.d > 0 ? ` · d${entry.d}` : ""}`}
                onClick={() => assignRequest?.onPick(entry.p.hash)}
              >
                <PaletteSwatch pack={pack} palette={entry.p} px={52} />
                <span className="pal-cell-meta">{entry.p.role.split("/").pop() || entry.p.role}</span>
              </button>
            ))}
            {(createRequest ? createChoices.length === 0 : assignChoices.length === 0) && <span className="prop-empty">无可用 palette</span>}
          </div>
        )}
        {createRequest && (
          <div className="pal-modal-foot">
            <button onClick={createRequest.onConfirm} disabled={createRequest.confirmDisabled}>{createRequest.confirmLabel ?? "Place"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
