/*
 * Client-side behaviour for the events listing page.
 * Originally an inline <script> in src/pages/events.astro – extracted so it can
 * be cached by the service-worker and tree-shaken by Vite.
 */

// ------------------------------
// Tab Navigation
// ------------------------------
function initializeTabNavigation() {
    const tabs = document.querySelectorAll('.event-tab');
    const sections = document.querySelectorAll('.upcoming-section');

    const findFirstAvailableTab = (): string => {
        const order = ['all', 'today', 'tomorrow', 'thisWeek', 'nextWeek', 'thisMonth', 'nextMonth', 'later'];
        for (const id of order) {
            const section = document.querySelector(`.upcoming-section[data-section="${id}"]`);
            if (section) {
                const tab = document.querySelector(`[data-tab="${id}"]`);
                if (tab) {
                    section.classList.remove('hidden');
                    section.setAttribute('data-active', 'true');
                    tab.setAttribute('data-active', 'true');
                    return id;
                }
            }
        }
        return 'all';
    };

    const getActiveTab = (): string => {
        const hash = window.location.hash.slice(1);
        const hashTab = document.querySelector(`[data-tab="${hash}"]`);
        const hashSection = document.querySelector(`.upcoming-section[data-section="${hash}"]`);
        if (hash && hashTab && hashSection) return hash;
        return findFirstAvailableTab();
    };

    const updateUI = (active: string) => {
        sections.forEach((s) => {
            s.classList.add('hidden');
            s.setAttribute('data-active', 'false');
        });
        tabs.forEach((t) => t.setAttribute('data-active', 'false'));

        const activeSection = document.querySelector(`.upcoming-section[data-section="${active}"]`);
        const activeTab = document.querySelector(`[data-tab="${active}"]`);

        if (activeSection && activeTab) {
            activeSection.classList.remove('hidden');
            activeSection.setAttribute('data-active', 'true');
            activeTab.setAttribute('data-active', 'true');
            const newUrl = `${window.location.pathname}#${active}`;
            window.history.replaceState(null, '', newUrl);
        }
    };

    const initial = getActiveTab();
    updateUI(initial);

    tabs.forEach((tab) => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const id = tab.getAttribute('data-tab');
            if (id) updateUI(id);
        });
    });

    window.addEventListener('hashchange', () => updateUI(getActiveTab()));
}

// ------------------------------
// Mobile drag-scroll for card rows
// ------------------------------
function initializeScrolling() {
    if (window.innerWidth >= 640) return;
    const scrollAreas = document.querySelectorAll('.scroll-area');

    scrollAreas.forEach((area) => {
        let isDown = false;
        let startX = 0;
        let scrollLeft = 0;

        const onMouseDown = (e: MouseEvent) => {
            isDown = true;
            (area as HTMLElement).classList.add('active');
            startX = e.pageX - (area as HTMLElement).offsetLeft;
            scrollLeft = (area as HTMLElement).scrollLeft;
        };
        const stop = () => {
            isDown = false;
            (area as HTMLElement).classList.remove('active');
        };
        const onMouseMove = (e: MouseEvent) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - (area as HTMLElement).offsetLeft;
            const walk = (x - startX) * 2;
            (area as HTMLElement).scrollLeft = scrollLeft - walk;
        };

        area.addEventListener('mousedown', onMouseDown as EventListener);
        area.addEventListener('mouseleave', stop as EventListener);
        area.addEventListener('mouseup', stop as EventListener);
        area.addEventListener('mousemove', onMouseMove as EventListener);
    });
}

// ------------------------------
// Helpers
// ------------------------------
function getDateInTimezone(date: string | Date) {
    return new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

function isEventHappening(event: any) {
    const now = getDateInTimezone(new Date());
    const start = getDateInTimezone(new Date(event.start_time));
    const end = event.end_time
        ? getDateInTimezone(new Date(event.end_time))
        : getDateInTimezone(new Date(start.getTime() + 4 * 60 * 60 * 1000));
    return start <= now && now <= end;
}

function updateEventSections() {
    const happening = document.querySelector('[data-section="happening"]') as HTMLDivElement | null;
    const upcoming = document.querySelector('[data-section="upcoming"]') as HTMLDivElement | null;
    if (!happening || !upcoming) return;

    const upcomingCards = upcoming.querySelectorAll('[data-event]');
    upcomingCards.forEach((card) => {
        const data = JSON.parse(card.getAttribute('data-event') || '{}');
        if (isEventHappening(data)) {
            const grid = happening.querySelector('.grid, .scroll-area');
            if (grid) {
                happening.style.display = 'block';
                const wrapper = card.closest('.scroll-item') || card;
                grid.appendChild(wrapper);
            }
        }
    });

    ['happening', 'upcoming'].forEach((k) => {
        const section = document.querySelector(`[data-section="${k}"]`) as HTMLDivElement | null;
        const grid = section?.querySelector('.grid, .scroll-area');
        if (section && grid) section.style.display = grid.children.length > 0 ? 'block' : 'none';
    });
}

function equalizeCardHeights() {
    if (window.innerWidth >= 640) return;
    const areas = document.querySelectorAll('.scroll-area');
    areas.forEach((area) => {
        const cards = area.querySelectorAll('.event-card');
        if (!cards.length) return;
        cards.forEach((c) => ((c as HTMLElement).style.height = 'auto'));
        let max = 0;
        cards.forEach((c) => {
            const h = (c as HTMLElement).offsetHeight;
            max = Math.max(max, h);
        });
        if (max) cards.forEach((c) => ((c as HTMLElement).style.height = `${max}px`));
    });
}

// ------------------------------
// Init
// ------------------------------
function init() {
    initializeTabNavigation();
    initializeScrolling();
    updateEventSections();
    equalizeCardHeights();

    document.querySelectorAll('img').forEach((img) => {
        img.addEventListener('load', equalizeCardHeights);
    });
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('astro:page-load', init);

let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(equalizeCardHeights, 250);
});

// Re-run equalisation when tab changes
const tabButtons = document.querySelectorAll('.event-tab');
if (tabButtons.length) {
    tabButtons.forEach((t) => t.addEventListener('click', () => setTimeout(equalizeCardHeights, 100)));
}
