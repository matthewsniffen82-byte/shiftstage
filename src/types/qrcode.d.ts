declare module "qrcode" {
  type QRCodeOptions = {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  };

  const QRCode: {
    toDataURL(text: string, options?: QRCodeOptions): Promise<string>;
  };

  export default QRCode;
}
