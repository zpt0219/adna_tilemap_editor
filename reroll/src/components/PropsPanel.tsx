// PropsPanel — the right sidebar. Layer + Object inspection, plus palette
// selection via a shared modal picker backed by the loaded pack.

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_FRG_PLACEMENT_MODE, displayName, isLocked, roleOf, type FrgPlacementMode, type HouseDecorationKind, type Layer, type LiteObject, type LiteType } from "../model";
import { colorForRole, rgbaCss } from "../generated/roleColors";
import { PaletteMode, type Palette, type PackRuntime } from "../pack/types";
import type { Bindings } from "../pack/compile";
import { decorationRole } from "../house";
import { isBitwiseSupported } from "../bitwise";
import { PalettePickerModal, type PaletteAssignRequest } from "./PalettePickerModal";
import { PaletteSwatch } from "./PaletteSwatch";
import { DEFAULT_MORPH_NOISE_CONFIG, frgNoiseConfigFromObject, noiseConfigFromTags, randomizeNoiseSeed, randomizeTerrainNoiseSeed, terrainNoiseConfigFromObject, type TerrainNoiseConfig } from "../terrainNoise";

// Friendly object-type names (the engine TYPE -> a word a map-maker reads).
const TYPE_LABEL: Record<LiteObject["type"], string> = {
  TERRAIN_2_CORNER: "Terrain",
  TERRAIN_2_EDGE: "Path",
  FIXED_RECT_GROUP: "Group",
  FIXED_RECT: "Rect",
  DUNGEON: "Dungeon",
  HOUSE: "House",
};

// Terrain types a cell-matrix object can be converted between.
const TERRAIN_TYPES: [LiteType, string][] = [
  ["TERRAIN_2_CORNER", "2-Corner"],
  ["TERRAIN_2_EDGE", "2-Edge"],
  ["FIXED_RECT_GROUP", "Scatter"],
];

const FRG_PLACEMENT_MODES: [FrgPlacementMode, string][] = [
  ["free", "Free Stacking"],
  ["base_collision", "Base Collision"],
  ["y_sorted_stacking", "Y-Sorted Stacking"],
  ["row_no_overlap", "Row No Overlap"],
  ["full_collision", "Full Collision"],
];

export interface PropsPanelProps {
  layer: Layer | null;
  mapSize: [number, number];
  /** selected objects, primary first ([...selected] order) */
  objects: LiteObject[];
  pack: PackRuntime | null;
  bindings: Bindings | null;
  onToggleLayerVisible: () => void;
  onSetObjectsVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onSetRectToMap: (id: number) => void;
  onSetRectToAabb: (id: number) => void;
  onRandomizeTerrain: (id: number, config: TerrainNoiseConfig) => void;
  onPreviewTerrainNoise: (id: number, config: TerrainNoiseConfig) => void;
  onCommitTerrainNoisePreview: (id: number, config: TerrainNoiseConfig) => void;
  onCancelTerrainNoisePreview: () => void;
  onSetTerrainBorderAsConnected: (id: number, enabled: boolean) => void;
  onRunMorph: (id: number, mode: "dilate" | "erode" | "erode_dilate" | "dilate_erode", dilate: TerrainNoiseConfig, erode: TerrainNoiseConfig) => void;
  onInitBitwise: (id: number, filled: boolean) => void;
  onRunBitwiseQuickOp: (id: number, op: "keep_border" | "flip" | "remove_zero") => void;
  onOpenBitwise: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onSetObjectType: (id: number, type: LiteType) => void;
  onSetPalette: (id: number, hash: string | null) => void;
  onAddFrgCell: (id: number, paletteHash: string) => void;
  onRemoveFrgCell: (id: number, index: number) => void;
  onSetFrgCellWeight: (id: number, index: number, weight: number) => void;
  onSetFrgPlacementMode: (id: number, placementMode: FrgPlacementMode) => void;
  onApplyFrgNoise: (id: number, config: TerrainNoiseConfig) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
  onAddHouseDecoration: (id: number, kind: HouseDecorationKind, palette?: string) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
  onGenerateHouseDecorations: (id: number) => void;
}

interface NoiseEditorRequest {
  title: string;
  value: TerrainNoiseConfig;
  onPreview?: (next: TerrainNoiseConfig) => void;
  onCancel?: () => void;
  onApply: (next: TerrainNoiseConfig) => void;
}

