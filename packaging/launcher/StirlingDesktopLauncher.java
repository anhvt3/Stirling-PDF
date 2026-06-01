import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.image.BufferedImage;
import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.stream.Stream;

/**
 * Clevai desktop launcher for the Stirling-PDF core server. jpackage runs THIS as the app's main;
 * it owns the embedded server's lifecycle so the installed program behaves like a real desktop app:
 *
 *  - Single instance: if the server is already up (e.g. a 2nd double-click), it just opens a new
 *    window and exits instead of starting a 2nd server that would fail to bind the port.
 *  - Tray icon: right-click -> Quit fully stops the background server (fixes the "lingering server"
 *    wart). Double-click the tray (or the window's "Open") re-opens the editor window.
 *  - Closing the editor window leaves the app in the tray (standard close-to-tray); Quit ends it.
 *
 * Uses only JDK classes (no deps). The server runs as a child process using the bundled runtime.
 */
public final class StirlingDesktopLauncher {

    private static final int PORT = 8080;
    private static final String URL = "http://localhost:" + PORT + "/";
    private static final String STATUS = URL + "api/v1/info/status";

    private static volatile Process server;
    private static TrayIcon trayIcon;

    public static void main(String[] args) {
        try {
            // Single-instance: a running server means another launcher owns it — just open a window
            // and exit. System.exit (not return) guarantees this short-lived process terminates even
            // though HttpClient/AWT may have spun up background threads.
            if (serverUp()) {
                openWindow();
                System.exit(0);
                return;
            }
            startServer();
            if (!waitUntilUp(Duration.ofSeconds(120))) {
                System.err.println("Stirling-PDF server failed to start within timeout.");
                stopServer();
                System.exit(1);
                return;
            }
            openWindow();
            setupTray();
            // If the server dies on its own, tear the launcher down too.
            server.onExit().thenRun(() -> shutdown(0));
            // AWT (tray) keeps the JVM alive; nothing else to do on the main thread.
        } catch (Exception e) {
            e.printStackTrace();
            stopServer();
            System.exit(1);
        }
    }

    private static boolean serverUp() {
        try {
            HttpClient c = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
            HttpRequest r =
                    HttpRequest.newBuilder(URI.create(STATUS))
                            .timeout(Duration.ofSeconds(2))
                            .GET()
                            .build();
            HttpResponse<String> resp = c.send(r, HttpResponse.BodyHandlers.ofString());
            return resp.statusCode() == 200 && resp.body().contains("UP");
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean waitUntilUp(Duration timeout) {
        long end = System.currentTimeMillis() + timeout.toMillis();
        while (System.currentTimeMillis() < end) {
            if (serverUp()) return true;
            if (server != null && !server.isAlive()) return false; // crashed during boot
            try {
                Thread.sleep(1500);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private static void startServer() throws Exception {
        Path javaExe = Paths.get(System.getProperty("java.home"), "bin", "java.exe");
        Path appDir = launcherDir();
        Path jar = findStirlingJar(appDir);
        Path logDir = Paths.get(System.getProperty("user.home"), "AppData", "Local", "Stirling-PDF");
        Files.createDirectories(logDir);
        File log = logDir.resolve("server.log").toFile();
        ProcessBuilder pb =
                new ProcessBuilder(
                        javaExe.toString(),
                        "-Dserver.port=" + PORT,
                        "-Dsecurity.enableLogin=false",
                        "-Dstirling.desktop.open-browser=false",
                        "-Xmx2g",
                        "-jar",
                        jar.toString());
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        pb.redirectError(ProcessBuilder.Redirect.appendTo(log));
        server = pb.start();
    }

    /** Directory holding this launcher jar — inside jpackage's {@code <appdir>/app/}. */
    private static Path launcherDir() throws Exception {
        Path self =
                Paths.get(
                        StirlingDesktopLauncher.class
                                .getProtectionDomain()
                                .getCodeSource()
                                .getLocation()
                                .toURI());
        return self.getParent();
    }

    private static Path findStirlingJar(Path appDir) throws Exception {
        try (Stream<Path> s = Files.list(appDir)) {
            return s.filter(
                            p -> {
                                String n = p.getFileName().toString();
                                return n.startsWith("stirling-pdf") && n.endsWith(".jar");
                            })
                    .findFirst()
                    .orElseThrow(
                            () -> new IllegalStateException("stirling-pdf jar not found in " + appDir));
        }
    }

    private static void openWindow() {
        try {
            // Edge app-mode = chromeless window; `start` resolves msedge via App Paths.
            new ProcessBuilder("cmd", "/c", "start", "", "msedge", "--app=" + URL).start();
        } catch (Exception e) {
            try {
                new ProcessBuilder("cmd", "/c", "start", "", URL).start();
            } catch (Exception ignored) {
                // best effort
            }
        }
    }

    private static void setupTray() {
        if (!SystemTray.isSupported()) return;
        try {
            SystemTray tray = SystemTray.getSystemTray();
            BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = img.createGraphics();
            g.setColor(new Color(0xD8, 0x1B, 0x60));
            g.fillRoundRect(0, 0, 16, 16, 4, 4);
            g.setColor(Color.WHITE);
            g.drawString("S", 4, 12);
            g.dispose();

            PopupMenu menu = new PopupMenu();
            MenuItem open = new MenuItem("Open Stirling-PDF");
            open.addActionListener(e -> openWindow());
            MenuItem quit = new MenuItem("Quit");
            quit.addActionListener(e -> shutdown(0));
            menu.add(open);
            menu.addSeparator();
            menu.add(quit);

            trayIcon = new TrayIcon(img, "Stirling-PDF (Clevai)", menu);
            trayIcon.setImageAutoSize(true);
            trayIcon.addActionListener(e -> openWindow());
            tray.add(trayIcon);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static void stopServer() {
        Process s = server;
        if (s != null && s.isAlive()) {
            s.destroy();
            try {
                if (!s.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                    s.destroyForcibly();
                }
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                s.destroyForcibly();
            }
        }
    }

    private static void shutdown(int code) {
        try {
            stopServer();
            if (trayIcon != null) {
                SystemTray.getSystemTray().remove(trayIcon);
            }
        } catch (Exception ignored) {
            // best effort
        }
        System.exit(code);
    }
}
