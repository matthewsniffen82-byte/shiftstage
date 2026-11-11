package com.mydancr.stickers;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Queue;

/** Focused tests for the NTAG model gate and file-02 byte layout. */
public final class StickerChipTest {
    public static void main(String[] args) throws Exception {
        Queue<String> commands = new ArrayDeque<>(Arrays.asList("00A4040C07D276000085010100", "9060000000", "90AF000000", "90AF000000"));
        Queue<String> responses = new ArrayDeque<>(Arrays.asList("9000", "0404023000110591AF", "0404020102110591AF", "04000000000000000000000000009100"));
        StickerChip chip = new StickerChip(apdu -> {
            check(StickerChip.hex(apdu).equals(commands.remove()));
            return StickerChip.hex(responses.remove());
        }, StickerChip.hex("04000000000000"));
        chip.identify();
        check(commands.isEmpty());
        StickerChip other = new StickerChip(apdu -> StickerChip.hex(apdu[1] == (byte)0xa4 ? "9000" : "0401023000110591AF"), new byte[7]);
        try { other.identify(); throw new AssertionError("Unexpected chip accepted"); } catch (IOException expected) {}

        byte[] settings = StickerChip.fileSettings(82, 117, 117, 133);
        check(StickerChip.hex(settings).equals("4000E0C1F012520000750000750000"));
        byte[] result = StickerChip.hex("004000E0000100C1F012520000750000750000");
        check(StickerChip.settingsMatch(result, settings));
        result[9] ^= 1;
        check(!StickerChip.settingsMatch(result, settings));
        byte[] ndef = new byte[133];
        Arrays.fill(ndef, 82, 114, (byte)'0');
        Arrays.fill(ndef, 117, 133, (byte)'0');
        byte[] read = ndef.clone();
        Arrays.fill(read, 82, 114, (byte)'A');
        Arrays.fill(read, 117, 133, (byte)'B');
        check(StickerChip.templateMatches(read, ndef, 82, 117));
        read[75] = 1;
        check(!StickerChip.templateMatches(read, ndef, 82, 117));
        try { StickerChip.fileSettings(82, 116, 117, 133); throw new AssertionError("Incorrect MAC input accepted"); } catch (IOException expected) {}
        System.out.println("Sticker protocol checks passed.");
    }
    private static void check(boolean result) { if (!result) throw new AssertionError(); }
}
