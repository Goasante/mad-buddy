import "server-only";
export function getPaystackSecretKey(){return process.env.PAYSTACK_SECRET_KEY?.trim();}
export function getPaystackWebhookSecret(){return process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || getPaystackSecretKey();}
