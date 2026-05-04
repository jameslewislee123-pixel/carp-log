// Shared tile-layer config for every Leaflet map in the app. Default
// is satellite (Esri World Imagery) — much more useful for venue
// discovery and seeing actual water vs roads. Toggle to a Voyager
// roadmap (CartoDB) when the user wants names/streets.
//
// Both providers are key-free for sane usage. Attribution strings are
// what each provider's terms request.

export type MapLayer = 'satellite' | 'map';

export const TILE_LAYERS: Record<MapLayer, {
  url: string;
  attribution: string;
  maxZoom: number;
  // Esri uses {z}/{y}/{x}; standard XYZ uses {z}/{x}/{y}. The url string
  // already encodes this; we only flag it here so reviewers don't trip
  // on the "looks transposed" Esri URL.
}> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  map: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
};
