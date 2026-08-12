import "./style.css";
import { bootstrap } from "./app/bootstrap";

document.documentElement.classList.remove("app-loading");
void bootstrap();
