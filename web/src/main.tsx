import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { FillPage } from "./FillPage.js";
import { parseFillRoute } from "./lib/fillRoute.js";
import "./styles.css";

// The Companion deep link (`/fill?preset=…&redirect=…`) lands on the same bundle; a plain
// location parse keeps the SPA router-free.
const fill = parseFillRoute(window.location);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{fill ? <FillPage route={fill} /> : <App />}</StrictMode>,
);
