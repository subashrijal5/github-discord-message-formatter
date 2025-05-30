
/**
 * Compares two Uint8Arrays in constant time
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a[i] ^ b[i];
	}
	return result === 0;
}

/**
 * Verifies an HMAC SHA-256 signature
 */
export async function verifySignature(secret: string, payload: string, signature: string | undefined): Promise<boolean> {
	if (!signature) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const sigBytes = encoder.encode(signature);
	const data = encoder.encode(payload);

	const rawSignature = await crypto.subtle.sign('HMAC', key, data);
	const hexSignature = Array.from(new Uint8Array(rawSignature))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	const expected = encoder.encode('sha256=' + hexSignature);

	return timingSafeEqual(expected, sigBytes);
}