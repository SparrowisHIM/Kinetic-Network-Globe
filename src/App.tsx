import { lazy, Suspense } from "react";

const GlobeComponent = lazy(() =>
  import("./components/GlobeComponent").then((module) => ({ default: module.GlobeComponent })),
);

export default function App() {
  return (
    <main className="app-shell">
      <Suspense
        fallback={
          <section className="globe-section globe-loading" aria-label="Loading interactive globe">
            <div className="globe-ambient" aria-hidden="true" />
            <div className="globe-loading-core" aria-hidden="true" />
            <span className="sr-only">Loading interactive globe</span>
          </section>
        }
      >
        <GlobeComponent />
      </Suspense>
    </main>
  );
}
