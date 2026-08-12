let bootstrapped = false;

export async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    await import("./runtime");
  } finally {
    document.documentElement.classList.remove("app-loading");
  }
}
