# koishi-plugin-mc-minekuai

[![npm](https://img.shields.io/npm/v/koishi-plugin-mc-minekuai?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mc-minekuai)

基于麦块（MineKuai）联机平台的 Minecraft 服务器状态查询与远程管理 Koishi 插件。

## 功能特性

- 查询 Minecraft 服务器状态（在线人数、版本、MOTD 等）
- 支持在群组中按服务器 ID 或直接输入 IP 地址查询
- 通过麦块 API 远程管理服务器电源（启动、关闭、重启、强制关闭、强制重启）
- 查看麦块实例信息与资源使用情况（CPU、内存、磁盘、网络、运行时长）
- 向服务器控制台发送指令
- 查看与修改服务器启动变量
- 读取服务器文件内容（上限 1MB）
- 查询可切换游戏列表，切换游戏 / 我的世界整合包
- 按文档 HTTP 状态码（401/403/404/409/422/429）映射中文错误提示

## 配置项

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `minekuaiApiUrl` | 麦块 API 地址 | `https://api.minekuai.cn/panel/client-api` |
| `apiKey` | 麦块 API 密钥（`mkc_` 开头完整字符串，不会明文显示） | - |
| `showIpInDetail` | 在查询详细状态时显示服务器 IP 地址 | `true` |
| `servers` | 服务器列表 | - |

### 服务器列表项

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `name` | 服务器名称 | `Minecraft 服务器` |
| `address` | 服务器地址（格式：`IP:端口`） | `127.0.0.1:25565` |
| `serverType` | 服务器类型（`java` / `bedrock`） | `java` |
| `timeout` | 查询超时时间（秒） | `5.0` |
| `minekuaiInstanceId` | 麦块实例 ID（8 位短 UUID，用于远程管理） | - |

## 指令

### 默认权限（1 级，普通用户可用）

| 指令 | 说明 |
| --- | --- |
| `mc/查服 [target]` | 查询服务器状态。不带参数时汇总所有服务器，带服务器 ID 查询详细信息，也可直接输入 IP 地址 |
| `mc/开服 <id>` | 启动指定 ID 的麦块服务器 |
| `mc/重启 <id>` | 重启指定 ID 的麦块服务器 |
| `mc/强制重启 <id>` | 强制重启指定 ID 的麦块服务器（stop → kill → start） |
| `mc/资源 <id>` | 查看指定 ID 的麦块服务器资源使用情况 |

### 3 级权限（管理员可用）

| 指令 | 说明 |
| --- | --- |
| `mc/关服 <id>` | 正常关闭指定 ID 的麦块服务器（stop） |
| `mc/强关 <id>` | 强制关闭指定 ID 的麦块服务器（kill） |
| `mc/查实例` | 查询麦块 API 实例列表，获取各实例 identifier 与运行状态 |
| `mc/实例 <id>` | 查询指定 ID 的麦块实例信息与实时状态 |
| `mc/发指令 <id> <command>` | 向服务器控制台发送一条命令 |
| `mc/变量 <id>` | 查看服务器启动变量与启动命令 |
| `mc/改变量 <id> <key> <value>` | 修改服务器单个启动变量 |
| `mc/文件 <id> <path>` | 读取服务器文件内容（上限 1MB，超出截断显示） |
| `mc/游戏列表 <id>` | 查看当前套餐可切换的游戏列表 |
| `mc/切换游戏 <id> <gameType>` | 切换游戏（会清空实例文件，60 秒冷却） |
| `mc/切换整合包 <id> <modpack>` | 切换我的世界整合包（会清空实例文件，60 秒冷却）。纯数字按 `modpack_id`，否则按 `file_name` |

## 依赖

- [`mc-server-util`](https://www.npmjs.com/package/mc-server-util)：用于查询 Minecraft 服务器状态。

## License

MIT
