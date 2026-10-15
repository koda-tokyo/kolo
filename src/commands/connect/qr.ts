// Terminal QR rendering for `kurahi connect` and the last step of `kurahi init`. Uses the QR encoder
// the WhatsApp login already ships (no new dependency); half-block characters, two rows per line,
// so a code for a 60-character URL fits in about 30 terminal lines.
import qrcode from "qrcode-terminal";

export function renderQrText(input: string): string {
  let out = "";
  qrcode.generate(input, { small: true }, (text: string) => {
    out = text;
  });
  return out.replace(/\s+$/, "");
}
