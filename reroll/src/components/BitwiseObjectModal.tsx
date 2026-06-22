import { useEffect, useMemo, useState } from "react";
import type { BitwiseObjectOp } from "../bitwise";
import type { LiteType } from "../model";

export interface BitwiseSourceOption {
  id: number;
  label: string;
  layerId: number;
  layerName: string;
  type: LiteType;
  role: string;
  overlap: boolean;
  origin: [number, number];
  size: [number, number];
}

export interface BitwiseObjectRequest {
  targetLabel: string;
  targetLayerName: string;
  targetType: LiteType;
  targetRole: string;
  sources: BitwiseSourceOption[];
  selectedSourceId: number | null;
  onSelectSource: (id: number) => void;
  onApply: (op: BitwiseObjectOp) => void;
}

const OP_LABEL: { op: BitwiseObjectOp; label: string; sub: string }[] = [
  { op: "AND", label: "AND", sub: "Intersect" },
  { op: "OR", label: "OR", sub: "Union" },
  { op: "SUBTRACT", label: "SUBTRACT", sub: "Diff" },
  { op: "COPY", label: "COPY", sub: "Overwrite" },
];

export function BitwiseObjectModal({
  request,
  onClose,
}: {
  request: BitwiseObjectRequest | null;
  onClose: () => void;
}) {
  const sources = request?.sources ?? [];

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  const groups = useMemo(() => {
    const byLayer = new Map<number, { layerId: number; layerName: string; overlapCount: number; objects: BitwiseSourceOption[] }>();
    for (const source of sources) {
      let group = byLayer.get(source.layerId);
      if (!group) {
        group = { layerId: source.layerId, layerName: source.layerName, overlapCount: 0, objects: [] };
        byLayer.set(source.layerId, group);
      }
      group.objects.push(source);
      if (source.overlap) group.overlapCount++;
    }
    return [...byLayer.values()];
  }, [sources]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!request) return;
    const next = new Set<number>();
    for (const group of groups) {
      if (
        group.overlapCount > 0
        || group.objects.some((source) => source.id === request.selectedSourceId)
        || groups.length <= 4
      ) {
        next.add(group.layerId);
      }
    }
    setExpanded(next);
  }, [groups, request]);

  if (!request) return null;

  const selected = sources.find((source) => source.id === request.selectedSourceId) ?? null;
  const canApply = !!selected?.overlap;

  return (
    <div className="pal-modal-backdrop" onClick={onClose}>
      <div className="pal-modal bitwise-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pal-modal-head">
          <div>
            <div className="pal-modal-title">Bitwise with Object</div>
            <div className="pal-modal-sub">Select a source object, then apply a bitwise operation to the current target.</div>
          </div>
          <button onClick={onClose} title="关闭">Close</button>
        </div>

        <div className="bitwise-summary">
          <div className="bitwise-target">
            <div className="bitwise-label">Target</div>
            <div className="bitwise-target-main">{request.targetLabel}</div>
            <div className="bitwise-target-sub">{request.targetLayerName} · {request.targetType}{request.targetRole ? ` · ${request.targetRole}` : ""}</div>
          </div>
          <div className="bitwise-note">Only the overlap between target and source is affected.</div>
        </div>

        <div className="bitwise-tree">
          {sources.length === 0 ? (
            <div className="prop-empty">No other bitwise-supported objects</div>
          ) : groups.map((group) => {
            const open = expanded.has(group.layerId);
            return (
              <div key={group.layerId} className="layer-group bitwise-layer-group">
                <div
                  className={`layer-row bitwise-layer-row${group.objects.some((source) => source.id === request.selectedSourceId) ? " active" : ""}`}
                  onClick={() => setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.layerId)) next.delete(group.layerId);
                    else next.add(group.layerId);
                    return next;
                  })}
                >
                  <button className="caret" onClick={(e) => { e.stopPropagation(); setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.layerId)) next.delete(group.layerId);
                    else next.add(group.layerId);
                    return next;
                  }); }}>
                    {open ? "▾" : "▸"}
                  </button>
                  <span className="layer-name" title={group.layerName}>{group.layerName}</span>
                  <span className="layer-count">{group.overlapCount}/{group.objects.length}</span>
                </div>
                {open && group.objects.map((source) => (
                  <div
                    key={source.id}
                    className={`obj-row bitwise-obj-row${source.id === request.selectedSourceId ? " selected" : ""}${source.overlap ? "" : " hidden"}`}
                    onClick={() => request.onSelectSource(source.id)}
                    title={`${source.label} · ${source.type}${source.role ? ` · ${source.role}` : ""}`}
                  >
                    <span className="bitwise-obj-main">
                      <span className="obj-name">{source.label}</span>
                      <span className="bitwise-obj-meta">{source.type}{source.role ? ` · ${source.role}` : ""}</span>
                    </span>
                    <span className={`bitwise-source-badge${source.overlap ? " overlap" : ""}`}>{source.overlap ? "Overlap" : "No overlap"}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="pal-modal-foot bitwise-foot">
          {selected && !selected.overlap && <span className="prop-empty bitwise-warn">Selected source does not overlap the target.</span>}
          <span className="seg">
            {OP_LABEL.map((item) => (
              <button
                key={item.op}
                disabled={!canApply}
                title={item.sub}
                onClick={() => request.onApply(item.op)}
              >
                {item.label}
              </button>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
