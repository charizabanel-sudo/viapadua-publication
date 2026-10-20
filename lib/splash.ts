// Shared by the root layout (server) and SplashScreen (client).
export const SPLASH_KEY = "vp-splash-seen";

/**
 * Runs before first paint (inline in <head>): turns the splash on only for the first public-page
 * load in this browser tab. Without JavaScript the splash never shows, so the site stays usable.
 */
export const SPLASH_BOOT_SCRIPT = `(function(){try{var p=location.pathname;if(p.indexOf('/admin')===0||p==='/login')return;if(sessionStorage.getItem('${SPLASH_KEY}'))return;document.documentElement.classList.add('vp-splash-on');}catch(e){}})();`;