function TerrainNoiseEditor({ o, onRandomizeTerrain, onPreviewTerrainNoise, onCommitTerrainNoisePreview, onCancelTerrainNoisePreview, onOpenNoiseEditor }: {
  o: LiteObject;
  onRandomizeTerrain: (id: number, config: TerrainNoiseConfig) => void;
  onPreviewTerrainNoise: (id: number, config: TerrainNoiseConfig) => void;
  onCommitTerrainNoisePreview: (id: number, config: TerrainNoiseConfig) => void;
  onCancelTerrainNoisePreview: () => void;
  onOpenNoiseEditor: (request: NoiseEditorRequest) => void;
}) {
  const [draft, setDraft] = useState<TerrainNoiseConfig>(() => terrainNoiseConfigFromObject(o));

  useEffect(() => {
    setDraft(terrainNoiseConfigFromObject(o));
  }, [o.id, o.tags]);

  return (
    <>
      <Row label="Rand Terrain">
        <span className="seg">
          <button onClick={() => onRandomizeTerrain(o.id, draft)}>Apply</button>
          <button onClick={() => {
            const next = randomizeTerrainNoiseSeed(draft);
            setDraft(next);
            onRandomizeTerrain(o.id, next);
          }}>Re-rand</button>
          <button onClick={() => onOpenNoiseEditor({
            title: "Terrain Noise",
            value: draft,
            onPreview: (next) => {
              setDraft(next);
              onPreviewTerrainNoise(o.id, next);
            },
            onCancel: onCancelTerrainNoisePreview,
            onApply: (next) => {
              setDraft(next);
              onCommitTerrainNoisePreview(o.id, next);
            },
          })}>Edit</button>
        </span>
      </Row>
    </>
  );
}

