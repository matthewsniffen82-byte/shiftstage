package com.mydancr.stickers;

import java.io.IOException;
import java.util.Arrays;
import net.bplearning.ntag424.CommandResult;
import net.bplearning.ntag424.CommunicationMode;
import net.bplearning.ntag424.DnaCommunicator;
import net.bplearning.ntag424.command.ChangeKey;
import net.bplearning.ntag424.command.GetCardUid;
import net.bplearning.ntag424.command.GetKeyVersion;
import net.bplearning.ntag424.command.ReadData;
import net.bplearning.ntag424.command.WriteData;
import net.bplearning.ntag424.encryptionmode.AESEncryptionMode;
import net.bplearning.ntag424.util.ThrowableFunction;

/** NTAG 424 DNA file 02. Each authenticated operation starts with a new EV2 session. */
final class StickerChip {
    private static final byte[] FACTORY = new byte[16];
    private static final byte[] FILE = {2};
    private final ThrowableFunction<byte[], byte[], IOException> exchange;
    private final byte[] uid;

    StickerChip(ThrowableFunction<byte[], byte[], IOException> exchange, byte[] uid) {
        this.exchange = exchange;
        this.uid = uid.clone();
    }

    static byte[] hex(String text) {
        if (text.length() % 2 != 0 || !text.matches("[0-9a-fA-F]+")) throw new IllegalArgumentException("Invalid sticker settings.");
        byte[] bytes = new byte[text.length() / 2];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) text.append(Character.forDigit((b >>> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        return text.toString().toUpperCase(java.util.Locale.ROOT);
    }

    private DnaCommunicator select() throws IOException {
        CommandResult result = new CommandResult(exchange.apply(hex("00A4040C07D276000085010100")));
        require(result.status1 == (byte)0x90 && result.status2 == 0, "Use an NTAG 424 DNA sticker.");
        DnaCommunicator selected = new DnaCommunicator();
        selected.setTransceiver(exchange);
        return selected;
    }

    void identify() throws IOException {
        select();
        CommandResult hardware = new CommandResult(exchange.apply(hex("9060000000")));
        require(hardware.status1 == (byte)0x91 && hardware.status2 == (byte)0xaf && hardware.data.length == 7
            && hardware.data[0] == 4 && hardware.data[1] == 4 && hardware.data[3] == 0x30 && hardware.data[5] == 0x11,
            "Use an NTAG 424 DNA sticker.");
        CommandResult software = new CommandResult(exchange.apply(hex("90AF000000")));
        require(software.status1 == (byte)0x91 && software.status2 == (byte)0xaf, "Unable to identify this chip.");
        CommandResult product = new CommandResult(exchange.apply(hex("90AF000000")));
        require(product.status1 == (byte)0x91 && product.status2 == 0 && uid.length == 7 && uid[0] == 4, "Use a sticker with its permanent UID enabled.");
    }

    private static void require(boolean ok, String message) throws IOException {
        if (!ok) throw new IOException(message);
    }

    private DnaCommunicator login(int slot, byte[] key) throws IOException {
        DnaCommunicator comm = select();
        return AESEncryptionMode.authenticateEV2(comm, slot, key) ? comm : null;
    }

    private DnaCommunicator authenticated(int slot, byte[] key) throws IOException {
        DnaCommunicator comm = login(slot, key);
        require(comm != null, "The sticker credentials could not be verified.");
        return comm;
    }

    void checkBlank() throws IOException {
        DnaCommunicator admin = authenticated(0, FACTORY);
        require(Arrays.equals(uid, GetCardUid.run(admin)), "The chip UID changed. Remove the sticker and try again.");
        byte[] header = ReadData.run(admin, CommunicationMode.PLAIN, 2, 0, 5);
        require(header.length == 5 && header[0] == 0 && (header[1] == 0 ||
            (header[1] == 3 && header[2] == (byte)0xd0 && header[3] == 0 && header[4] == 0)),
            "This sticker already contains a record. Choose a blank sticker for this table.");
        authenticated(1, FACTORY);
        authenticated(2, FACTORY);
    }

    // Inspect all three credentials before changing anything. A lost connection after any
    // successful write can resume using the new, previous manual, or factory credential.
    private byte[] current(int slot, byte[] target, byte[] previous) throws IOException {
        boolean versionOne = GetKeyVersion.run(select(), slot) == 1;
        byte[][] candidates = versionOne ? new byte[][] {target, previous, FACTORY} : new byte[][] {FACTORY, previous, target};
        for (byte[] candidate : candidates) {
            if (candidate != null && login(slot, candidate) != null) return candidate;
        }
        throw new IOException("The sticker credentials do not match this table. Check its assignment in Site Admin.");
    }

    static byte[] fileSettings(int picc, int macInput, int mac, int fileLength) throws IOException {
        require(picc >= 7 && macInput == mac && mac >= picc + 32 && mac + 16 == fileLength && fileLength <= 256,
            "Invalid table sticker offsets.");
        byte[] settings = Arrays.copyOf(hex("4000E0C1F012"), 15);
        settings[6] = (byte)picc;
        settings[9] = (byte)macInput;
        settings[12] = (byte)mac;
        return settings;
    }

    static boolean settingsMatch(byte[] data, byte[] expected) {
        if (data.length != expected.length + 4 || data[0] != 0) return false;
        // GetFileSettings adds file type and a three-byte file size to ChangeFileSettings data.
        return Arrays.equals(Arrays.copyOfRange(data, 1, 4), Arrays.copyOfRange(expected, 0, 3))
            && Arrays.equals(Arrays.copyOfRange(data, 7, data.length), Arrays.copyOfRange(expected, 3, expected.length));
    }

    static boolean templateMatches(byte[] read, byte[] ndef, int picc, int mac) {
        if (read.length != ndef.length) return false;
        byte[] template = read.clone();
        Arrays.fill(template, picc, picc + 32, (byte)'0');
        Arrays.fill(template, mac, mac + 16, (byte)'0');
        return Arrays.equals(template, ndef);
    }

    void program(byte[] ndef, byte[] settings, byte[][] target, byte[][] previous) throws IOException {
        byte[][] old = new byte[3][];
        for (int slot = 0; slot < 3; slot++) old[slot] = current(slot, target[slot], previous[slot]);
        DnaCommunicator admin = authenticated(0, old[0]);
        require(Arrays.equals(uid, GetCardUid.run(admin)), "This sticker does not match the table assignment.");
        if (Arrays.deepEquals(old, target)) {
            CommandResult existing = admin.nxpMacCommand((byte)0xf5, FILE, null);
            existing.throwUnlessSuccessful();
            if (settingsMatch(existing.data, settings)) {
                byte[] published = ReadData.run(select(), CommunicationMode.PLAIN, 2, 0, ndef.length);
                if (templateMatches(published, ndef, settings[6] & 255, settings[12] & 255)) return;
                admin = authenticated(0, target[0]);
            }
        }
        for (int slot = 1; slot <= 2; slot++) {
            if (!Arrays.equals(old[slot], target[slot])) ChangeKey.run(admin, slot, old[slot], target[slot], 1);
        }
        // Protect file writes before writing the URL and clear any interrupted SDM configuration.
        admin.nxpEncryptedCommand((byte)0x5f, FILE, hex("0000E0")).throwUnlessSuccessful();
        WriteData.run(admin, CommunicationMode.PLAIN, 2, ndef, 0);
        byte[] read = ReadData.run(admin, CommunicationMode.PLAIN, 2, 0, ndef.length);
        require(Arrays.equals(read, ndef), "The sticker URL could not be verified. Hold it still and retry.");
        admin.nxpEncryptedCommand((byte)0x5f, FILE, settings).throwUnlessSuccessful();
        if (!Arrays.equals(old[0], target[0])) {
            byte[] replacement = Arrays.copyOf(target[0], 17);
            replacement[16] = 1;
            admin.nxpEncryptedCommand((byte)0xc4, new byte[]{0}, replacement).throwUnlessSuccessful();
        }
        DnaCommunicator finalAdmin = authenticated(0, target[0]);
        CommandResult finalFile = finalAdmin.nxpMacCommand((byte)0xf5, FILE, null);
        finalFile.throwUnlessSuccessful();
        require(settingsMatch(finalFile.data, settings), "The sticker file settings could not be verified.");
        authenticated(1, target[1]);
        authenticated(2, target[2]);
    }
}
