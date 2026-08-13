import "./style.css";
import "./styles/home.css";
import "./styles/theme.css";
import "./styles/workspace-chrome.css";
import "./styles/inspiration.css";
import "./styles/canvas-guide.css";
import "./styles/comic-studio.css";
import "./services/theme-preference";
import { bootstrap } from "./app/bootstrap";

void bootstrap().finally(() => {
  requestAnimationFrame(() => document.documentElement.classList.remove("app-loading"));
});
