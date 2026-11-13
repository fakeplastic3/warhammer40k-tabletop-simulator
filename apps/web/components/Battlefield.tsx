"use client";
import { useEffect, useRef, useState } from "react";
import type { GameState, Point } from "@tabletop/shared";
import { Application, Container, Graphics, Text } from "pixi.js";
export type Paths = { modelId: string; points: Point[] }[];
export default function Battlefield({
  state,
  selected,
  modelId,
  paths,
  onSelect,
  onPlace,
  grid,
  measure,
}: {
  state: GameState;
  selected: string;
  modelId: string;
  paths: Paths;
  onSelect: (u: string, m: string) => void;
  onPlace: (p: Point) => void;
  grid: boolean;
  measure: boolean;
}) {
  // Phase/log/CP updates do not change this static tabletop. Avoid rebuilding
  // graphics/text and submitting continuous GPU frames for those updates.
  const renderKey = JSON.stringify({
    width: state.width,
    height: state.height,
    lobby: state.status === "lobby",
    units: state.units.map((u) => ({
      id: u.id,
      name: u.name,
      owner: u.owner,
      move: u.move,
      shocked: u.shocked,
      reserve: u.reserve,
      models: u.models,
    })),
    terrain: state.terrain,
    objectives: state.objectives,
    selected,
    modelId,
    paths,
    grid,
    measure,
  });
  const host = useRef<HTMLDivElement>(null);
  const current = useRef({
    renderKey,
    state,
    selected,
    modelId,
    paths,
    onSelect,
    onPlace,
    grid,
    measure,
  });
  current.current = {
    renderKey,
    state,
    selected,
    modelId,
    paths,
    onSelect,
    onPlace,
    grid,
    measure,
  };
  const [ruler, setRuler] = useState("");
  useEffect(() => {
    let disposed = false;
    let frame: number | undefined;
    const app = new Application();
    let resize: ResizeObserver | undefined;
    let cleanup: (() => void) | undefined;
    (async () => {
      await app.init({
        background: 0x151e22,
        antialias: true,
        autoStart: false,
        sharedTicker: false,
        resizeTo: host.current!,
        resolution: Math.min(devicePixelRatio, 2),
        autoDensity: true,
        preference: "webgl",
      });
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      const el = host.current!;
      el.appendChild(app.canvas);
      const world = new Container();
      app.stage.addChild(world);
      let zoom = 1,
        pan = { x: 0, y: 0 };
      let drag:
        { x: number; y: number; pan: Point; button: number } | undefined;
      let moved = false;
      let rulerStart: Point | undefined;
      function fit() {
        const { state: s } = current.current;
        const base = Math.min(
          (el.clientWidth - 36) / s.width,
          (el.clientHeight - 36) / s.height,
        );
        world.scale.set(base * zoom);
        world.position.set(
          (el.clientWidth - s.width * base * zoom) / 2 + pan.x,
          (el.clientHeight - s.height * base * zoom) / 2 + pan.y,
        );
      }
      const local = (e: PointerEvent | WheelEvent) => {
        const r = app.canvas.getBoundingClientRect();
        return {
          x: (e.clientX - r.left - world.x) / world.scale.x,
          y: (e.clientY - r.top - world.y) / world.scale.y,
        };
      };
      function draw() {
        if (disposed) return;
        fit();
        world.removeChildren().forEach((c) => c.destroy({ children: true }));
        const { state: s, selected, modelId, paths, grid } = current.current;
        const g = new Graphics();
        world.addChild(g);
        g.rect(0, 0, s.width, s.height)
          .fill(0x202c30)
          .stroke({ color: 0x67767a, width: 0.06 });
        if (s.status === "lobby") {
          g.rect(0, 0, 6, s.height).fill({ color: 0x4fa8ac, alpha: 0.12 });
          g.rect(s.width - 6, 0, 6, s.height).fill({
            color: 0xd4a16a,
            alpha: 0.12,
          });
        }
        if (grid)
          for (let x = 0; x <= s.width; x++) {
            g.moveTo(x, 0)
              .lineTo(x, s.height)
              .stroke({
                color: 0xa2b8bc,
                alpha: x % 6 === 0 ? 0.13 : 0.05,
                width: 0.025,
              });
          }
        if (grid)
          for (let y = 0; y <= s.height; y++) {
            g.moveTo(0, y)
              .lineTo(s.width, y)
              .stroke({
                color: 0xa2b8bc,
                alpha: y % 6 === 0 ? 0.13 : 0.05,
                width: 0.025,
              });
          }
        for (const t of s.terrain) {
          g.rect(t.x, t.y, t.width, t.height)
            .fill({
              color: t.solid
                ? 0x394348
                : t.category === "dense"
                  ? 0x3d4944
                  : 0x494739,
              alpha: 0.85,
            })
            .stroke({
              color: t.solid ? 0x91a1a7 : 0x8f9572,
              width: 0.06,
              alpha: 0.6,
            });
          if (t.solid) {
            for (let k = 0; k < t.height; k += 0.6)
              g.moveTo(t.x, t.y + k)
                .lineTo(t.x + t.width, t.y + k)
                .stroke({ color: 0x8a979e, width: 0.04, alpha: 0.3 });
          }
          const text = new Text({
            text: t.name.toUpperCase(),
            style: { fontFamily: "monospace", fontSize: 0.38, fill: 0xa8b3b2 },
          });
          text.position.set(t.x + 0.2, t.y + 0.2);
          world.addChild(text);
        }
        for (const o of s.objectives) {
          const c =
            o.owner === 0 ? 0x71cbd0 : o.owner === 1 ? 0xe7b784 : 0xe8d7a5;
          g.circle(o.x, o.y, o.radius + 3).stroke({
            color: c,
            width: 0.035,
            alpha: 0.24,
          });
          g.circle(o.x, o.y, o.radius)
            .fill({ color: c, alpha: 0.18 })
            .stroke({ color: c, width: 0.07 });
          g.moveTo(o.x - 0.35, o.y)
            .lineTo(o.x + 0.35, o.y)
            .moveTo(o.x, o.y - 0.35)
            .lineTo(o.x, o.y + 0.35)
            .stroke({ color: c, width: 0.07 });
          const text = new Text({
            text: o.id.toUpperCase(),
            style: { fontFamily: "monospace", fontSize: 0.45, fill: c },
          });
          text.position.set(o.x - 0.3, o.y + 1);
          world.addChild(text);
        }
        for (const u of s.units.filter((u) => !u.reserve)) {
          const color = u.owner === 0 ? 0x77cbd1 : 0xe5ad77;
          for (const m of u.models.filter((m) => m.wounds > 0)) {
            if (u.id === selected)
              g.circle(m.x, m.y, m.radius + u.move).stroke({
                color,
                alpha: 0.05,
                width: 0.025,
              });
            g.circle(m.x, m.y, m.radius + 0.09)
              .fill(0x0c1419)
              .stroke({ color, width: 0.065 });
            if (m.id === modelId)
              g.circle(m.x, m.y, m.radius + 0.22).stroke({
                color: 0xf8e8be,
                width: 0.06,
              });
            // Original top-down mechanical infantry: pauldrons, split helmet, carbine.
            g.roundRect(m.x - 0.43, m.y - 0.28, 0.86, 0.4, 0.08).fill(color);
            g.circle(m.x, m.y - 0.08, 0.23)
              .fill(0x172229)
              .stroke({ color, width: 0.05 });
            g.rect(m.x - 0.14, m.y - 0.13, 0.28, 0.06).fill(0xf9df8c);
            g.roundRect(m.x + 0.13, m.y + 0.13, 0.38, 0.12, 0.03).fill(
              0xb1b7ad,
            );
            g.moveTo(m.x - 0.21, m.y + 0.24)
              .lineTo(m.x - 0.25, m.y + 0.43)
              .moveTo(m.x + 0.1, m.y + 0.25)
              .lineTo(m.x + 0.13, m.y + 0.43)
              .stroke({ color, width: 0.14 });
            for (let w = 0; w < m.wounds; w++)
              g.circle(m.x - 0.2 + w * 0.18, m.y + 0.72, 0.055).fill(color);
          }
          const m = u.models.find((m) => m.wounds > 0);
          if (m) {
            const t = new Text({
              text: u.name.toUpperCase() + (u.shocked ? " [SHOCK]" : ""),
              style: { fontFamily: "monospace", fontSize: 0.4, fill: color },
            });
            t.position.set(m.x - 1, m.y - 1.25);
            world.addChild(t);
          }
        }
        for (const p of paths) {
          const m = s.units
            .flatMap((u) => u.models)
            .find((m) => m.id === p.modelId);
          if (!m) continue;
          g.moveTo(m.x, m.y);
          for (const pt of p.points) g.lineTo(pt.x, pt.y);
          g.stroke({ color: 0xf4d38d, width: 0.08, alpha: 0.8 });
          const end = p.points.at(-1)!;
          g.circle(end.x, end.y, m.radius)
            .fill({ color: 0xf4d38d, alpha: 0.18 })
            .stroke({ color: 0xf4d38d, width: 0.045 });
        }
        if (rulerStart)
          g.circle(rulerStart.x, rulerStart.y, 0.1).fill(0xffffff);
        app.render();
      }
      const down = (e: PointerEvent) => {
        drag = {
          x: e.clientX,
          y: e.clientY,
          pan: { ...pan },
          button: e.button,
        };
        moved = false;
        app.canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!drag) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5)
          moved = true;
        if (moved) {
          pan = {
            x: drag.pan.x + e.clientX - drag.x,
            y: drag.pan.y + e.clientY - drag.y,
          };
          draw();
        }
      };
      const up = (e: PointerEvent) => {
        if (!drag) return;
        drag = undefined;
        if (moved) return;
        const p = local(e);
        const c = current.current;
        if (c.measure) {
          if (!rulerStart) {
            rulerStart = p;
            setRuler("Select the second point");
          } else {
            setRuler(
              `${Math.hypot(p.x - rulerStart.x, p.y - rulerStart.y).toFixed(2)}″ centre-to-centre`,
            );
            rulerStart = undefined;
          }
          draw();
          return;
        }
        for (const u of c.state.units.filter((u) => !u.reserve))
          for (const m of u.models)
            if (
              m.wounds > 0 &&
              Math.hypot(p.x - m.x, p.y - m.y) <= m.radius + 0.2
            ) {
              c.onSelect(u.id, m.id);
              return;
            }
        c.onPlace({
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
        });
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        zoom = Math.min(3, Math.max(0.6, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        draw();
      };
      const menu = (e: Event) => e.preventDefault();
      app.canvas.addEventListener("pointerdown", down);
      app.canvas.addEventListener("pointermove", move);
      app.canvas.addEventListener("pointerup", up);
      app.canvas.addEventListener("wheel", wheel, { passive: false });
      app.canvas.addEventListener("contextmenu", menu);
      cleanup = () => {
        app.canvas.removeEventListener("pointerdown", down);
        app.canvas.removeEventListener("pointermove", move);
        app.canvas.removeEventListener("pointerup", up);
        app.canvas.removeEventListener("wheel", wheel);
        app.canvas.removeEventListener("contextmenu", menu);
      };
      resize = new ResizeObserver(draw);
      resize.observe(el);
      let last = current.current.renderKey;
      const refresh = () => {
        if (disposed) return;
        if (last !== current.current.renderKey) {
          last = current.current.renderKey;
          draw();
        }
        frame = requestAnimationFrame(refresh);
      };
      frame = requestAnimationFrame(refresh);
      draw();
    })().catch((e) => {
      if (host.current)
        host.current.textContent = `Battlefield renderer failed: ${e.message}. Use the accessible unit controls.`;
    });
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize?.disconnect();
      cleanup?.();
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, []);
  return (
    <div className="battlefield-wrap">
      <div
        ref={host}
        className="battlefield"
        aria-label="Interactive battlefield: select models, click to preview movement, drag to pan, scroll to zoom"
      />
      <div className="board-caption">
        44 × 30″ / GROUND LEVEL{" "}
        <span>
          {measure
            ? ruler || "Select two points to measure"
            : "CLICK TO SELECT · DRAG TO PAN · SCROLL TO ZOOM"}
        </span>
      </div>
    </div>
  );
}
