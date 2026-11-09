declare module "*.css";
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}

// Minimal map-engine surface (window.L). Since the 2026-10-27 engine
// swap this is backed by MapLibre GL JS vector tiles via the adapter
// in client/src/mapEngine.ts — the member names are kept from the old
// Leaflet integration so call sites read the same, but bearing, pitch,
// and base styles are native MapLibre camera/style controls now.
// Only the members this app uses are declared.
interface LeafletLatLng {
  lat: number;
  lng: number;
}
interface LeafletMapHandler {
  enable(): void;
  disable(): void;
  enabled(): boolean;
}
interface LeafletMap {
  setView(center: [number, number], zoom: number): LeafletMap;
  panTo(center: [number, number]): LeafletMap;
  panBy(point: [number, number], opts?: { animate?: boolean }): LeafletMap;
  flyTo(
    center: [number, number],
    zoom: number,
    opts?: { duration?: number },
  ): LeafletMap;
  getZoom(): number;
  setZoom(zoom: number): LeafletMap;
  zoomIn(): LeafletMap;
  zoomOut(): LeafletMap;
  getContainer(): HTMLElement;
  dragging: LeafletMapHandler;
  touchZoom: LeafletMapHandler;
  scrollWheelZoom: LeafletMapHandler;
  doubleClickZoom: LeafletMapHandler;
  on(
    event: string,
    handler: (e?: { latlng: { lat: number; lng: number } }) => void,
  ): LeafletMap;
  screenToLatLng(point: [number, number]): [number, number];
  getCenter(): [number, number];
  fitBounds(
    bounds: unknown,
    opts?: {
      padding?: [number, number];
      // Asymmetric framing (Leaflet-shaped, [x, y] each): lets a fit
      // leave room for overlays on one side — e.g. the route chooser
      // sheet covering the bottom of the map.
      paddingTopLeft?: [number, number];
      paddingBottomRight?: [number, number];
    },
  ): LeafletMap;
  remove(): void;
  invalidateSize(): void;
  // MapLibre-native controls (engine swap, 2026-10-27): bearing and
  // pitch are real camera moves, and the base style swaps the whole
  // vector/raster style in one call.
  setBearing(deg: number): void;
  getBearing(): number;
  setPitch(deg: number): void;
  // Docked-overlay camera reserve (gantry sign board, 2026-11-05):
  // top viewport padding so the follow camera frames the truck in
  // the unobstructed area below the board. 0 restores true center.
  setCameraPaddingTop(px: number): LeafletMap;
  // Top + bottom viewport reserves (2026-11-09): the camera center
  // — and the follow puck — render at the center of the padded
  // viewport, so a bottom reserve lifts the puck out from behind
  // the Go trip bar / pulled-up trip sheet while a top reserve
  // anchors it low with more of the road ahead in view.
  setCameraPadding(topPx: number, bottomPx: number): LeafletMap;
  setBaseStyle(
    kind: "streets" | "satellite" | "hybrid" | "offline",
    opts: { dark: boolean; labels: boolean; night?: boolean },
  ): void;
}
interface LeafletLayer {
  addTo(map: LeafletMap): LeafletLayer;
  remove(): void;
}
interface LeafletPolyline extends LeafletLayer {
  addTo(map: LeafletMap): LeafletPolyline;
  getBounds(): unknown;
  setLatLngs(latlngs: [number, number][]): LeafletPolyline;
  on(event: string, handler: () => void): LeafletPolyline;
}
interface LeafletMarker extends LeafletLayer {
  addTo(map: LeafletMap): LeafletMarker;
  setLatLng(latlng: [number, number]): LeafletMarker;
  setIcon(icon: unknown): LeafletMarker;
  bindTooltip(
    content: string,
    opts?: Record<string, unknown>,
  ): LeafletMarker;
  on(event: string, handler: () => void): LeafletMarker;
  getElement(): HTMLElement | null;
}
interface LeafletCircleMarker extends LeafletLayer {
  addTo(map: LeafletMap): LeafletCircleMarker;
  setLatLng(latlng: [number, number]): LeafletCircleMarker;
  bindTooltip(
    content: string,
    opts?: Record<string, unknown>,
  ): LeafletCircleMarker;
  on(event: string, handler: () => void): LeafletCircleMarker;
  getElement(): HTMLElement | null;
}
interface Window {
  L?: {
    map(id: string, opts?: Record<string, unknown>): LeafletMap;
    tileLayer(url: string, opts?: Record<string, unknown>): LeafletLayer;
    polyline(
      latlngs: [number, number][],
      opts?: Record<string, unknown>,
    ): LeafletPolyline;
    marker(
      latlng: [number, number],
      opts?: Record<string, unknown>,
    ): LeafletMarker;
    circleMarker(
      latlng: [number, number],
      opts?: Record<string, unknown>,
    ): LeafletCircleMarker;
    divIcon(opts: Record<string, unknown>): unknown;
    latLngBounds(latlngs: [number, number][]): unknown;
  };
}

// pdfjs-dist's standard build ships no .d.mts beside build/pdf.mjs
// (the legacy build does). pdfDoc.ts imports the standard build —
// same 5.4.624 API — so borrow the legacy build's declarations.
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist/legacy/build/pdf.mjs";
}
