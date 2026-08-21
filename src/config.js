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
export const APP_BUILD = 98;
export const APP_VERSION = "1.5.76";
export const PLAY_URL = "https://play.google.com/store/apps/details?id=zw.co.damotors.fuel";
