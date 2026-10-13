import { allow } from '@/lib/shop/rate';
export type RateLimitAction=string;
export function getClientIpHashFromRequest(_:Request){return null;}
export async function consumeRateLimit(_:unknown){return {allowed:false};}
export {allow};
