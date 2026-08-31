package zw.co.damotors.fuel;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // A WebView can't download a file on its own — which is why the in-app "Update"
        // button used to do nothing. The update APK is served with
        // Content-Disposition: attachment, so navigating to it fires this listener; we
        // hand the download to Android's DownloadManager, and the user installs from the
        // completed-download notification.
        try {
            this.bridge.getWebView().setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                            String mimetype, long contentLength) {
                    try {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        request.setMimeType("application/vnd.android.package-archive");
                        request.setTitle("DA OPS update");
                        request.setDescription("Downloading the latest version…");
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "DA-OPS.apk");
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        dm.enqueue(request);
                        Toast.makeText(getApplicationContext(),
                                "Downloading update… open it from your notifications to install.",
                                Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(getApplicationContext(),
                                "Couldn't start the download — open fuel.dasuperapp.com/download/latest.apk in Chrome.",
                                Toast.LENGTH_LONG).show();
                    }
                }
            });
        } catch (Exception ignored) { }
    }
}
