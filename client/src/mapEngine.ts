// Map engine — MapLibre GL JS (vector tiles, WebGL) behind the small
// Leaflet-shaped surface the app already speaks (see globals.d.ts).
//
// Why: the driver map used to be Leaflet + pre-drawn raster picture
// tiles — flat, 2D only, labels baked into the pictures, and heading-up
// needed a rotating-wrapper workaround around the renderer. MapLibre
// draws OpenStreetMap VECTOR data live on the GPU: zoom is continuous,
// labels stay sharp and turn with the map, bearing and pitch are native
// camera controls, and buildings extrude in 3D where the data carries
// heights. The tile source is OpenFreeMap (free, no API key, OSM data):
//   streets style: https://tiles.openfreemap.org/styles/liberty
//     (TRUE COLOR — the cartography ships as-is: blue water, natural
//     green land, white/yellow roads. Driver order 2026-10-27: "use
//     map true color — that's too much green n neon green." The old
//     runtime repaint that washed the whole map green-black is gone;
//     the app draws its route on top in navigation blue.)
//   satellite: Esri World Imagery raster (same source as before),
//     with Esri reference overlays for Hybrid labels.
// Everything the app draws — route lines, hazard/fuel/intel markers,
// the truck marker, the fleet dots — ports onto this adapter unchanged:
// polylines become GeoJSON line layers, divIcon markers become DOM
// markers (which MapLibre keeps screen-upright at any bearing/pitch),
// and tooltips become popups.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapPopupTextStyle } from "./mapPopup";

export const STREETS_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Night Streets style (GPS day/night mode, 2026-10-31): CARTO's
 *  dark-matter GL basemap — the same OpenStreetMap data drawn for
 *  night driving: near-black ground, muted blue-gray roads that stay
 *  readable, soft light labels. Verified live at build time (HTTP
 *  200, valid GL style JSON, 28 symbol label layers so the Labels
 *  switch keeps working). OpenFreeMap's own "dark" style was checked
 *  and rejected: its motorway fill paints near-black on black. */
export const NIGHT_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_REF_TRANSPORT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";
const ESRI_REF_PLACES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
/** Offline base style tiles (gap update 2026-11-05): the SAME tile
 *  template the offline route download warms into the browser cache
 *  (App.tsx downloadOfflineRoute fetches tile.openstreetmap.org
 *  {z}/{x}/{y}.png, zooms 9–13 along the corridor). Before this, the
 *  warmed tiles were never requested by the vector map engine, so a
 *  "saved" offline route still lost its basemap in a dead zone. The
 *  offline base style below renders exactly those tiles, so what was
 *  downloaded is what the map draws with no signal. */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

type LatLngArr = [number, number];
type DivIconOpts = {
  html?: string;
  className?: string;
  iconSize?: [number, number];
  iconAnchor?: [number, number];
};

let uid = 0;
const nextId = (p: string) => `sm-${p}-${++uid}`;

/** Pixel distance from a point to a segment — the hit-test math for
 *  tappable route lines. A finger never lands exactly on a 4px line,
 *  so a line tap is judged by distance to the line, not by the line's
 *  own painted pixels. */
