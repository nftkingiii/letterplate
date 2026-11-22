import "./polyfill";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WalletProvider } from "./WalletContext";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>,
);
