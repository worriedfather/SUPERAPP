/* App configuration constants.

   GOOGLE_MAPS_KEY seeds Google Directions as the default distance source, so the
   route triangulation (Google + OpenStreetMap + distance table) has Google
   available without anyone entering a key in Master data. A key saved in Master
   data (localStorage "da_gkey") overrides this. A Maps key is designed to ship
   in the client; restrict it by Android app + API in the Google Cloud console. */
export const GOOGLE_MAPS_KEY =
  (import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_KEY) ||
  "AIzaSyCs3viloGdsbImYBKc-nO-P5g0vz4K3hCA";

/* This build's Android versionCode. Keep it in step with android/app/build.gradle
   `versionCode` on every release — the server compares its MIN_BUILD to this to
   force old apps to update. */
export const APP_BUILD = 160;
export const APP_VERSION = "1.9.8";
export const PLAY_URL = "https://play.google.com/store/apps/details?id=zw.co.damotors.fuel";
/* Direct APK download — DA OPS is sideloaded, not on Play, so the force-update
   screen points here (the server hosts the latest signed APK at this path). */
export const APK_URL = "https://fuel.dasuperapp.com/download/latest.apk";
/* iOS can't install an APK. Until a TestFlight/App Store build is live, iPhone
   users get the always-current web app (PWA) — Add to Home Screen for full-screen. */
export const IOS_URL = "https://fuel.dasuperapp.com";

/* Google Sign-In client ID (public — it only names the OAuth audience). Create a
   "Web application" OAuth client in Google Cloud Console with authorized origin
   https://fuel.dasuperapp.com, then set VITE_GOOGLE_CLIENT_ID at build time. When
   empty the "Sign in with Google" button is hidden. */
export const GOOGLE_CLIENT_ID =
  (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
  "72185703543-4b785sstvqcgi8vqb6640ddsi2c13iin.apps.googleusercontent.com";
