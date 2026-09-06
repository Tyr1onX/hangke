import bwipjs from "bwip-js/browser";

// The codes contain local focus-session data, not a real airline boarding pass.
export function renderTicketCodes(boarding: string, checkin: string, payload: string) {
  const text = `HANGKE|1|${payload}`;
  for (const prefix of [boarding, checkin]) {
    const qr = document.getElementById(`${prefix}-qr`) as HTMLCanvasElement | null;
    const barcode = document.getElementById(`${prefix}-barcode`) as HTMLCanvasElement | null;
    if (qr) bwipjs.toCanvas(qr, {
      bcid: "qrcode", text, scale: 3, padding: 1,
      barcolor: "202522", backgroundcolor: "E9E4D4",
    });
    if (barcode) bwipjs.toCanvas(barcode, {
      bcid: "code128", text, scale: 2, height: 11, padding: 0,
      includetext: false, barcolor: "202522", backgroundcolor: "E9E4D4",
    });
  }
}
