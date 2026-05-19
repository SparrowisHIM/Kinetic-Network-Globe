import type { SphereCoordinate } from "../utils/sphereProjection";

export type NetworkCountryId =
  | "australia"
  | "nigeria"
  | "palestine"
  | "china"
  | "germany"
  | "canada"
  | "russia"
  | "norway"
  | "brazil"
  | "usa"
  | "japan"
  | "spain";

export type NetworkCountry = SphereCoordinate & {
  id: NetworkCountryId;
  label: string;
  flagCode: string;
  labelPriority: number;
};

export type NetworkRoute = {
  id: string;
  from: NetworkCountryId;
  to: NetworkCountryId;
  color: string;
  accentColor: string;
  delay: number;
  lift?: number;
};

export const NETWORK_COUNTRIES: NetworkCountry[] = [
  { id: "australia", label: "Australia", flagCode: "au", lat: -25.2744, lon: 133.7751, labelPriority: 11 },
  { id: "nigeria", label: "Nigeria", flagCode: "ng", lat: 9.082, lon: 8.6753, labelPriority: 4 },
  { id: "palestine", label: "Palestine", flagCode: "ps", lat: 31.9522, lon: 35.2332, labelPriority: 3 },
  { id: "china", label: "China", flagCode: "cn", lat: 35.8617, lon: 104.1954, labelPriority: 8 },
  { id: "germany", label: "Germany", flagCode: "de", lat: 50.1109, lon: 8.6821, labelPriority: 9 },
  { id: "canada", label: "Canada", flagCode: "ca", lat: 56.1304, lon: -106.3468, labelPriority: 12 },
  { id: "russia", label: "Russia", flagCode: "ru", lat: 61.524, lon: 105.3188, labelPriority: 13 },
  { id: "norway", label: "Norway", flagCode: "no", lat: 60.472, lon: 8.4689, labelPriority: 11 },
  { id: "brazil", label: "Brazil", flagCode: "br", lat: -14.235, lon: -51.9253, labelPriority: 6 },
  { id: "usa", label: "USA", flagCode: "us", lat: 37.0902, lon: -95.7129, labelPriority: 5 },
  { id: "japan", label: "Japan", flagCode: "jp", lat: 36.2048, lon: 138.2529, labelPriority: 10 },
  { id: "spain", label: "Spain", flagCode: "es", lat: 40.4637, lon: -3.7492, labelPriority: 7 },
];

export const NETWORK_ROUTES: NetworkRoute[] = [
  {
    id: "canada-usa",
    from: "canada",
    to: "usa",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.08,
    lift: 0.18,
  },
  {
    id: "usa-brazil",
    from: "usa",
    to: "brazil",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.24,
  },
  {
    id: "canada-norway",
    from: "canada",
    to: "norway",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.32,
    lift: 0.18,
  },
  {
    id: "spain-germany",
    from: "spain",
    to: "germany",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.48,
    lift: 0.18,
  },
  {
    id: "germany-nigeria",
    from: "germany",
    to: "nigeria",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.64,
  },
  {
    id: "spain-palestine",
    from: "spain",
    to: "palestine",
    color: "#ff9b4a",
    accentColor: "#fff0cf",
    delay: 0.8,
  },
  {
    id: "palestine-china",
    from: "palestine",
    to: "china",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.96,
  },
  {
    id: "germany-norway",
    from: "germany",
    to: "norway",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.2,
    lift: 0.16,
  },
  {
    id: "norway-russia",
    from: "norway",
    to: "russia",
    color: "#ff9b4a",
    accentColor: "#fff0cf",
    delay: 0.36,
    lift: 0.16,
  },
  {
    id: "russia-china",
    from: "russia",
    to: "china",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.52,
    lift: 0.22,
  },
  {
    id: "china-japan",
    from: "china",
    to: "japan",
    color: "#45dfff",
    accentColor: "#c8f6ff",
    delay: 0.68,
  },
  {
    id: "japan-australia",
    from: "japan",
    to: "australia",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.84,
  },
];
