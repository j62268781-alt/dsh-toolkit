import type { IncomingMessage, ServerResponse } from 'node:http';
/** Read a UTF-8 request body without accepting more than the route's byte limit. */
export declare function readBody(req: IncomingMessage, maxBytes: number): Promise<string>;
/**
 * Read a UTF-8 request body with a hard limit on decoded characters.
 *
 * `readBody` counts bytes, which is the wrong unit for a JSON body whose limit was
 * chosen in characters: one emoji costs four bytes, so a byte guard rejects bodies
 * the caller was told it could send. The limit has to stay on `raw.length`.
 *
 * An oversized body is never answered: the request is destroyed and `onBody` is not
 * called, because a receipt written after `destroy()` would race the connection the
 * caller is waiting on (and the caller already got a dead socket).
 */
export declare function readCharBody(req: IncomingMessage, maxChars: number, onBody: (raw: string) => void): void;
/** Send the JSON receipt used by the toolkit's command routes. */
export declare function sendJson(res: ServerResponse, status: number, payload: unknown): void;
//# sourceMappingURL=http.d.ts.map