function pointSegmentDistancePx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** TRUE COLOR (driver order, 2026-10-27): the Liberty cartography is
 *  the map's real colors — blue water, natural greens, white and
 *  yellow roads, dark text on light ground — and it ships UNPAINTED
 *  in both app themes. The previous build repainted every layer into
 *  deep green-black with muted green roads ("too much green n neon
 *  green" — the driver's words, with a screen recording to prove it).
 *  The only touch left is the 3D building extrusion, tinted a neutral
 *  light gray so the extrusions sit naturally on the true-color
 *  ground. Guarded like before: a style update upstream can rename a
 *  layer, never break the map — and on the night style (no building-3d
 *  layer at all) it is simply a no-op; the night basemap ships its own
 *  finished colors and is never repainted. */
function applyTrueColorTheme(ml: maplibregl.Map) {
  const set = (layerId: string, prop: string, value: unknown) => {
    try {
      if (ml.getLayer(layerId)) ml.setPaintProperty(layerId, prop, value as never);
    } catch { /* layer/property not in this style version — skip */ }
  };
  set("building-3d", "fill-extrusion-color", "#c3ccd4");
  set("building-3d", "fill-extrusion-opacity", 0.85);
}

/** Show/hide the vector label layers (symbol layers). On vector tiles
 *  the labels are their own layers, so the Labels switch works on every
 *  base style now — not just Satellite/Hybrid like the raster days. */
function applyLabelsVisibility(ml: maplibregl.Map, labels: boolean) {
  let layers: maplibregl.LayerSpecification[] = [];
  try { layers = ml.getStyle()?.layers ?? []; } catch { return; }
  for (const l of layers) {
    if (l.type !== "symbol") continue;
    try { ml.setLayoutProperty(l.id, "visibility", labels ? "visible" : "none"); } catch { /* skip */ }
  }
}

/** One registered overlay (route line or raster) the adapter re-adds
 *  after every style swap — MapLibre drops custom sources/layers on
 *  setStyle, DOM markers survive on their own. */
type OverlayDef =
  | { kind: "line"; id: string; coords: LatLngArr[]; color: string; width: number; opacity: number; dash: number[] | null }
  | { kind: "raster"; id: string; url: string; attribution?: string; onTop?: boolean; opacity?: number };

class MLMapImpl {
  ml: maplibregl.Map;
  overlays = new Map<string, OverlayDef>();
  /** Tappable lines: polylines that registered click handlers. A map
   *  tap is hit-tested against these in screen pixels (26px reach —
   *  a thumb-sized target around a line only a few px wide) and the
   *  NEAREST line within reach fires. This is how the driver picks a
   *  route by tapping its line on the map itself. */
  private lineClickTargets = new Map<string, { coords: LatLngArr[]; handlers: (() => void)[] }>();
  baseKind: "streets" | "satellite" | "hybrid" | "offline" = "streets";
  baseDark = true;
  baseNight = false;
  baseLabels = true;
  private styleEpoch = 0;

  dragging: LeafletMapHandler;
  touchZoom: LeafletMapHandler;
  scrollWheelZoom: LeafletMapHandler;
  doubleClickZoom: LeafletMapHandler;
  /** Saved Pins: right-click / long-press handlers, fired with the
   *  pressed point's coordinates (MapLibre's contextmenu covers a
   *  desktop right-click and a long-press on most touch browsers). */
  private contextHandlers: ((e: { latlng: { lat: number; lng: number } }) => void)[] = [];

  constructor(container: string | HTMLElement, opts?: Record<string, unknown>) {
    const el = typeof container === "string" ? document.getElementById(container) : container;
    if (!el) throw new Error("map container missing");
    this.ml = new maplibregl.Map({
      container: el,
      style: STREETS_STYLE_URL,
      center: [-98.5, 39.8],
      zoom: 4,
      attributionControl: opts?.attributionControl ? { compact: true } : false,
      maxZoom: 19,
      pitchWithRotate: true,
      dragRotate: false,
      touchPitch: false,
    });
    if (opts?.zoomControl) {
      this.ml.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    const handler = (get: () => { enable: () => void; disable: () => void; isEnabled: () => boolean }): LeafletMapHandler => ({
      enable: () => { try { get().enable(); } catch { /* not ready */ } },
      disable: () => { try { get().disable(); } catch { /* not ready */ } },
      enabled: () => { try { return get().isEnabled(); } catch { return false; } },
    });
    this.dragging = handler(() => this.ml.dragPan);
    this.touchZoom = handler(() => this.ml.touchZoomRotate);
    this.scrollWheelZoom = handler(() => this.ml.scrollZoom);
    this.doubleClickZoom = handler(() => this.ml.doubleClickZoom);
    this.ml.on("style.load", () => {
      applyTrueColorTheme(this.ml);
      applyLabelsVisibility(this.ml, this.baseLabels);
      // Re-add overlays above the base style (insertion order = draw
      // order, so re-adding in registration order keeps routes on top).
      for (const def of this.overlays.values()) this.addOverlayToStyle(def);
    });
    // Tappable-line hit test. MapLibre's own click fires only for a
    // true tap (its clickTolerance swallows drags/pans), so a driver
    // panning the map never "selects" a line by accident.
    this.ml.on("click", (e) => {
      if (this.lineClickTargets.size === 0) return;
      let best: { d: number; handlers: (() => void)[] } | null = null;
      for (const t of this.lineClickTargets.values()) {
        // Long-haul geometry can carry thousands of points; stride
        // the test so a tap stays cheap — a strided polyline is
        // still well inside the 26px reach at road scale.
        const stride = Math.max(1, Math.floor(t.coords.length / 600));
        for (let i = 0; i + 1 < t.coords.length; i += stride) {
          const a = t.coords[i];
          const b = t.coords[Math.min(i + stride, t.coords.length - 1)];
          if (!a || !b) continue;
          const pa = this.ml.project([a[1], a[0]]);
          const pb = this.ml.project([b[1], b[0]]);
          const d = pointSegmentDistancePx(e.point.x, e.point.y, pa.x, pa.y, pb.x, pb.y);
          if (d <= 26 && (!best || d < best.d)) best = { d, handlers: t.handlers };
        }
      }
      if (best) for (const h of best.handlers) h();
    });
    this.ml.on("contextmenu", (e) => {
      for (const h of this.contextHandlers) h({ latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng } });
    });
  }

  registerLineClick(id: string, coords: LatLngArr[], handlers: (() => void)[]) {
    this.lineClickTargets.set(id, { coords, handlers });
  }
  unregisterLineClick(id: string) {
    this.lineClickTargets.delete(id);
  }

  private addOverlayToStyle(def: OverlayDef) {
    try {
      if (def.kind === "line") {
        const data: GeoJSON.Feature<GeoJSON.LineString> = {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: def.coords.map(([lat, lon]) => [lon, lat]) },
        };
        // Partial states are real after a style swap (a diff or a
        // half-applied rebuild can strand a source without its layer
        // or vice versa), so each half is restored on its own: an
        // existing source only gets its data refreshed, a missing
        // layer is re-added even when its source survived.
        const src = this.ml.getSource(def.id) as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else this.ml.addSource(def.id, { type: "geojson", data });
        if (this.ml.getLayer(def.id)) return;
        const paint: Record<string, unknown> = {
          "line-color": def.color,
          "line-width": def.width,
          "line-opacity": def.opacity,
        };
        if (def.dash) paint["line-dasharray"] = def.dash;
        this.ml.addLayer({ id: def.id, type: "line", source: def.id, layout: { "line-cap": "round", "line-join": "round" }, paint } as unknown as maplibregl.LayerSpecification);
      } else {
        if (!this.ml.getSource(def.id)) {
          this.ml.addSource(def.id, {
            type: "raster",
            tiles: [def.url],
            tileSize: 256,
            attribution: def.attribution ?? "",
          });
        }
        if (this.ml.getLayer(def.id)) return;
        if (def.onTop) {
          // Overlay rasters (weather radar): precipitation echoes are
          // transparent where the sky is clear, so the layer rides ON
          // TOP of the base style — a base-style raster inserted above
          // the background would hide under the opaque vector roads.
          // DOM markers still sit above the canvas, and the route
          // line shows through the radar's transparent pixels.
          this.ml.addLayer({ id: def.id, type: "raster", source: def.id, paint: { "raster-opacity": def.opacity ?? 0.75 } });
          return;
        }
        // Raster bases belong under everything vector the app draws:
        // insert just above the background layer.
        const layers = this.ml.getStyle()?.layers ?? [];
        const before = layers.find((l) => l.type !== "background" && !this.overlays.has(l.id))?.id;
        this.ml.addLayer({ id: def.id, type: "raster", source: def.id, paint: { "raster-opacity": 1 } }, before);
      }
    } catch { /* style not loaded yet — style.load will re-add */ }
  }

  registerOverlay(def: OverlayDef) {
    this.overlays.set(def.id, def);
    this.addOverlayToStyle(def);
  }
  unregisterOverlay(id: string) {
    this.overlays.delete(id);
    try { if (this.ml.getLayer(id)) this.ml.removeLayer(id); } catch { /* gone */ }
    try { if (this.ml.getSource(id)) this.ml.removeSource(id); } catch { /* gone */ }
  }

  /** Native base-style switch (replaces the old raster tileLayer
   *  swaps): Streets = OpenFreeMap vector, Satellite = Esri imagery,
   *  Hybrid = imagery + Esri label overlays. */
  setBaseStyle(kind: "streets" | "satellite" | "hybrid" | "offline", o: { dark: boolean; labels: boolean; night?: boolean }) {
    const epoch = ++this.styleEpoch;
    // True color: the DAY streets style does not change with the app's
    // dark/light theme. The day/night mode is separate: on Streets,
    // night swaps the whole basemap to the dark night style (a real
    // style change), while Satellite/Hybrid are photos and ignore it.
    const night = o.night === true;
    const changed = kind !== this.baseKind || (kind === "streets" && night !== this.baseNight);
    this.baseKind = kind;
    this.baseDark = o.dark;
    this.baseNight = night;
    this.baseLabels = o.labels;
    // The unpainted canvas edge behind loading tiles matches the
    // active look, so a night swap never flashes daylight.
    try {
      this.ml.getContainer().style.background = kind === "streets" && night ? "#0e0e0e" : "";
    } catch { /* container gone — nothing to tint */ }
    if (!changed && kind === "streets") {
      // Same style: only the label toggle may have moved.
      applyLabelsVisibility(this.ml, o.labels);
      return;
    }
    if (!changed && kind !== "streets") {
      // Satellite/Hybrid with a labels change: rebuild the object style.
    }
    if (kind === "streets") {
      // diff:false is LOAD-BEARING (driver report 2026-10-27: "when
      // selecting streets, satellite or hybrid the route disappears").
      // MapLibre's setStyle defaults to diffing, and the diff is
      // computed against the SERIALIZED current style — which includes
      // every runtime-added overlay source/layer (the route lines) —
      // so the diff removes them all, and the diff path never fires
      // style.load, the one event that re-adds them. DOM markers
      // survive a switch; the route never comes back. A full rebuild
      // (diff:false) fires style.load, and the handler registered in
      // the constructor re-adds every overlay on top of the new base.
      this.ml.setStyle(night ? NIGHT_STYLE_URL : STREETS_STYLE_URL, { diff: false });
      return;
    }
    if (kind === "offline") {
      // Offline base (gap update 2026-11-05): a plain raster style
      // over the OpenStreetMap tile template — the exact tiles the
      // offline route download already warmed into the browser
      // cache, so the basemap keeps drawing with no signal. Tiles
      // outside a downloaded corridor simply stay blank (the honest
      // edge of what was saved); the route line, stops, and markers
      // are overlays and re-add on style.load like every other swap.
      // diff:false for the same load-bearing reason as Streets.
      this.ml.setStyle(
        {
          version: 8,
          sources: {
            "sm-osm": { type: "raster", tiles: [OSM_TILE_URL], tileSize: 256, attribution: "© OpenStreetMap contributors" },
          },
          layers: [
            { id: "sm-bg", type: "background", paint: { "background-color": "#eceae4" } },
            { id: "sm-osm", type: "raster", source: "sm-osm" },
          ],
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        },
        { diff: false },
      );
      return;
    }
    const sources: maplibregl.StyleSpecification["sources"] = {
      "sm-esri": { type: "raster", tiles: [ESRI_IMAGERY], tileSize: 256, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
    };
    const layers: maplibregl.LayerSpecification[] = [
      { id: "sm-bg", type: "background", paint: { "background-color": "#07090b" } },
      { id: "sm-esri", type: "raster", source: "sm-esri" },
    ];
    if (kind === "hybrid" && o.labels) {
      sources["sm-esri-transp"] = { type: "raster", tiles: [ESRI_REF_TRANSPORT], tileSize: 256 };
      sources["sm-esri-places"] = { type: "raster", tiles: [ESRI_REF_PLACES], tileSize: 256 };
      layers.push({ id: "sm-esri-transp", type: "raster", source: "sm-esri-transp" });
      layers.push({ id: "sm-esri-places", type: "raster", source: "sm-esri-places" });
    }
    void epoch;
    // diff:false for the same reason as the Streets branch above: a
    // diffed swap would strip the route overlays and never fire the
    // style.load that restores them.
    this.ml.setStyle({ version: 8, sources, layers, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf" }, { diff: false });
  }

  setBearing(deg: number) {
    try { this.ml.jumpTo({ bearing: deg }); } catch { /* not ready */ }
  }
  getBearing(): number {
    try { return this.ml.getBearing(); } catch { return 0; }
  }
  setPitch(deg: number) {
    try { this.ml.easeTo({ pitch: deg, duration: 650 }); } catch { /* not ready */ }
  }

  setView(center: LatLngArr, zoom: number): this {
    this.ml.jumpTo({ center: [center[1], center[0]], zoom });
    return this;
  }
  panTo(center: LatLngArr): this {
    this.ml.panTo([center[1], center[0]]);
    return this;
  }
  /** Reserve the top of the viewport for a docked overlay (the
   *  gantry sign board): MapLibre renders the camera center —
   *  where follow mode puts the truck puck — at the center of the
   *  PADDED viewport, so a top reserve of N px moves the puck and
   *  the road ahead down into the unobstructed area below the
   *  board. 0 restores the true center. fitBounds calls pass their
   *  own explicit padding and are unaffected. */
  setCameraPaddingTop(px: number): this {
    return this.setCameraPadding(px, 0);
  }
  /** Reserve viewport space at the top and/or bottom: MapLibre
   *  renders the camera center — where follow mode puts the truck
   *  puck — at the center of the PADDED viewport, so a top reserve
   *  moves the puck DOWN the screen (more of the road ahead in
   *  view) and a bottom reserve moves it UP (out from behind a
   *  pulled-up bottom sheet). fitBounds calls pass their own
   *  explicit padding and are unaffected. */
  setCameraPadding(topPx: number, bottomPx: number): this {
    try {
      this.ml.setPadding({ top: Math.max(0, Math.round(topPx)), bottom: Math.max(0, Math.round(bottomPx)), left: 0, right: 0 });
    } catch { /* not ready */ }
    return this;
  }
  panBy(point: [number, number], opts?: { animate?: boolean }): this {
    this.ml.panBy(point, { animate: opts?.animate ?? false });
    return this;
  }
  flyTo(center: LatLngArr, zoom: number, opts?: { duration?: number }): this {
    this.ml.flyTo({ center: [center[1], center[0]], zoom, duration: (opts?.duration ?? 1) * 1000 });
    return this;
  }
  getZoom(): number { return this.ml.getZoom(); }
  setZoom(zoom: number): this { this.ml.setZoom(zoom); return this; }
  zoomIn(): this { this.ml.zoomIn(); return this; }
  zoomOut(): this { this.ml.zoomOut(); return this; }
  getContainer(): HTMLElement { return this.ml.getContainer(); }
  on(event: string, handler: (e?: { latlng: { lat: number; lng: number } }) => void): this {
    if (event === "contextmenu") {
      this.contextHandlers.push(handler as (e: { latlng: { lat: number; lng: number } }) => void);
      return this;
    }
    // Otherwise the app only listens for dragstart (a manual grab drops follow).
    this.ml.on(event as "dragstart", handler as () => void);
    return this;
  }
  /** Screen point (pixels inside the map container) → coordinates.
   *  The app's own long-press detection uses this to turn a held
   *  finger into a dropped pin. */
  screenToLatLng(point: [number, number]): [number, number] {
    const ll = this.ml.unproject(point);
    return [ll.lat, ll.lng];
  }
  getCenter(): [number, number] {
    const c = this.ml.getCenter();
    return [c.lat, c.lng];
  }
  fitBounds(
    bounds: unknown,
    opts?: {
      padding?: [number, number];
      paddingTopLeft?: [number, number];
      paddingBottomRight?: [number, number];
    },
  ): this {
    const coords = (bounds as { __coords?: LatLngArr[] }).__coords ?? [];
    if (coords.length === 0) return this;
    const b = new maplibregl.LngLatBounds();
    for (const [lat, lon] of coords) b.extend([lon, lat]);
    const p = opts?.padding ?? [30, 30];
    // padding is [vertical, horizontal]; the asymmetric pair is
    // [x, y] per corner (Leaflet's shape). Asymmetric wins per side
    // so a caller can reserve the bottom of the screen for a sheet
    // and still frame the geometry in the visible remainder.
    const tl = opts?.paddingTopLeft;
    const br = opts?.paddingBottomRight;
    this.ml.fitBounds(b, {
      padding: {
        top: tl ? tl[1] : p[0],
        bottom: br ? br[1] : p[0],
        left: tl ? tl[0] : p[1],
        right: br ? br[0] : p[1],
      },
      duration: 0,
    });
    return this;
  }
  remove(): void { this.ml.remove(); }
  invalidateSize(): void { try { this.ml.resize(); } catch { /* gone */ } }
}

class MLMarkerImpl {
  private marker: maplibregl.Marker | null = null;
  private el: HTMLDivElement;
  private popup: maplibregl.Popup | null = null;
  private map: MLMapImpl | null = null;
  private icon: DivIconOpts | null;
  private latlng: LatLngArr;
  private listeners = new Map<string, (() => void)[]>();
  private circle: { radius: number; color: string; weight: number; fillColor: string; fillOpacity: number } | null = null;

  constructor(latlng: LatLngArr, opts?: Record<string, unknown>, circle?: MLMarkerImpl["circle"]) {
    this.latlng = latlng;
    this.circle = circle ?? null;
    this.icon = (opts?.icon as DivIconOpts | undefined) ?? null;
    this.el = document.createElement("div");
    this.renderContent();
    this.el.addEventListener("click", (ev) => {
      // A marker tap is the marker's own — it must never fall through
      // to the map's tappable-line hit test underneath it (a route
      // pin sits ON its line; the pin's own pick is the one that
      // counts).
      ev.stopPropagation();
      for (const h of this.listeners.get("click") ?? []) h();
    });
  }

  private renderContent() {
    if (this.circle) {
      const c = this.circle;
      const d = c.radius * 2;
      this.el.innerHTML = `<div style="width:${d}px;height:${d}px;border-radius:50%;background:${c.fillColor};opacity:${c.fillOpacity};border:${c.weight}px solid ${c.color};box-sizing:border-box"></div>`;
      this.el.style.width = `${d}px`;
      this.el.style.height = `${d}px`;
      return;
    }
    const icon = this.icon;
    this.el.innerHTML = icon?.html ?? "";
    if (icon?.className) this.el.className = icon.className;
    if (icon?.iconSize) {
      this.el.style.width = `${icon.iconSize[0]}px`;
      this.el.style.height = `${icon.iconSize[1]}px`;
    }
  }

  private offset(): [number, number] {
    const icon = this.icon;
    if (this.circle || !icon?.iconSize || !icon?.iconAnchor) return [0, 0];
    return [icon.iconSize[0] / 2 - icon.iconAnchor[0], icon.iconSize[1] / 2 - icon.iconAnchor[1]];
  }

  addTo(map: MLMapImpl): this {
    this.map = map;
    this.marker = new maplibregl.Marker({ element: this.el, offset: this.offset() })
      .setLngLat([this.latlng[1], this.latlng[0]])
      .addTo(map.ml);
    if (this.popup && this.map) this.wirePopup();
    return this;
  }
  remove(): void {
    this.marker?.remove();
    this.marker = null;
  }
  setLatLng(latlng: LatLngArr): this {
    this.latlng = latlng;
    this.marker?.setLngLat([latlng[1], latlng[0]]);
    return this;
  }
  setIcon(icon: unknown): this {
    this.icon = icon as DivIconOpts;
    this.renderContent();
    // MapLibre fixes the offset at construction; nudge via the element
    // transform is unreliable, so rebuild the marker in place.
    if (this.map && this.marker) {
      const popup = this.popup;
      this.marker.remove();
      this.marker = new maplibregl.Marker({ element: this.el, offset: this.offset() })
        .setLngLat([this.latlng[1], this.latlng[0]])
        .addTo(this.map.ml);
      if (popup) this.wirePopup();
    }
    return this;
  }
  bindTooltip(content: string): this {
    this.popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 16,
      className: "sm-map-popup",
    }).setHTML(`<div style="${mapPopupTextStyle()}">${content}</div>`);
    if (this.map) this.wirePopup();
    return this;
  }
  private wirePopup() {
    const popup = this.popup;
    const map = this.map;
    if (!popup || !map || !this.marker) return;
    popup.setLngLat(this.marker.getLngLat());
    this.el.onmouseenter = () => { if (this.marker && this.map) popup.setLngLat(this.marker.getLngLat()).addTo(this.map.ml); };
    this.el.onmouseleave = () => popup.remove();
    this.el.ontouchstart = () => {
      if (!this.marker || !this.map) return;
      if (popup.isOpen()) popup.remove();
      else popup.setLngLat(this.marker.getLngLat()).addTo(this.map.ml);
    };
  }
  on(event: string, handler: () => void): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(handler);
    this.listeners.set(event, arr);
    return this;
  }
  getElement(): HTMLElement | null { return this.el; }
}

