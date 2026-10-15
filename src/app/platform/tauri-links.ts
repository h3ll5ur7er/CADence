import { openUrl } from '@tauri-apps/plugin-opener';

/** Desktop: web links that would open a new window (`target="_blank"`) open in the user's browser instead. */
export function openWebLinksInBrowser(): void {
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a[target="_blank"]');
      const href = link?.getAttribute('href');
      if (!href || !/^https?:\/\//.test(href)) return;
      event.preventDefault();
      void openUrl(href);
    },
    true,
  );
}