function NoiseFields({ draft, onChange }: {
  draft: TerrainNoiseConfig;
  onChange: (next: TerrainNoiseConfig) => void;
}) {
  return (
    <>
      <Row label="Seed">
        <span className="noise-seed-row">
          <input
            className="prop-num"
            type="number"
            value={draft.seed}
            onChange={(e) => onChange({ ...draft, seed: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          />
          <button onClick={() => onChange(randomizeNoiseSeed(draft))}>R</button>
        </span>
      </Row>
      <Row label="Scale">
        <span className="noise-scale-row">
          <input
            className="noise-scale-slider"
            type="range"
            min={0}
            max={10}
            step={0.001}
            value={draft.scale}
            onChange={(e) => onChange({ ...draft, scale: Math.max(0, parseFloat(e.target.value) || 0) })}
          />
          <span className="noise-scale-value">{draft.scale.toFixed(3)}</span>
        </span>
      </Row>
      <Row label="Range">
        <span className="prop-inline-num">
          <input
            className="prop-num"
            type="number"
            min={0}
            max={1}
            step="0.01"
            value={draft.range[0]}
            onChange={(e) => onChange({
              ...draft,
              range: [Math.max(0, Math.min(draft.range[1], parseFloat(e.target.value) || 0)), draft.range[1]],
            })}
          />
          <input
            className="prop-num"
            type="number"
            min={0}
            max={1}
            step="0.01"
            value={draft.range[1]}
            onChange={(e) => onChange({
              ...draft,
              range: [draft.range[0], Math.min(1, Math.max(draft.range[0], parseFloat(e.target.value) || draft.range[0]))],
            })}
          />
        </span>
      </Row>
    </>
  );
}

function NoiseEditorModal({ request, onClose }: {
  request: NoiseEditorRequest | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TerrainNoiseConfig | null>(request?.value ?? null);

  useEffect(() => {
    setDraft(request?.value ?? null);
  }, [request?.title, request?.value.seed, request?.value.scale, request?.value.range[0], request?.value.range[1]]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      request.onCancel?.();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request || !draft) return null;

  const applyDraft = (next: TerrainNoiseConfig) => {
    setDraft(next);
    request.onPreview?.(next);
  };

  const closeCancel = () => {
    request.onCancel?.();
    onClose();
  };

  return (
    <div className="pal-modal-backdrop" onClick={closeCancel}>
      <div className="pal-modal noise-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pal-modal-head">
          <div>
            <div className="pal-modal-title">{request.title}</div>
            <div className="pal-modal-sub">Seed, scale, and range.</div>
          </div>
          <button onClick={closeCancel} title="关闭">Close</button>
        </div>
        <div className="noise-modal-body">
          <NoiseFields draft={draft} onChange={applyDraft} />
        </div>
        <div className="pal-modal-foot">
          <button onClick={closeCancel}>Cancel</button>
          <button onClick={() => { request.onApply(draft); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function MorphNoiseEditor({ o, onRunMorph, onOpenNoiseEditor }: {
  o: LiteObject;
  onRunMorph: (id: number, mode: "dilate" | "erode" | "erode_dilate" | "dilate_erode", dilate: TerrainNoiseConfig, erode: TerrainNoiseConfig) => void;
  onOpenNoiseEditor: (request: NoiseEditorRequest) => void;
}) {
  const [dilate, setDilate] = useState<TerrainNoiseConfig>(() => noiseConfigFromTags(o.tags, "web.dilate", DEFAULT_MORPH_NOISE_CONFIG));
  const [erode, setErode] = useState<TerrainNoiseConfig>(() => noiseConfigFromTags(o.tags, "web.erode", DEFAULT_MORPH_NOISE_CONFIG));

  useEffect(() => {
    setDilate(noiseConfigFromTags(o.tags, "web.dilate", DEFAULT_MORPH_NOISE_CONFIG));
    setErode(noiseConfigFromTags(o.tags, "web.erode", DEFAULT_MORPH_NOISE_CONFIG));
  }, [o.id, o.tags]);

  return (
    <>
      <Row label="Dilate">
        <span className="seg">
          <button onClick={() => onRunMorph(o.id, "dilate", dilate, erode)}>Apply</button>
          <button onClick={() => {
            const next = randomizeNoiseSeed(dilate);
            setDilate(next);
            onRunMorph(o.id, "dilate", next, erode);
          }}>Re-rand</button>
          <button onClick={() => onOpenNoiseEditor({
            title: "Dilate Noise",
            value: dilate,
            onApply: setDilate,
          })}>Edit</button>
        </span>
      </Row>
      <Row label="Erode">
        <span className="seg">
          <button onClick={() => onRunMorph(o.id, "erode", dilate, erode)}>Apply</button>
          <button onClick={() => {
            const next = randomizeNoiseSeed(erode);
            setErode(next);
            onRunMorph(o.id, "erode", dilate, next);
          }}>Re-rand</button>
          <button onClick={() => onOpenNoiseEditor({
            title: "Erode Noise",
            value: erode,
            onApply: setErode,
          })}>Edit</button>
        </span>
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-val">{children}</span>
    </div>
  );
}

function paletteSummary(p: Palette | null): string {
  if (!p) return "Auto";
  return p.style ? `${p.role} · ${p.style}` : p.role;
}

function PaletteField({
  pack,
  label,
  current,
  hasOverride,
  onChange,
  onAuto,
  actionLabel = "Change...",
}: {
  pack: PackRuntime;
  label: string;
  current: Palette | null;
  hasOverride: boolean;
  onChange: () => void;
  onAuto: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="pal-field">
      <div className="pal-picker-head">
        <span className="prop-label">{label}</span>
        <button className="pal-auto" onClick={onChange}>{actionLabel}</button>
        <button className="pal-auto" disabled={!hasOverride} onClick={onAuto} title="恢复按 role 自动选">Auto</button>
      </div>
      <div className="pal-current">
        {current ? <PaletteSwatch pack={pack} palette={current} px={36} /> : <div className="pal-placeholder">Auto</div>}
        <span className="pal-current-text" title={paletteSummary(current)}>{paletteSummary(current)}</span>
      </div>
    </div>
  );
}

function DecorationEditor({
  o,
  pack,
  index,
  current,
  currentHash,
  onOpenPalettePicker,
  onSetHouseSlot,
  onRemoveHouseDecoration,
}: {
  o: LiteObject;
  pack: PackRuntime;
  index: number;
  current: Palette | null;
  currentHash: string | undefined;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
}) {
  const deco = o.house!.decorations[index];
  const label = deco.kind[0].toUpperCase() + deco.kind.slice(1);
  return (
    <div className="pal-picker">
      <div className="pal-picker-head">
        <span className="prop-label">{label} #{index + 1}</span>
        <button className="pal-auto" onClick={() => onRemoveHouseDecoration(o.id, index)}>Remove</button>
      </div>
      <div className="prop-hint">Cell ({deco.cell[0]}, {deco.cell[1]}) · drag on canvas to place</div>
      <PaletteField
        pack={pack}
        label="Palette"
        current={current}
        hasOverride={!!deco.palette}
        onChange={() => onOpenPalettePicker({
          title: `Select ${label} Palette`,
          role: decorationRole(deco.kind),
          currentHash,
          hasOverride: !!deco.palette,
          onPick: (hash) => onSetHouseSlot(o.id, index, hash),
          onAuto: () => onSetHouseSlot(o.id, index, null),
        })}
        onAuto={() => onSetHouseSlot(o.id, index, null)}
      />
    </div>
  );
}

function HouseSlots({ o, pack, bindings, paletteByHash, onOpenPalettePicker, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: {
  o: LiteObject;
  pack: PackRuntime;
  bindings: Bindings | null;
  paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
  onAddHouseDecoration: (id: number, kind: HouseDecorationKind, palette?: string) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
  onGenerateHouseDecorations: (id: number) => void;
}) {
  const h = o.house!;
  const b = bindings?.get(o.id);
  const hb = b && b.kind === "house" ? b : null;
  const maxWallH = Math.max(1, o.rect[3] - 1);
  const pick = (hash?: string) => (hash ? paletteByHash.get(hash) ?? null : null);
  return (
    <>
      <Row label="Wall H">
        <input
          className="prop-num" type="number" min={1} max={maxWallH} value={h.wallHeight}
          onChange={(e) => onSetWallHeight(o.id, Math.max(1, Math.min(maxWallH, parseInt(e.target.value, 10) || 1)))}
        />
      </Row>
      <Row label="Overlap">
        <input
          className="prop-num" type="number" min={-1} max={Math.max(0, o.rect[3] - 1)} value={h.overlap}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            const next = Number.isNaN(raw) ? 0 : raw;
            onSetHouseOverlap(o.id, Math.max(-1, Math.min(Math.max(0, o.rect[3] - 1), next)));
          }}
        />
      </Row>
      <div className="prop-hint">`-1` = auto overlap, `0` = none. Decorations drag before resize, matching desktop.</div>
      <div className="prop-checks">
        <button onClick={() => onGenerateHouseDecorations(o.id)} disabled={h.decorations.length === 0}>Generate</button>
        <button onClick={() => onAddHouseDecoration(o.id, "door")}>+ Door</button>
        <button onClick={() => onAddHouseDecoration(o.id, "window")}>+ Window</button>
        <button onClick={() => onAddHouseDecoration(o.id, "chimney")}>+ Chimney</button>
        <button onClick={() => onAddHouseDecoration(o.id, "any")}>+ Any</button>
      </div>
      <PaletteField
        pack={pack}
        label="Wall"
        current={pick(h.wall) ?? hb?.wall ?? null}
        hasOverride={!!h.wall}
        onChange={() => onOpenPalettePicker({
          title: "Select Wall Palette",
          role: "building/house_wall",
          currentHash: h.wall ?? hb?.wall?.hash,
          hasOverride: !!h.wall,
          onPick: (hash) => onSetHouseSlot(o.id, "wall", hash),
          onAuto: () => onSetHouseSlot(o.id, "wall", null),
        })}
        onAuto={() => onSetHouseSlot(o.id, "wall", null)}
      />
      <PaletteField
        pack={pack}
        label="Roof"
        current={pick(h.roof) ?? hb?.roof ?? null}
        hasOverride={!!h.roof}
        onChange={() => onOpenPalettePicker({
          title: "Select Roof Palette",
          role: "building/house_roof",
          currentHash: h.roof ?? hb?.roof?.hash,
          hasOverride: !!h.roof,
          onPick: (hash) => onSetHouseSlot(o.id, "roof", hash),
          onAuto: () => onSetHouseSlot(o.id, "roof", null),
        })}
        onAuto={() => onSetHouseSlot(o.id, "roof", null)}
      />
      {h.decorations.length === 0 ? (
        <div className="prop-empty">No decorations</div>
      ) : h.decorations.map((deco, index) => (
        <DecorationEditor
          key={`${deco.kind}-${index}`}
          o={o}
          pack={pack}
          index={index}
          current={pick(deco.palette) ?? hb?.deco[index] ?? null}
          currentHash={deco.palette ?? hb?.deco[index]?.hash}
          onOpenPalettePicker={onOpenPalettePicker}
          onSetHouseSlot={onSetHouseSlot}
          onRemoveHouseDecoration={onRemoveHouseDecoration}
        />
      ))}
    </>
  );
}

function FrgCellRow({ pack, index, palette, paletteHash, weight, onWeight, onRemove }: {
  pack: PackRuntime;
  index: number;
  palette: Palette | null;
  paletteHash: string;
  weight: number;
  onWeight: (weight: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(String(weight));

  useEffect(() => {
    setDraft(String(weight));
  }, [weight]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    onWeight(Number.isFinite(parsed) ? parsed : weight);
  };

  return (
    <div className="frg-cell-row">
      <div className="frg-cell-current">
        {palette ? <PaletteSwatch pack={pack} palette={palette} px={36} /> : <div className="pal-placeholder">?</div>}
        <span className="frg-cell-text" title={palette ? paletteSummary(palette) : paletteHash}>
          {palette ? (palette.style || palette.role.split("/").pop() || palette.role) : paletteHash}
        </span>
      </div>
      <input
        className="prop-num frg-weight"
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        title={`Weight for cell #${index + 1}`}
      />
      <button className="pal-auto" onClick={onRemove}>Del</button>
    </div>
  );
}

function FrgNoiseEditor({ o, onApplyFrgNoise, onOpenNoiseEditor }: {
  o: LiteObject;
  onApplyFrgNoise: (id: number, config: TerrainNoiseConfig) => void;
  onOpenNoiseEditor: (request: NoiseEditorRequest) => void;
}) {
  const [draft, setDraft] = useState<TerrainNoiseConfig>(() => frgNoiseConfigFromObject(o));

  useEffect(() => {
    setDraft(frgNoiseConfigFromObject(o));
  }, [o.id, o.tags]);

  return (
    <Row label="Noise">
      <span className="seg">
        <button onClick={() => onApplyFrgNoise(o.id, draft)}>Re-Apply</button>
        <button onClick={() => {
          const next = randomizeNoiseSeed(draft);
          setDraft(next);
          onApplyFrgNoise(o.id, next);
        }}>Rand</button>
        <button onClick={() => onOpenNoiseEditor({
          title: "FRG Noise",
          value: draft,
          onApply: (next) => {
            setDraft(next);
            onApplyFrgNoise(o.id, next);
          },
        })}>Edit</button>
      </span>
    </Row>
  );
}

function FrgCellsEditor({ o, pack, bindings, paletteByHash, onOpenPalettePicker, onAddFrgCell, onRemoveFrgCell, onSetFrgCellWeight, onSetFrgPlacementMode, onApplyFrgNoise, onOpenNoiseEditor }: {
  o: LiteObject;
  pack: PackRuntime;
  bindings: Bindings | null;
  paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
  onAddFrgCell: (id: number, paletteHash: string) => void;
  onRemoveFrgCell: (id: number, index: number) => void;
  onSetFrgCellWeight: (id: number, index: number, weight: number) => void;
  onSetFrgPlacementMode: (id: number, placementMode: FrgPlacementMode) => void;
  onApplyFrgNoise: (id: number, config: TerrainNoiseConfig) => void;
  onOpenNoiseEditor: (request: NoiseEditorRequest) => void;
}) {
  const binding = bindings?.get(o.id);
  const placementMode = o.frg?.placementMode ?? DEFAULT_FRG_PLACEMENT_MODE;
  const cells = useMemo(() => {
    if (o.frg) {
      return o.frg.cells.map((cell) => ({
        paletteHash: cell.palette,
        weight: cell.weight,
        palette: paletteByHash.get(cell.palette) ?? null,
      }));
    }
    if (binding?.kind === "frg") {
      return binding.variants.map((palette) => ({
        paletteHash: palette.hash,
        weight: 100,
        palette,
      }));
    }
    const override = o.tags["web.palette"];
    return override ? [{
      paletteHash: override,
      weight: 100,
      palette: paletteByHash.get(override) ?? null,
    }] : [];
  }, [o.frg, o.tags, binding, paletteByHash]);

  return (
    <div className="pal-picker">
      <Row label="Placement">
        <select
          className="frg-mode-select"
          value={placementMode}
          onChange={(e) => onSetFrgPlacementMode(o.id, e.target.value as FrgPlacementMode)}
        >
          {FRG_PLACEMENT_MODES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Row>
      <FrgNoiseEditor o={o} onApplyFrgNoise={onApplyFrgNoise} onOpenNoiseEditor={onOpenNoiseEditor} />
      <div className="pal-picker-head">
        <span className="prop-label">FRG Cells</span>
        <button
          className="pal-auto"
          onClick={() => onOpenPalettePicker({
            title: "Add FRG Cell",
            role: roleOf(o) || null,
            allowedModes: [PaletteMode.FIXED_RECT, PaletteMode.NINE_PATCH],
            hasOverride: false,
            onPick: (hash) => onAddFrgCell(o.id, hash),
            onAuto: () => {},
          })}
        >
          Add...
        </button>
      </div>
      {cells.length === 0 ? (
        <div className="prop-empty">No FRG cells</div>
      ) : (
        <div className="frg-cell-list">
          {cells.map((cell, index) => (
            <FrgCellRow
              key={`${cell.paletteHash}-${index}`}
              pack={pack}
              index={index}
              palette={cell.palette}
              paletteHash={cell.paletteHash}
              weight={cell.weight}
              onWeight={(next) => onSetFrgCellWeight(o.id, index, next)}
              onRemove={() => onRemoveFrgCell(o.id, index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectBody({ o, mapSize, pack, bindings, paletteByHash, onOpenPalettePicker, onOpenNoiseEditor, onSetVisible, onToggleLock, onSetRectToMap, onSetRectToAabb, onRandomizeTerrain, onPreviewTerrainNoise, onCommitTerrainNoisePreview, onCancelTerrainNoisePreview, onSetTerrainBorderAsConnected, onRunMorph, onInitBitwise, onRunBitwiseQuickOp, onOpenBitwise, onRename, onSetObjectType, onSetPalette, onAddFrgCell, onRemoveFrgCell, onSetFrgCellWeight, onSetFrgPlacementMode, onApplyFrgNoise, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: {
  o: LiteObject;
  mapSize: [number, number];
  pack: PackRuntime | null;
  bindings: Bindings | null;
  paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
  onOpenNoiseEditor: (request: NoiseEditorRequest) => void;
  onSetVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onSetRectToMap: (id: number) => void;
  onSetRectToAabb: (id: number) => void;
  onRandomizeTerrain: (id: number, config: TerrainNoiseConfig) => void;
  onPreviewTerrainNoise: (id: number, config: TerrainNoiseConfig) => void;
  onCommitTerrainNoisePreview: (id: number, config: TerrainNoiseConfig) => void;
  onCancelTerrainNoisePreview: () => void;
  onSetTerrainBorderAsConnected: (id: number, enabled: boolean) => void;
  onRunMorph: (id: number, mode: "dilate" | "erode" | "erode_dilate" | "dilate_erode", dilate: TerrainNoiseConfig, erode: TerrainNoiseConfig) => void;
  onInitBitwise: (id: number, filled: boolean) => void;
  onRunBitwiseQuickOp: (id: number, op: "keep_border" | "flip" | "remove_zero") => void;
  onOpenBitwise: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onSetObjectType: (id: number, type: LiteType) => void;
  onSetPalette: (id: number, hash: string | null) => void;
  onAddFrgCell: (id: number, paletteHash: string) => void;
  onRemoveFrgCell: (id: number, index: number) => void;
  onSetFrgCellWeight: (id: number, index: number, weight: number) => void;
  onSetFrgPlacementMode: (id: number, placementMode: FrgPlacementMode) => void;
  onApplyFrgNoise: (id: number, config: TerrainNoiseConfig) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
  onAddHouseDecoration: (id: number, kind: HouseDecorationKind, palette?: string) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
  onGenerateHouseDecorations: (id: number) => void;
}) {
  const shown = displayName(o);
  const rgb = colorForRole(roleOf(o));
  const merged = Number(o.tags["web.merged"] ?? "1");
  const style = o.tags["blueprint.style"];
  const label = o.tags["blueprint.label"];
  const canAlign = o.type !== "DUNGEON";
  const fillsMap = o.rect[0] === 0 && o.rect[1] === 0 && o.rect[2] === mapSize[0] && o.rect[3] === mapSize[1];

  const commit = (v: string) => { const t = v.trim(); if (t !== shown) onRename(o.id, t); };

  // effective bound palette: manual override wins, else the compiled binding
  const b = bindings?.get(o.id);
  const boundHash = !b ? undefined
    : b.kind === "frg" ? b.variants[0]?.hash
    : b.kind === "house" ? b.wall?.hash
    : b.palette.hash;
  const currentHash = o.tags["web.palette"] ?? boundHash;
  const currentPalette = (o.tags["web.palette"] ? paletteByHash.get(o.tags["web.palette"]) : undefined)
    ?? (boundHash ? paletteByHash.get(boundHash) : undefined)
    ?? null;

  return (
    <>
      <div className="prop-titlerow">
        <span className="prop-swatch" style={{ background: rgbaCss(rgb, 1) }} />
        <input
          className="prop-name"
          defaultValue={shown}
          title="改名（回车确认）"
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      </div>
      <Row label="Type">{TYPE_LABEL[o.type] ?? o.type}</Row>
      <Row label="Role">{roleOf(o) || "—"}</Row>
      <Row label="Origin">({o.rect[0]}, {o.rect[1]})</Row>
      <Row label="Size">{o.rect[2]} × {o.rect[3]}</Row>
      {canAlign && (
        <Row label="Alignment">
          <span className="seg">
            <button disabled={fillsMap} onClick={() => onSetRectToMap(o.id)}>Set to Map</button>
            <button onClick={() => onSetRectToAabb(o.id)}>Set to AABB</button>
          </span>
        </Row>
      )}
      {(o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE") && (
        <>
          <Row label="Border As Connected">
            <label className="prop-check">
              <input
                type="checkbox"
                checked={o.tags["borderAsConnected"] === "true"}
                onChange={(e) => onSetTerrainBorderAsConnected(o.id, e.target.checked)}
              />
            </label>
          </Row>
          <TerrainNoiseEditor
            o={o}
            onRandomizeTerrain={onRandomizeTerrain}
            onPreviewTerrainNoise={onPreviewTerrainNoise}
            onCommitTerrainNoisePreview={onCommitTerrainNoisePreview}
            onCancelTerrainNoisePreview={onCancelTerrainNoisePreview}
            onOpenNoiseEditor={onOpenNoiseEditor}
          />
        </>
      )}
      {isBitwiseSupported(o) && (
        <MorphNoiseEditor o={o} onRunMorph={onRunMorph} onOpenNoiseEditor={onOpenNoiseEditor} />
      )}
      {isBitwiseSupported(o) && (
        <>
          <Row label="Bitwise">
            <button onClick={() => onOpenBitwise(o.id)}>Bitwise...</button>
          </Row>
          <Row label="Tools">
            <span className="seg">
              <button onClick={() => onRunBitwiseQuickOp(o.id, "keep_border")}>Keep Border</button>
              <button onClick={() => onRunBitwiseQuickOp(o.id, "flip")}>Flip</button>
              <button onClick={() => onRunBitwiseQuickOp(o.id, "remove_zero")}>Remove Zero</button>
            </span>
          </Row>
          <Row label="Init">
            <span className="seg">
              <button onClick={() => onInitBitwise(o.id, true)}>Full</button>
              <button onClick={() => onInitBitwise(o.id, false)}>Empty</button>
            </span>
          </Row>
        </>
      )}
      {merged > 1 && <Row label="Merged">{merged} 个合并</Row>}
      {style && <Row label="Style">{style}</Row>}
      {label && <Row label="Label">{label}</Row>}

      {/* convert terrain type (fix 2-edge/2-corner mislabels) */}
      {o.terrain && (
        <Row label="Terrain">
          <span className="seg">
            {TERRAIN_TYPES.map(([t, lbl]) => (
              <button key={t} className={o.type === t ? "active" : ""} onClick={() => onSetObjectType(o.id, t)}>{lbl}</button>
            ))}
          </span>
        </Row>
      )}

      {/* palette: house slots, or single-object override */}
      {pack && (o.type === "HOUSE" && o.house
        ? <HouseSlots
            o={o}
            pack={pack}
            bindings={bindings}
            paletteByHash={paletteByHash}
            onOpenPalettePicker={onOpenPalettePicker}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
        : o.type === "FIXED_RECT_GROUP"
          ? <FrgCellsEditor
              o={o}
              pack={pack}
              bindings={bindings}
              paletteByHash={paletteByHash}
              onOpenPalettePicker={onOpenPalettePicker}
              onAddFrgCell={onAddFrgCell}
              onRemoveFrgCell={onRemoveFrgCell}
              onSetFrgCellWeight={onSetFrgCellWeight}
              onSetFrgPlacementMode={onSetFrgPlacementMode}
              onApplyFrgNoise={onApplyFrgNoise}
              onOpenNoiseEditor={onOpenNoiseEditor}
            />
        : <PaletteField
            pack={pack}
            label="Palette"
            current={currentPalette}
            hasOverride={!!o.tags["web.palette"]}
            onChange={() => onOpenPalettePicker({
              title: "Select Palette",
              role: roleOf(o),
              currentHash,
              hasOverride: !!o.tags["web.palette"],
              onPick: (h) => onSetPalette(o.id, h),
              onAuto: () => onSetPalette(o.id, null),
            })}
            onAuto={() => onSetPalette(o.id, null)}
          />
      )}

      <div className="prop-checks">
        <label className="prop-check">
          <input type="checkbox" checked={o.enabled} onChange={() => onSetVisible(!o.enabled)} /> Visible
        </label>
        <label className="prop-check">
          <input type="checkbox" checked={isLocked(o)} onChange={onToggleLock} /> Lock
        </label>
      </div>
    </>
  );
}

export function PropsPanel({ layer, mapSize, objects, pack, bindings, onToggleLayerVisible, onSetObjectsVisible, onToggleLock, onSetRectToMap, onSetRectToAabb, onRandomizeTerrain, onPreviewTerrainNoise, onCommitTerrainNoisePreview, onCancelTerrainNoisePreview, onSetTerrainBorderAsConnected, onRunMorph, onInitBitwise, onRunBitwiseQuickOp, onOpenBitwise, onRename, onSetObjectType, onSetPalette, onAddFrgCell, onRemoveFrgCell, onSetFrgCellWeight, onSetFrgPlacementMode, onApplyFrgNoise, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: PropsPanelProps) {
  const primary = objects[0] ?? null;
  const allVisible = objects.length > 0 && objects.every((o) => o.enabled);
  const paletteByHash = useMemo(() => new Map((pack?.palettes ?? []).map((p) => [p.hash, p])), [pack]);
  const [picker, setPicker] = useState<PaletteAssignRequest | null>(null);
  const [noiseEditor, setNoiseEditor] = useState<NoiseEditorRequest | null>(null);

  const onClosePicker = useCallback(() => setPicker(null), []);
  const onOpenPalettePicker = useCallback((request: PaletteAssignRequest) => {
    setPicker({
      ...request,
      onPick: (hash) => { request.onPick(hash); setPicker(null); },
      onAuto: () => { request.onAuto(); setPicker(null); },
    });
  }, []);
  const onCloseNoiseEditor = useCallback(() => setNoiseEditor(null), []);
  const onOpenNoiseEditor = useCallback((request: NoiseEditorRequest) => setNoiseEditor(request), []);

  return (
    <aside className="props">
      <section className="prop-section">
        <div className="prop-head">Layer</div>
        {!layer ? (
          <div className="prop-empty">未选中图层</div>
        ) : (
          <>
            <div className="prop-titlerow"><span className="prop-name static">{layer.name}</span></div>
            {layer.tags["role.root"] && <Row label="Role"><span className="prop-badge">{layer.tags["role.root"]}</span></Row>}
            {layer.tags["role.object_type"] && <Row label="Family"><span className="prop-badge">{layer.tags["role.object_type"]}</span></Row>}
            <Row label="Objects">{layer.objects.length}</Row>
            <Row label="Y-sort">{layer.vertical ? "开 · 按 Y" : "关 · 地面"}</Row>
            <div className="prop-checks">
              <label className="prop-check">
                <input type="checkbox" checked={layer.enabled} onChange={onToggleLayerVisible} /> Visible
              </label>
            </div>
          </>
        )}
      </section>

      <div className="prop-divider" />

      <section className="prop-section">
        <div className="prop-head">Object</div>
        {objects.length === 0 ? (
          <div className="prop-empty">未选中对象</div>
        ) : objects.length > 1 ? (
          <>
            <div className="prop-titlerow"><span className="prop-name static">{objects.length} 个对象</span></div>
            <div className="prop-checks">
              <label className="prop-check">
                <input type="checkbox" checked={allVisible} onChange={() => onSetObjectsVisible(!allVisible)} /> Visible
              </label>
              <label className="prop-check">
                <input type="checkbox" checked={objects.every((o) => isLocked(o))} onChange={onToggleLock} /> Lock
              </label>
            </div>
          </>
        ) : primary ? (
          <ObjectBody
            key={primary.id}
            o={primary}
            mapSize={mapSize}
            pack={pack}
            bindings={bindings}
            paletteByHash={paletteByHash}
            onOpenPalettePicker={onOpenPalettePicker}
            onOpenNoiseEditor={onOpenNoiseEditor}
            onSetVisible={onSetObjectsVisible}
            onToggleLock={onToggleLock}
            onSetRectToMap={onSetRectToMap}
            onSetRectToAabb={onSetRectToAabb}
            onRandomizeTerrain={onRandomizeTerrain}
            onPreviewTerrainNoise={onPreviewTerrainNoise}
            onCommitTerrainNoisePreview={onCommitTerrainNoisePreview}
            onCancelTerrainNoisePreview={onCancelTerrainNoisePreview}
            onSetTerrainBorderAsConnected={onSetTerrainBorderAsConnected}
            onRunMorph={onRunMorph}
            onInitBitwise={onInitBitwise}
            onRunBitwiseQuickOp={onRunBitwiseQuickOp}
            onOpenBitwise={onOpenBitwise}
            onRename={onRename}
            onSetObjectType={onSetObjectType}
            onSetPalette={onSetPalette}
            onAddFrgCell={onAddFrgCell}
            onRemoveFrgCell={onRemoveFrgCell}
            onSetFrgCellWeight={onSetFrgCellWeight}
            onSetFrgPlacementMode={onSetFrgPlacementMode}
            onApplyFrgNoise={onApplyFrgNoise}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
        ) : null}
      </section>
      <PalettePickerModal pack={pack} request={picker} onClose={onClosePicker} />
      <NoiseEditorModal request={noiseEditor} onClose={onCloseNoiseEditor} />
    </aside>
  );
}
