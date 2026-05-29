import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const THREE_CLOCK_DEPRECATION =
  "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.";

const originalConsoleWarn = console.warn.bind(console);

console.warn = (...args) => {
  const isKnownThreeClockWarning = args.some((arg) => typeof arg === "string" && arg.includes(THREE_CLOCK_DEPRECATION));

  if (isKnownThreeClockWarning) return;

  originalConsoleWarn(...args);
};

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
