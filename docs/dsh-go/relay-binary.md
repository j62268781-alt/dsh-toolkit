# dsh-go 客户端补丁：二进制中继帧（`transport.relay.bin.v1`）

配套的服务端改动已经在本仓库 `server/` 里（提交 `900f8cb`）。这个目录放的是 **dsh-go 端**要打的补丁：
`relay-binary.patch` 直接 `git apply` 到 https://github.com/ccch1mneyyy/dsh-Go 的 `main`。

## 为什么

手机和桌面之间走「中继」时，一帧是这样发出的（`ds-harness-remote` 的 host 侧与 `packages/dsh_remote` 的
client 侧都是这个形状）：

```json
{"v":1,"id":"...","type":"relay","payload":{"connectionId":"…","targetDeviceId":"…","counter":42,"ciphertext":"<base64url>"}}
```

`ciphertext` 是 48 KiB 的 Noise 分片（`SECURE_FRAGMENT_CHUNK_BYTES`），base64url 之后变成 64 KiB 字符，
再加 JSON 外壳约 220B：

| 形式 | 载荷 | 线上字节 | 相对载荷 |
| --- | --- | --- | --- |
| 现在的文本帧（base64url + JSON） | 49152 B | 65712 B | 1.338× |
| 二进制帧（version + uuid + counter + 明文） | 49152 B | 49177 B | 1.0005× |

也就是**同样的带宽能多运 33% 的字节**；文件传输因为 RPC 层已经 base64 过一次（1.333×），
双层 base64（1.78×）会降到单层（1.33×），有效吞吐约 342 KB/s → 469 KB/s（5 Mbps 出口）。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `packages/dsh_remote/lib/src/protocol/control.dart` | 新增常量 `relayBinaryCapability` / `relayBinaryVersion` / `relayBinaryHeaderBytes`，以及 `encodeRelayBinaryFrame` / `decodeRelayBinaryFrame`（零拷贝 `Uint8List.sublistView`） |
| `packages/dsh_remote/lib/dsh_remote.dart` | 导出上述符号 |
| `packages/dsh_remote/lib/src/transport/relay_transport.dart` | 两个 offered 列表加入该能力；`hello.ack` 里若服务器也回显则 `_relayBinary = true`；`_onMessage` 接受二进制帧（未协商时视为 `INVALID_MESSAGE`，终态不重试）；`send()` 在协商后把密文直接写二进制帧 |
| `packages/dsh_remote/test/relay_binary_test.dart` | 新增：协商后二进制双向收发、线上字节数 == 25 + 载荷、且不再出现文本 relay 帧；未协商收到二进制则终态报错 |
| `packages/dsh_remote/test/{relay_attach,webrtc_transport}_test.dart` | 能力列表期望值追加一项 |

线格式（大端，25 字节头）：

```
offset 0        1  byte   version = 1
offset 1       16  byte   connectionId (UUID 去掉连字符的 16 字节)
offset 17       8  byte   counter (uint64)
offset 25       N  byte   ciphertext（Noise 分片原文）
```

## 兼容性

- **服务器没回显能力 → 一切照旧**（文本帧），老服务器、官方云端、官方 Host 都不受影响；
  官方桌面 Host 不 offer 这个能力，所以收益只出现在「手机 ⇄ 我们自建/云服务器」这一段，
  与 Host 无关，不需要改 `ds-harness-remote`。
- 协商是**逐方向**的：服务器沿用它已有的转发规则——对端也声明了才转二进制，否则重新 base64 成文本帧。
- 能力列表是白名单过滤 + 交集（`acceptNegotiatedCapabilities`），多 offer 一个未知能力对老服务端无副作用。

## 应用与验证

```bash
git clone https://github.com/<your-fork>/dsh-Go && cd dsh-Go
git apply /path/to/dsh-toolkit/docs/dsh-go/relay-binary.patch

cd packages/dsh_remote
dart pub get
dart analyze lib test            # 期望 No issues found
dart test test/relay_binary_test.dart
dart test                        # 全量：501 passed / 4 skipped
```

> 本补丁是在 Dart SDK 3.10.7 上验证的（仓库 `pubspec.yaml` 声明 `^3.11.0`，本地验证时临时放宽到
> `^3.10.0`，**这处放宽不属于补丁内容**）。

## 服务端要求

`server/` ≥ `900f8cb`。服务端在 `hello.ack` 里回显 `transport.relay.bin.v1` 后才会转二进制；
未回显时客户端继续用文本帧。部署后可在日志里看到 `relayBinary: true` 的 peer（同一 link 上两端都声明时才全程零拷贝）。

## 下一步（还没做，按收益排序）

1. **首连提速（happy eyeballs）**：TURN 不可用时客户端现在要等两轮 WebRTC 超时（每轮 12–15s）才落到中继，
   最坏 24s。可以改成「直连与中继并行竞速，先通者胜」，纯 dsh-go 改动。
2. `compactHistory` 默认打开（减少首屏历史字节）。
3. 服务端 `relay.attach` 数据面（协议与 dsh-go 侧都已就绪，只差服务器签发分配与数据 socket）。