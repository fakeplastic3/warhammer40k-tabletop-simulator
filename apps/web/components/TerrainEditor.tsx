"use client";
import { useState } from "react";
import type { Terrain } from "@tabletop/shared";
export default function TerrainEditor({
  terrain,
  busy,
  onApply,
}: {
  terrain: Terrain[];
  busy: boolean;
  onApply: (t: Terrain) => void;
}) {
  const [draft, setDraft] = useState<Terrain>(terrain[0]);
  return (
    <fieldset>
      <legend>Battlefield terrain · before battle</legend>
      <label>
        Feature
        <select
          value={terrain.some((t) => t.id === draft.id) ? draft.id : "new"}
          onChange={(e) =>
            setDraft(
              terrain.find((t) => t.id === e.target.value) ?? {
                id: crypto.randomUUID(),
                name: "New terrain",
                category: "light",
                solid: false,
                x: 10,
                y: 12,
                width: 4,
                height: 4,
              },
            )
          }
        >
          {terrain.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="new">Add feature</option>
        </select>
      </label>
      <label>
        Feature name
        <input
          value={draft.name}
          maxLength={40}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        Terrain category
        <select
          value={draft.category}
          onChange={(e) =>
            setDraft({
              ...draft,
              category: e.target.value as Terrain["category"],
            })
          }
        >
          <option value="exposed">Exposed</option>
          <option value="light">Light</option>
          <option value="dense">Dense</option>
        </select>
      </label>
      <div className="terrain-dimensions">
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()} (inches)
            <input
              type="number"
              min={key === "width" || key === "height" ? 0.1 : 0}
              step="0.1"
              value={draft[key]}
              onChange={(e) =>
                setDraft({ ...draft, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.solid}
          onChange={(e) => setDraft({ ...draft, solid: e.target.checked })}
        />
        Solid footprint blocks movement and sight
      </label>
      <button
        disabled={busy || !draft.name.trim()}
        onClick={() => onApply(draft)}
      >
        APPLY TERRAIN
      </button>
    </fieldset>
  );
}