class MLPolylineImpl {
  id = nextId("line");
  private coords: LatLngArr[];
  private opts: Record<string, unknown>;
  private map: MLMapImpl | null = null;
  private clickHandlers: (() => void)[] = [];
  constructor(latlngs: LatLngArr[], opts?: Record<string, unknown>) {
    this.coords = latlngs;
    this.opts = opts ?? {};
  }
  /** Leaflet-shaped click surface: the map hit-tests real taps
   *  against this line (see MLMapImpl's lineClickTargets) — the line
   *  itself has no DOM node to hang a listener on. Handlers are
   *  registered by reference, so one added after addTo is live
   *  immediately; before addTo, addTo performs the registration. */
  on(event: string, handler: () => void): this {
    if (event !== "click") return this;
    this.clickHandlers.push(handler);
    if (this.map) this.map.registerLineClick(this.id, this.coords, this.clickHandlers);
    return this;
  }
  addTo(map: MLMapImpl): this {
    this.map = map;
    const weight = typeof this.opts.weight === "number" ? this.opts.weight : 3;
    const dashRaw = typeof this.opts.dashArray === "string" ? this.opts.dashArray : null;
    const dash = dashRaw
      ? dashRaw.split(/\s+/).map((n) => Number(n) / Math.max(1, weight)).filter((n) => Number.isFinite(n))
      : null;
    map.registerOverlay({
      kind: "line",
      id: this.id,
      coords: this.coords,
      color: typeof this.opts.color === "string" ? this.opts.color : "#1a73e8",
      width: weight,
      opacity: typeof this.opts.opacity === "number" ? this.opts.opacity : 1,
      dash,
    });
    if (this.clickHandlers.length > 0) map.registerLineClick(this.id, this.coords, this.clickHandlers);
    return this;
  }
  remove(): void {
    this.map?.unregisterOverlay(this.id);
    this.map?.unregisterLineClick(this.id);
  }
  setLatLngs(latlngs: LatLngArr[]): this {
    this.coords = latlngs;
    if (this.map) {
      // Keep the registered overlay in sync: the style-swap restore
      // re-adds overlays from their registered defs, so a stale def
      // would resurrect the OLD geometry after a base-style switch.
      // registerOverlay also pushes the new data into the live source.
      const weight = typeof this.opts.weight === "number" ? this.opts.weight : 3;
      const dashRaw = typeof this.opts.dashArray === "string" ? this.opts.dashArray : null;
      const dash = dashRaw
        ? dashRaw.split(/\s+/).map((n) => Number(n) / Math.max(1, weight)).filter((n) => Number.isFinite(n))
        : null;
      this.map.registerOverlay({
        kind: "line",
        id: this.id,
        coords: this.coords,
        color: typeof this.opts.color === "string" ? this.opts.color : "#1a73e8",
        width: weight,
        opacity: typeof this.opts.opacity === "number" ? this.opts.opacity : 1,
        dash,
      });
      if (this.clickHandlers.length > 0) this.map.registerLineClick(this.id, this.coords, this.clickHandlers);
    }
    return this;
  }
  getBounds(): unknown { return { __coords: this.coords }; }
}

