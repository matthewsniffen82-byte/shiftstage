package com.mydancr.stickers;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class AdminApi {
    static final String ORIGIN = "https://www.mydancr.com";
    static final String TABLES = "/api/admin/venues/internal-nfc";
    private static String access = "", refresh = "";
    private static String siteCookie = "";

    static synchronized boolean signedIn() { return !access.isEmpty(); }

    static final class SignInRequired extends IOException {}
    static final class SiteLocked extends IOException {}

    static synchronized void unlock(String password) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(ORIGIN + "/site-unlock").openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Origin", ORIGIN);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(("password=" + URLEncoder.encode(password, "UTF-8")).getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            if (status == 429) throw new IOException("Too many attempts. Wait a few minutes and try again.");
            if (status != 303) throw new IOException("Unable to unlock MyDancr. Check the site password and try again.");
            String cookie = connection.getHeaderField("Set-Cookie");
            if (cookie != null && cookie.startsWith("__Host-mydancr_site_access=")) siteCookie = cookie.split(";", 2)[0];
        } finally { connection.disconnect(); }
    }

    static synchronized JSONObject request(String path, JSONObject input, boolean admin) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(ORIGIN + path).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Origin", ORIGIN);
        if (!siteCookie.isEmpty()) connection.setRequestProperty("Cookie", siteCookie);
        if (admin && !access.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + access);
            connection.setRequestProperty("x-dancr-refresh-token", refresh);
        }
        try {
            if (input != null) {
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(input.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("Open the programmer from the production Site Admin.");
            try (InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                if (in == null) throw new IOException("MyDancr could not complete this request.");
                byte[] buffer = new byte[4096];
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (out.size() + count > 2097152) throw new IOException("Unable to read the MyDancr response.");
                    out.write(buffer, 0, count);
                }
                JSONObject result = new JSONObject(out.toString("UTF-8"));
                if (status == 401 && "SITE_LOCKED".equals(result.optString("code"))) throw new SiteLocked();
                if (status == 401 && admin) {
                    access = ""; refresh = "";
                    throw new SignInRequired();
                }
                if (status != 200 || !result.optBoolean("ok")) throw new IOException(result.optString("error", "MyDancr could not complete this request."));
                JSONObject session = result.optJSONObject("session");
                if (session != null && (admin || path.equals("/api/auth"))) {
                    access = session.getString("accessToken");
                    refresh = session.getString("refreshToken");
                }
                return result;
            }
        } finally { connection.disconnect(); }
    }
}
