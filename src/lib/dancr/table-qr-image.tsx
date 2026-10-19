import { ImageResponse } from "next/og";
import QRCode from "qrcode";

// Keep the label and attribution inside the PNG so downloads and print packs
// carry the same table identity, even when the image is used on its own.
export async function createTableQrImage(url: string, label: string): Promise<string> {
  const qr = await QRCode.toDataURL(url, { width: 512, margin: 4, errorCorrectionLevel: "M" });
  const labelLines = Array.from(label).reduce<string[]>((lines, character, index) => {
    const line = Math.floor(index / 30);
    lines[line] = (lines[line] || "") + character;
    return lines;
  }, []);
  const labelSize = Math.min(44, Math.floor(640 / Math.max(1, ...labelLines.map(line => Array.from(line).length))));
  const image = new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", height: "100%", background: "#fff", color: "#111" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 664, height: 88, fontSize: labelSize, lineHeight: 1.2, fontWeight: 700 }}>
        {labelLines.map((line, index) => <div key={index} style={{ display: "flex" }}>{line}</div>)}
      </div>
      <img src={qr} width={512} height={512} alt="Table QR code" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 120, lineHeight: 1.4 }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>Powered by Mydancr</div>
        <div style={{ display: "flex", fontSize: 26 }}>www.mydancr.com</div>
      </div>
    </div>,
    { width: 720, height: 720 },
  );
  return `data:image/png;base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;
}
