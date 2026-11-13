/**
 * iLink 媒体：AES-128-ECB 加解密、CDN 下载/上传地址、图片魔数识别。
 *
 * 协议事实（来自腾讯 openclaw-weixin 与 DSH 版实现的交叉验证）：
 *   · 上行：明文按 AES-128-ECB + PKCS#7 加密，filekey/aeskey 一起提交给
 *     `ilink/bot/getuploadurl`，然后把密文 POST 到 CDN；CDN 在响应头
 *     `x-encrypted-param` 里返回下载用的 encrypted_query_param。
 *   · 下行：优先用 media.full_url，否则拼 `<cdn>/download?encrypted_query_param=…`；
 *     密钥优先 image_item.aeskey（32 位 hex 字符串），其次 media.aes_key（base64）。
 *   · 发出去的 media.aes_key 是「实现里的 hex 字符串再 base64」，与下行的 base64
 *     形式并不对称——这是协议现状，不是笔误。
 *
 * 本文件不访问网络、不依赖宿主，纯函数，便于单测。
 */
/** 官方默认 CDN 网关。 */
export declare const DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
/** getuploadurl 的 media_type 取值。 */
export declare const MEDIA_TYPE: Readonly<{
    image: 1;
    video: 2;
    file: 3;
    voice: 4;
}>;
/** 16 字节随机密钥（AES-128）。 */
export declare function randomKey(): NonSharedBuffer;
/** CDN 上传用的 filekey（16 字节的 hex）。 */
export declare function randomFileKey(): string;
/** AES-128-ECB + PKCS#7 加密。 */
export declare function encryptAesEcb(data: any, key: any): Buffer<ArrayBuffer>;
/** AES-128-ECB + PKCS#7 解密。 */
export declare function decryptAesEcb(data: any, key: any): Buffer<ArrayBuffer>;
/** 把 32 位 hex 字符串解析成 16 字节密钥。 */
export declare function parseHexKey(value: any): Buffer<ArrayBuffer>;
/** 把 base64 密钥解析成 16 字节；兼容「base64 里装的是 32 位 hex」的历史写法。 */
export declare function parseBase64Key(value: any): Buffer<ArrayBuffer>;
/**
 * 取一条入站媒体条目的解密密钥。
 * @param aeskey 图片条目自带的 32 位 hex 密钥（优先）
 * @param media  CDNMedia，可能带 base64 的 aes_key
 * @returns 密钥 Buffer，缺失时返回 undefined（调用方决定是原样使用还是跳过）
 */
export declare function resolveMediaKey(aeskey: any, media: any): Buffer<ArrayBuffer>;
/** 上行 item 里要回填的 aes_key（协议要求：hex 字符串再 base64）。 */
export declare function aesKeyForUpload(key: any): string;
/** 下行 URL：full_url 优先，否则用 CDN 网关拼。 */
export declare function mediaDownloadUrl(media: any, cdnBaseUrl?: string): any;
/** 上行 URL：upload_full_url 优先，否则用 upload_param + filekey 拼。 */
export declare function mediaUploadUrl(upload: any, filekey: any, cdnBaseUrl?: string): any;
/** 文件 md5（hex）。 */
export declare function md5Hex(data: any): string;
/**
 * 从魔数判断图片类型（DSH attachments 只接受 png/jpeg/webp/gif）。
 * @throws 无法识别时抛出可读错误（不猜扩展名）
 */
export declare function detectImageMediaType(data: any): "image/webp" | "image/png" | "image/jpeg" | "image/gif";
//# sourceMappingURL=media.d.ts.map