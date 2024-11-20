import { registerSW } from "virtual:pwa-register";

window.addEventListener("load", () => {
  const pwaToast = document.querySelector<HTMLDivElement>("#pwa-toast")!;
  const pwaToastMessage = pwaToast.querySelector<HTMLDivElement>(
    ".message #toast-message"
  )!;
  const pwaCloseBtn = pwaToast.querySelector<HTMLButtonElement>("#pwa-close")!;
  const pwaRefreshBtn =
    pwaToast.querySelector<HTMLButtonElement>("#pwa-refresh")!;

  let refreshSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

  const refreshCallback = () => refreshSW?.(true);

  const hidePwaToast = (raf = false) => {
    if (raf) {
      requestAnimationFrame(() => hidePwaToast(false));
      return;
    }
    if (pwaToast.classList.contains("refresh"))
      pwaRefreshBtn.removeEventListener("click", refreshCallback);

    pwaToast.classList.remove("show", "refresh");
  };
  const showPwaToast = (offline: boolean) => {
    if (!offline) pwaRefreshBtn.addEventListener("click", refreshCallback);
    requestAnimationFrame(() => {
      hidePwaToast(false);
      if (!offline) pwaToast.classList.add("refresh");
      pwaToast.classList.add("show");
    });
  };

  pwaCloseBtn.addEventListener("click", () => hidePwaToast(true));

  refreshSW = registerSW({
    immediate: true,
    onOfflineReady() {
      pwaToastMessage.innerHTML = "App ready to work offline";
      showPwaToast(true);
    },
    onNeedRefresh() {
      pwaToastMessage.innerHTML =
        "New content available, click on reload button to update";
      showPwaToast(false);
    },
    onRegisteredSW(swScriptUrl) {
      // eslint-disable-next-line no-console
      console.log("SW registered: ", swScriptUrl);
    },
  });

  const updateServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    } catch (error) {
      console.error("Error updating service worker:", error);
    }
  };

  if ("serviceWorker" in navigator) {
    const toast = document.querySelector("#pwa-toast");
    const toastMessage = document.querySelector("#toast-message");
    const refreshButton = document.querySelector("#pwa-refresh");
    const closeButton = document.querySelector("#pwa-close");

    // Check for updates every 5 minutes
    setInterval(updateServiceWorker, 5 * 60 * 1000);

    navigator.serviceWorker.ready.then((registration) => {
      registration.addEventListener("controlling", () => {
        // When the service worker takes control, reload the page
        window.location.reload();
      });

      registration.addEventListener("waiting", () => {
        // Show toast when update is available
        if (toast && toastMessage) {
          toastMessage.textContent = "New version available!";
          toast.classList.add("show", "refresh");
        }
      });
    });

    // Refresh button handler
    refreshButton?.addEventListener("click", async () => {
      if (!navigator.serviceWorker.controller) return;

      // This will trigger the 'controlling' event
      const registration = await navigator.serviceWorker.ready;
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    });

    // Close button handler
    closeButton?.addEventListener("click", () => {
      toast?.classList.remove("show", "refresh");
    });
  }
});
