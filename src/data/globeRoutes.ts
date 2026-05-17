import type { SphereCoordinate } from "../utils/sphereProjection";

export type NetworkCityId =
  | "london"
  | "dubai"
  | "singapore"
  | "new-york"
  | "san-francisco"
  | "sao-paulo"
  | "lagos"
  | "palestine"
  | "rome"
  | "moscow"
  | "beijing"
  | "shanghai";

export type NetworkCity = SphereCoordinate & {
  id: NetworkCityId;
  label: string;
  labelPriority: number;
};

export type NetworkRoute = {
  id: string;
  from: NetworkCityId;
  to: NetworkCityId;
  color: string;
  accentColor: string;
  delay: number;
};

export const NETWORK_CITIES: NetworkCity[] = [
  { id: "london", label: "London", lat: 51.5072, lon: -0.1276, labelPriority: 1 },
  { id: "dubai", label: "Dubai", lat: 25.2048, lon: 55.2708, labelPriority: 2 },
  { id: "singapore", label: "Singapore", lat: 1.3521, lon: 103.8198, labelPriority: 3 },
  { id: "new-york", label: "New York", lat: 40.7128, lon: -74.006, labelPriority: 4 },
  { id: "san-francisco", label: "San Francisco", lat: 37.7749, lon: -122.4194, labelPriority: 6 },
  { id: "sao-paulo", label: "Sao Paulo", lat: -23.5505, lon: -46.6333, labelPriority: 5 },
  { id: "lagos", label: "Lagos", lat: 6.5244, lon: 3.3792, labelPriority: 7 },
  { id: "palestine", label: "Palestine", lat: 31.9038, lon: 35.2034, labelPriority: 8 },
  { id: "rome", label: "Rome", lat: 41.9028, lon: 12.4964, labelPriority: 8 },
  { id: "moscow", label: "Moscow", lat: 55.7558, lon: 37.6173, labelPriority: 9 },
  { id: "beijing", label: "Beijing", lat: 39.9042, lon: 116.4074, labelPriority: 10 },
  { id: "shanghai", label: "Shanghai", lat: 31.2304, lon: 121.4737, labelPriority: 11 },
];

export const NETWORK_ROUTES: NetworkRoute[] = [
  {
    id: "london-dubai",
    from: "london",
    to: "dubai",
    color: "#ff9b4a",
    accentColor: "#ffe3bb",
    delay: 0,
  },
  {
    id: "dubai-singapore",
    from: "dubai",
    to: "singapore",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.16,
  },
  {
    id: "new-york-london",
    from: "new-york",
    to: "london",
    color: "#8b7cff",
    accentColor: "#e5e0ff",
    delay: 0.32,
  },
  {
    id: "san-francisco-new-york",
    from: "san-francisco",
    to: "new-york",
    color: "#45dfff",
    accentColor: "#c8f6ff",
    delay: 0.48,
  },
  {
    id: "new-york-sao-paulo",
    from: "new-york",
    to: "sao-paulo",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.64,
  },
  {
    id: "rome-lagos",
    from: "rome",
    to: "lagos",
    color: "#ff9b4a",
    accentColor: "#fff0cf",
    delay: 0.78,
  },
  {
    id: "lagos-dubai",
    from: "lagos",
    to: "dubai",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.9,
  },
  {
    id: "rome-palestine",
    from: "rome",
    to: "palestine",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.18,
  },
  {
    id: "palestine-dubai",
    from: "palestine",
    to: "dubai",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.58,
  },
  {
    id: "moscow-beijing",
    from: "moscow",
    to: "beijing",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.08,
  },
  {
    id: "beijing-shanghai",
    from: "beijing",
    to: "shanghai",
    color: "#45dfff",
    accentColor: "#c8f6ff",
    delay: 0.24,
  },
  {
    id: "shanghai-singapore",
    from: "shanghai",
    to: "singapore",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.4,
  },
];
