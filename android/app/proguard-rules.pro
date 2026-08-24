# DA OPS — R8/ProGuard keep rules.
# Capacitor and its plugins are reached via reflection / JS bridge, so R8 must
# not rename or remove them.

# --- Capacitor core + plugins ---
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * { @com.getcapacitor.annotation.PermissionCallback *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public *; }
-keepclassmembers class * { @com.getcapacitor.annotation.ActivityCallback *; }

# JS interface bridge
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# --- Cordova plugins bundled by Capacitor ---
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# --- app package (plugin registration references these) ---
-keep class zw.co.damotors.fuel.** { *; }

# Keep annotations / signatures R8 needs for the above
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
# keep line numbers for readable crash reports
-keepattributes SourceFile,LineNumberTable

# @capgo/background-geolocation — keep its classes + package names so its static
# initializer (Package.getName()) survives if minify is re-enabled.
-keep class com.capgo.** { *; }
-keeppackagenames com.capgo.**
-keepattributes RuntimeVisibleAnnotations,Signature,InnerClasses,EnclosingMethod