class MLRasterLayerImpl {
  id = nextId("raster");
  private url: string;
  private opts: Record<string, unknown>;
  private map: MLMapImpl | null = null;
  constructor(url: string, opts?: Record<string, unknown>) {
    this.url = url;
    this.opts = opts ?? {};
  }
  addTo(map: MLMapImpl): this {
    this.map = map;
    map.registerOverlay({
      kind: "raster",
      id: this.id,
      url: this.url,
      attribution: typeof this.opts.attribution === "string" ? this.opts.attribution : undefined,
      onTop: this.opts.onTop === true,
      opacity: typeof this.opts.opacity === "number" ? this.opts.opacity : undefined,
    });
    return this;
  }
  remove(): void { this.map?.unregisterOverlay(this.id); }
}

/** Install the MapLibre-backed engine as window.L (the surface the app
 *  was written against). Returns false only where WebGL is unusable —
 *  the caller then shows the honest "map library couldn't load" state
 *  and routing/alerts keep working from GPS alone. */
export function installMapEngine(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __smMapEngine?: boolean; L?: unknown };
  if (w.__smMapEngine) return true;
  try {
    // WebGL is the engine's hard requirement — probe it directly.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
  } catch { return false; }
  const factory = {
    map: (id: string, opts?: Record<string, unknown>) => new MLMapImpl(id as string | HTMLElement, opts),
    tileLayer: (url: string, opts?: Record<string, unknown>) => new MLRasterLayerImpl(url, opts),
    polyline: (latlngs: LatLngArr[], opts?: Record<string, unknown>) => new MLPolylineImpl(latlngs, opts),
    marker: (latlng: LatLngArr, opts?: Record<string, unknown>) => new MLMarkerImpl(latlng, opts),
    circleMarker: (latlng: LatLngArr, opts?: Record<string, unknown>) =>
      new MLMarkerImpl(latlng, undefined, {
        radius: typeof opts?.radius === "number" ? opts.radius : 8,
        color: typeof opts?.color === "string" ? opts.color : "#1a73e8",
        weight: typeof opts?.weight === "number" ? opts.weight : 3,
        fillColor: typeof opts?.fillColor === "string" ? opts.fillColor : "#1a73e8",
        fillOpacity: typeof opts?.fillOpacity === "number" ? opts.fillOpacity : 0.85,
      }),
    divIcon: (opts: Record<string, unknown>) => opts,
    latLngBounds: (latlngs: LatLngArr[]) => ({ __coords: latlngs }),
  };
  w.L = factory;
  w.__smMapEngine = true;
  return true;
}
