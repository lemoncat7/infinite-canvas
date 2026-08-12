import "./style.css";
import "./styles/home.css";
import "./styles/theme.css";
import "./services/theme-preference";
import { bootstrap } from "./app/bootstrap";

document.documentElement.classList.remove("app-loading");
void bootstrap();
