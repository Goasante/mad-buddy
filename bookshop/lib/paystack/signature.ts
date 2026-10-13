import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function validPaystackSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
