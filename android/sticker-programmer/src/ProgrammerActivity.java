package com.mydancr.stickers;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.IsoDep;
import android.nfc.tech.Ndef;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ProgrammerActivity extends Activity {
    private static final String UUID = "(?i)[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}";
    private enum Scan { NONE, PROGRAM, TEST }
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scanning = new AtomicBoolean();
    private NfcAdapter adapter;
    private volatile Scan scan = Scan.NONE;
    private volatile boolean foreground;
    private LinearLayout panel;
    private String venueId, tableId, title = "Table sticker setup";
    private JSONObject assignment;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        adapter = NfcAdapter.getDefaultAdapter(this);
        Uri uri = getIntent().getData();
        if (uri == null || !"mydancr-sticker".equals(uri.getScheme()) || !"program".equals(uri.getHost())
            || uri.getPathSegments().size() != 2 || !uri.getPathSegments().get(0).matches(UUID) || !uri.getPathSegments().get(1).matches(UUID)) {
            screen("In Site Admin, open a table’s Sticker setup and tap Program this table.");
            button("Open Site Admin", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(AdminApi.ORIGIN + "/admin"))));
            return;
        }
        venueId = uri.getPathSegments().get(0);
        tableId = uri.getPathSegments().get(1);
        loadTable();
    }

    @Override public void onResume() { super.onResume(); foreground = true; if (scan != Scan.NONE) reader(); }
    @Override public void onPause() {
        foreground = false;
        if (adapter != null) adapter.disableReaderMode(this);
        super.onPause();
    }
    @Override public void onDestroy() { worker.shutdownNow(); super.onDestroy(); }

    private void show(Runnable draw) {
        runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) draw.run(); });
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void screen(String message) {
        ScrollView scroll = new ScrollView(this);
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(24), dp(32), dp(24), dp(24));
        scroll.addView(panel);
        setContentView(scroll);
        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextSize(24);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        panel.addView(heading);
        TextView body = new TextView(this);
        body.setText(message);
        body.setTextSize(17);
        body.setPadding(0, dp(12), 0, dp(18));
        panel.addView(body);
    }

    private void button(String label, Runnable action) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(view -> action.run());
        panel.addView(b);
    }

    private EditText field(String hint, int type) {
        EditText edit = new EditText(this);
        edit.setSingleLine(true);
        edit.setInputType(type);
        edit.setHint(hint);
        panel.addView(edit);
        return edit;
    }

    private void signIn(String message) {
        screen(message.isEmpty() ? "Sign in with your MyDancr Site Admin account." : message);
        EditText username = field("Admin username", InputType.TYPE_CLASS_TEXT);
        EditText password = field("Password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        button("Sign in", () -> {
            String user = username.getText().toString().trim(), pass = password.getText().toString();
            if (user.isEmpty() || pass.isEmpty()) return;
            password.setText("");
            screen("Signing in…");
            worker.execute(() -> {
                try {
                    AdminApi.request("/api/auth", new JSONObject().put("mode", "login").put("role", "admin")
                        .put("username", user).put("password", pass), false);
                    show(this::loadTable);
                } catch (AdminApi.SiteLocked e) { show(() -> sitePassword("")); }
                catch (Exception e) { show(() -> signIn(message(e))); }
            });
        });
    }

    private void sitePassword(String message) {
        screen(message.isEmpty() ? "MyDancr requires its site access password on this device." : message);
        EditText password = field("Site access password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        button("Unlock MyDancr", () -> {
            String value = password.getText().toString();
            password.setText("");
            screen("Unlocking MyDancr…");
            worker.execute(() -> {
                try {
                    AdminApi.unlock(value);
                    show(() -> { if (AdminApi.signedIn()) loadTable(); else signIn(""); });
                } catch (Exception e) { show(() -> sitePassword(message(e))); }
            });
        });
    }

    private static String message(Exception e) {
        if (e instanceof android.nfc.TagLostException) return "The phone lost contact. Remove the sticker, then retry and hold it still.";
        if (e.getClass() == IOException.class && e.getMessage() != null) return e.getMessage();
        return "Setup could not finish. Check your connection and hold the same sticker against the phone when prompted.";
    }

    private void failed(Exception error) {
        show(() -> {
            stopReading();
            if (error instanceof AdminApi.SiteLocked) { sitePassword(""); return; }
            if (error instanceof AdminApi.SignInRequired) { signIn(""); return; }
            screen(message(error));
            button("Reload table", this::loadTable);
        });
    }

    private void loadTable() {
        screen("Loading your table…");
        worker.execute(() -> {
            try {
                JSONArray tables = AdminApi.request(AdminApi.TABLES + "?venueId=" + venueId, null, true).getJSONArray("links");
                for (int i = 0; i < tables.length(); i++) {
                    JSONObject row = tables.getJSONObject(i);
                    if (!row.getString("id").equals(tableId) || !row.getString("venue_id").equals(venueId)) continue;
                    JSONObject venue = row.optJSONObject("venue");
                    String label = (venue == null ? "" : venue.getString("name") + " · ") + row.getString("label");
                    show(() -> {
                        title = label;
                        assignment = row.optJSONObject("tag");
                        if (!row.optBoolean("active")) { finishPage("This table is disabled."); return; }
                        String status = assignment == null ? "" : assignment.optString("status");
                        if (status.equals("active")) { finishPage("This sticker is active. Customers can tap it to open this table."); return; }
                        if (status.equals("disabled")) { finishPage("This table’s sticker is disabled."); return; }
                        if (assignment != null && !assignment.isNull("verified_at")) { verified(); return; }
                        screen("Hold the sticker still against the back of your phone when prompted.");
                        button("Program sticker", () -> start(Scan.PROGRAM));
                        if (assignment != null) button("Test an already programmed sticker", () -> start(Scan.TEST));
                    });
                    return;
                }
                throw new IOException("This table is unavailable. Choose a table in Site Admin.");
            } catch (Exception e) { failed(e); }
        });
    }

    private JSONObject action(String name) throws Exception {
        return new JSONObject().put("action", name).put("venueId", venueId).put("linkId", tableId);
    }

    private void start(Scan next) {
        if (adapter == null) { finishPage("Use an Android phone with NFC."); return; }
        if (!adapter.isEnabled()) {
            screen("Turn on NFC, then return to this table.");
            button("NFC settings", () -> startActivity(new Intent(Settings.ACTION_NFC_SETTINGS)));
            button("Continue", () -> start(next));
            return;
        }
        screen(next == Scan.PROGRAM ? "Hold the table sticker against your phone until programming finishes." : "Tap the same sticker again to test it.");
        scanning.set(false);
        scan = next;
        reader();
    }

    private void reader() {
        if (!foreground || adapter == null || !adapter.isEnabled()) return;
        Scan expected = scan;
        int flags = NfcAdapter.FLAG_READER_NFC_A;
        if (expected == Scan.PROGRAM) flags |= NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;
        adapter.enableReaderMode(this, tag -> {
            if (!foreground || expected != scan || !scanning.compareAndSet(false, true)) return;
            worker.execute(() -> {
                try {
                    if (expected == Scan.PROGRAM) program(tag);
                    else test(tag);
                } catch (Exception e) { failed(e); }
            });
        }, flags, null);
    }

    private void stopReading() {
        scan = Scan.NONE;
        if (foreground && adapter != null) adapter.disableReaderMode(this);
    }

    private static byte[][] keys(JSONObject json) throws Exception {
        byte[][] keys = new byte[3][];
        if (json != null) {
            String[] names = {"adminKey", "metaKey", "fileKey"};
            for (int i = 0; i < names.length; i++) {
                keys[i] = StickerChip.hex(json.getString(names[i]));
                if (keys[i].length != 16) throw new IOException("Invalid sticker credentials.");
            }
        }
        return keys;
    }

    private void program(Tag tag) throws Exception {
        String uid = StickerChip.hex(tag.getId());
        if (assignment != null && !uid.equalsIgnoreCase(assignment.getString("uid"))) throw new IOException("This sticker belongs to a different assignment. Tap the sticker assigned to this table.");
        IsoDep iso = IsoDep.get(tag);
        if (iso == null) throw new IOException("Use an NTAG 424 DNA sticker.");
        JSONObject programmed;
        try (IsoDep channel = iso) {
            channel.connect();
            channel.setTimeout(3500);
            StickerChip chip = new StickerChip(channel::transceive, tag.getId());
            chip.identify();
            if (assignment == null) chip.checkBlank();
            JSONObject p = AdminApi.request(AdminApi.TABLES, action("phone-prepare").put("uid", uid), true).getJSONObject("programming");
            if (!uid.equalsIgnoreCase(p.getString("uid"))) throw new IOException("Reload the table and check its sticker assignment.");
            byte[] ndef = StickerChip.hex(p.getString("ndefHex"));
            byte[] settings = StickerChip.fileSettings(p.getInt("piccOffset"), p.getInt("macInputOffset"), p.getInt("macOffset"), ndef.length);
            chip.program(ndef, settings, keys(p), keys(p.optJSONObject("recoveryKeys")));
            programmed = new JSONObject().put("uid", uid).put("id", p.getString("tagId")).put("generation", p.getString("generation"));
        }
        show(() -> {
            if (foreground) adapter.ignore(tag, 400, null, null);
            stopReading();
            assignment = programmed;
            screen("Sticker programmed. Move it away from the phone, then tap Test sticker.");
            button("Test sticker", () -> start(Scan.TEST));
        });
    }

    private void test(Tag tag) throws Exception {
        if (!StickerChip.hex(tag.getId()).equalsIgnoreCase(assignment.getString("uid"))) throw new IOException("Tap the same sticker you programmed.");
        Ndef ndef = Ndef.get(tag);
        NdefMessage data = ndef == null ? null : ndef.getCachedNdefMessage();
        if (data == null || data.getRecords().length != 1) throw new IOException("The sticker has no table URL. Reload the table and program it first.");
        NdefRecord record = data.getRecords()[0];
        Uri uri = record.toUri();
        String id = assignment.getString("id");
        if (uri == null || !"https".equals(uri.getScheme()) || !"www.mydancr.com".equals(uri.getAuthority())
            || !("/internal/tap/" + id).equals(uri.getPath())) throw new IOException("The sticker URL does not match this table.");
        JSONObject check = AdminApi.request("/api/internal-tap/" + id,
            new JSONObject().put("e", uri.getQueryParameter("e")).put("c", uri.getQueryParameter("c")), false);
        if (!check.optBoolean("tested")) throw new IOException("Reload this table to check its activation status.");
        show(() -> {
            if (foreground) adapter.ignore(tag, 400, null, null);
            stopReading();
            verified();
        });
    }

    private void verified() {
        screen("Sticker verified. Activate it when this table is ready for customers.");
        button("Activate sticker", () -> {
            screen("Activating sticker…");
            worker.execute(() -> {
                try {
                    AdminApi.request(AdminApi.TABLES, action("activate").put("generation", assignment.getString("generation")), true);
                    show(() -> finishPage("Sticker active. Customers can tap it to open this table."));
                } catch (Exception e) { failed(e); }
            });
        });
    }

    private void finishPage(String text) {
        screen(text);
        button("Done", this::finish);
    }
}
