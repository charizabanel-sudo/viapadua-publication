import { readFileSync } from "node:fs";
import { join } from "node:path";

export const AUTHORIZED_SIGNATURE_PNG = readFileSync(
  join(process.cwd(), "public", "images", "authorized-signature.png"),
);
