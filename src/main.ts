import "./style.css";
import "./styles/home.css";
import "./styles/theme.css";
import "./styles/workspace-chrome.css";
import "./styles/inspiration.css";
import "./styles/canvas-guide.css";
import "./services/theme-preference";
import { bootstrap } from "./app/bootstrap";

document.documentElement.classList.remove("app-loading");
void bootstrap();
