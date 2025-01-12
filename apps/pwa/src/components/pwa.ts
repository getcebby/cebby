import { registerSW } from 'virtual:pwa-register';

window.addEventListener('load', () => {
    const pwaToast = document.querySelector<HTMLDivElement>('#pwa-toast')!;
    const pwaToastMessage = pwaToast.querySelector<HTMLDivElement>('#toast-message')!;
    const pwaCloseBtn = pwaToast.querySelector<HTMLButtonElement>('#pwa-close')!;
    const pwaRefreshBtn = pwaToast.querySelector<HTMLButtonElement>('#pwa-refresh')!;

    let refreshSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

    const refreshCallback = async () => {
        try {
            await refreshSW?.(true);
            window.location.reload();
        } catch (err) {
            console.error('Failed to refresh SW:', err);
        }
    };

    const hidePwaToast = (raf = false) => {
        if (raf) {
            requestAnimationFrame(() => hidePwaToast(false));
            return;
        }
        if (pwaToast.classList.contains('refresh')) pwaRefreshBtn.removeEventListener('click', refreshCallback);

        pwaToast.classList.remove('show', 'refresh');
    };

    const showPwaToast = (offline: boolean) => {
        if (!offline) pwaRefreshBtn.addEventListener('click', refreshCallback);
        requestAnimationFrame(() => {
            hidePwaToast(false);
            if (!offline) pwaToast.classList.add('refresh');
            pwaToast.classList.add('show');
        });
    };

    pwaCloseBtn.addEventListener('click', () => hidePwaToast(true));

    window.addEventListener('online', () => {
        pwaToastMessage.innerHTML = "You're back online! Refresh to get the latest content.";
        showPwaToast(false);
    });

    window.addEventListener('offline', () => {
        pwaToastMessage.innerHTML = 'You seemed to be offline, using cached data.';
        showPwaToast(true);
    });

    refreshSW = registerSW({
        immediate: true,
        onOfflineReady() {
            pwaToastMessage.innerHTML = 'App ready to work offline';
            showPwaToast(true);
        },
        async onNeedRefresh() {
            console.log('New service worker version, deleting "ssr-pages-cache" cache storage...');
            try {
                await caches.delete('ssr-pages-cache');
                console.log('Deleted "ssr-pages-cache" cache storage');
            } catch (error) {
                console.error('Failed to delete "ssr-pages-cache" cache storage: ', error);
            }

            pwaToastMessage.innerHTML = 'New content available, click on reload button to update';
            showPwaToast(false);
        },
        async onRegisteredSW(swScriptUrl) {
            console.log('Service worker registered: ', swScriptUrl);
        },
        onRegisterError(error) {
            console.error('SW registration error', error);
        },
    });
});
