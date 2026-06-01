package stirling.software.SPDF.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

import lombok.extern.slf4j.Slf4j;

/**
 * Clevai desktop-installer helper. When {@code stirling.desktop.open-browser=true} (set ONLY by the
 * jpackage/Inno installer launcher, never in server deployments), this opens the editor in a window
 * once the embedded server is ready, so double-clicking the installed app behaves like a normal
 * desktop program. Off by default — has zero effect on headless/server runs. Uses {@code cmd start}
 * (no AWT) so the bundled runtime needs no java.desktop module.
 */
@Slf4j
@Component
public class DesktopBrowserLauncher implements ApplicationListener<ApplicationReadyEvent> {

    @Value("${stirling.desktop.open-browser:false}")
    private boolean openBrowser;

    @Value("${server.port:8080}")
    private int port;

    private volatile boolean launched = false;

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (!openBrowser || launched) {
            return;
        }
        launched = true; // ApplicationReadyEvent can fire more than once (e.g. management context)
        String url = "http://localhost:" + port + "/";
        try {
            String os = System.getProperty("os.name", "").toLowerCase();
            ProcessBuilder pb;
            if (os.contains("win")) {
                // Edge app-mode gives a chromeless window; `start` resolves msedge via App Paths.
                pb = new ProcessBuilder("cmd", "/c", "start", "", "msedge", "--app=" + url);
            } else if (os.contains("mac")) {
                pb = new ProcessBuilder("open", url);
            } else {
                pb = new ProcessBuilder("xdg-open", url);
            }
            pb.start();
            log.info("Desktop launcher opened the editor at {}", url);
        } catch (Exception e) {
            log.warn(
                    "Desktop launcher could not open a browser ({}). Open {} manually.",
                    e.getMessage(),
                    url);
        }
    }
}
