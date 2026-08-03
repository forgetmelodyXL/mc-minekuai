# koishi-plugin-mc-minekuai

[![npm](https://img.shields.io/npm/v/koishi-plugin-mc-minekuai?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mc-minekuai)

基于麦块（MineKuai）联机平台的 Minecraft 服务器状态查询与远程管理 Koishi 插件。

## 功能特性

- 查询 Minecraft 服务器状态（在线人数、版本、MOTD 等）
- 支持在群组中按服务器 ID 或直接输入 IP 地址查询
- 通过麦块 API 远程管理服务器（启动、重启、强制重启）
- 查看麦块服务器的资源使用情况（CPU、内存、磁盘、网络、运行时长）

## 配置项

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `minekuaiApiUrl` | 麦块 API 地址 | `https://minekuai.com/api/client` |
| `apiKey` | 麦块 API 密钥（密钥，不会明文显示） | - |
| `showIpInDetail` | 在查询详细状态时显示服务器 IP 地址 | `true` |
| `servers` | 服务器列表 | - |

### 服务器列表项

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `name` | 服务器名称 | `Minecraft 服务器` |
| `address` | 服务器地址（格式：`IP:端口`） | `127.0.0.1:25565` |
| `serverType` | 服务器类型（`java` / `bedrock`） | `java` |
| `timeout` | 查询超时时间（秒） | `5.0` |
| `minekuaiInstanceId` | 麦块实例 ID（可选，用于远程管理） | - |

## 指令

| 指令 | 说明 |
| --- | --- |
| `mc/查服 [target]` | 查询服务器状态。不带参数时汇总所有服务器，带服务器 ID 查询详细信息，也可直接输入 IP 地址 |
| `mc/开服 <id>` | 启动指定 ID 的麦块服务器 |
| `mc/重启 <id>` | 重启指定 ID 的麦块服务器 |
| `mc/强制重启 <id>` | 强制重启指定 ID 的麦块服务器 |
| `mc/资源 <id>` | 查看指定 ID 的麦块服务器资源使用情况 |

## 依赖

- [`mc-server-util`](https://www.npmjs.com/package/mc-server-util)：用于查询 Minecraft 服务器状态。

## License

MIT
