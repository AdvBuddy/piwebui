import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// No StrictMode: it double-mounts effects in dev, which opens two WebSockets and
// makes relay logging confusing while iterating.
createRoot(container).render(<App />);
