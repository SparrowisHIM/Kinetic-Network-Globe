import type { SphereCoordinate } from "../utils/sphereProjection";

export type NetworkCountryId =
  | "australia"
  | "nigeria"
  | "palestine"
  | "china"
  | "russia"
  | "saudi-arabia"
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
};

export const NETWORK_COUNTRIES: NetworkCountry[] = [
  { id: "australia", label: "Australia", flagCode: "au", lat: -25.2744, lon: 133.7751, labelPriority: 11 },
  { id: "nigeria", label: "Nigeria", flagCode: "ng", lat: 9.082, lon: 8.6753, labelPriority: 4 },
  { id: "palestine", label: "Palestine", flagCode: "ps", lat: 31.9522, lon: 35.2332, labelPriority: 3 },
  { id: "china", label: "China", flagCode: "cn", lat: 35.8617, lon: 104.1954, labelPriority: 8 },
  { id: "russia", label: "Russia", flagCode: "ru", lat: 61.524, lon: 105.3188, labelPriority: 9 },
  { id: "saudi-arabia", label: "Saudi Arabia", flagCode: "sa", lat: 23.8859, lon: 45.0792, labelPriority: 2 },
  { id: "brazil", label: "Brazil", flagCode: "br", lat: -14.235, lon: -51.9253, labelPriority: 6 },
  { id: "usa", label: "USA", flagCode: "us", lat: 37.0902, lon: -95.7129, labelPriority: 5 },
  { id: "japan", label: "Japan", flagCode: "jp", lat: 36.2048, lon: 138.2529, labelPriority: 10 },
  { id: "spain", label: "Spain", flagCode: "es", lat: 40.4637, lon: -3.7492, labelPriority: 7 },
];

export const NETWORK_ROUTES: NetworkRoute[] = [
  {
    id: "usa-brazil",
    from: "usa",
    to: "brazil",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.64,
  },
  {
    id: "nigeria-saudi-arabia",
    from: "nigeria",
    to: "saudi-arabia",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.9,
  },
  {
    id: "russia-nigeria",
    from: "russia",
    to: "nigeria",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.36,
  },
  {
    id: "palestine-saudi-arabia",
    from: "palestine",
    to: "saudi-arabia",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.58,
  },
  {
    id: "palestine-spain",
    from: "palestine",
    to: "spain",
    color: "#ff9b4a",
    accentColor: "#fff0cf",
    delay: 0.72,
  },
  {
    id: "saudi-arabia-japan",
    from: "saudi-arabia",
    to: "japan",
    color: "#45dfff",
    accentColor: "#d6fbff",
    delay: 0.16,
  },
  {
    id: "russia-china",
    from: "russia",
    to: "china",
    color: "#8b7cff",
    accentColor: "#e7e2ff",
    delay: 0.08,
  },
  {
    id: "china-japan",
    from: "china",
    to: "japan",
    color: "#45dfff",
    accentColor: "#c8f6ff",
    delay: 0.24,
  },
  {
    id: "japan-australia",
    from: "japan",
    to: "australia",
    color: "#ff4da6",
    accentColor: "#ffd5ec",
    delay: 0.4,
  },
];
