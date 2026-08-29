import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./index.css";
// last-resort boundary so even a crash during App's own mount shows a card, not
// a blank screen (per-tab boundaries inside App.jsx keep the nav alive otherwise)
createRoot(document.getElementById("root")).render(<React.StrictMode><ErrorBoundary detail><App /></ErrorBoundary></React.StrictMode>);
