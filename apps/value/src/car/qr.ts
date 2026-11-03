import QRCode from 'qrcode';

/** An SVG string for `text`; crisp at any print size. Error level M survives a smudge or a fold. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
}
