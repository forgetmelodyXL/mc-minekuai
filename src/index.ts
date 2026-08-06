import { Context, Schema } from 'koishi'

let getMinecraftServerStatus: any
import('mc-server-util').then(m => {
  getMinecraftServerStatus = m.getMinecraftServerStatus
})

export const name = 'mc-minekuai'

export interface ServerConfig {
  name: string
  address: string
  serverType: 'java' | 'bedrock'
  timeout: number
  minekuaiInstanceId?: string
}

export interface Config {
  minekuaiApiUrl: string
  apiKey: string
  showIpInDetail: boolean
  servers: ServerConfig[]
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    minekuaiApiUrl: Schema.string().description('麦块API地址').default('https://api.minekuai.cn/panel/client-api'),
    apiKey: Schema.string().description('麦块API密钥(mkc_开头完整字符串)').role('secret'),
  }).description('麦块联机配置'),

  Schema.object({
    showIpInDetail: Schema.boolean().default(true).description('在查询详细状态时显示服务器IP地址')
  }).description('显示配置'),

  Schema.object({
    servers: Schema.array(Schema.object({
      name: Schema.string().description('服务器名称').default('Minecraft 服务器'),
      address: Schema.string().description('服务器地址(格式: IP:端口)').default('127.0.0.1:25565'),
      serverType: Schema.union(['java', 'bedrock']).description('服务器类型').default('java'),
      timeout: Schema.number().description('查询超时时间(秒)').default(5.0),
      minekuaiInstanceId: Schema.string().description('麦块实例ID(8位短UUID)'),
    })).description('服务器列表').role('table'),
  }).description('服务器配置'),
])

export function apply(ctx: Context, config: Config) {
  function parseServerAddress(hostString: string, defaultPort: number) {
    if (hostString.includes(':')) {
      const [host, portStr] = hostString.split(':')
      const port = parseInt(portStr)
      return {
        host: host,
        port: isNaN(port) ? defaultPort : port
      }
    }
    return {
      host: hostString,
      port: defaultPort
    }
  }

  async function queryServerStatus(server: ServerConfig) {
    try {
      if (!getMinecraftServerStatus) {
        throw new Error('mc-server-util 模块未正确加载')
      }

      const { host, port } = parseServerAddress(server.address, 25565)
      const timeout = (server.timeout || 5.0) * 1000

      let result
      if (server.serverType === 'bedrock') {
        throw new Error('Bedrock服务器暂不支持')
      } else {
        result = await getMinecraftServerStatus(host, port, {
          timeout: timeout,
          debug: false
        })
      }

      return {
        success: true,
        data: result,
        server: server
      }
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error)

      errorMessage = errorMessage.replace(/connect ECONNREFUSED/i, '服务器已关闭')
      errorMessage = errorMessage.replace(/connect ETIMEDOUT/i, '网络波动，请稍后尝试')
      errorMessage = errorMessage.replace(/connect ENOTFOUND/i, '网络波动，请稍后尝试')
      errorMessage = errorMessage.replace(/getaddrinfo EAI_AGAIN/i, '网络波动，请稍后尝试')
      errorMessage = errorMessage.replace(/^Connection$/i, '连接失败')

      errorMessage = errorMessage.replace(/\s+(\d+\.\d+\.\d+\.\d+):\d+/, '')
      errorMessage = errorMessage.replace(/\s+[\w.-]+$/, '')
      errorMessage = errorMessage.replace(/\s+[a-zA-Z0-9][a-zA-Z0-9.-]*:[0-9]+/, '')

      return {
        success: false,
        error: errorMessage,
        server: server
      }
    }
  }

  function getServerName(server: ServerConfig) {
    return server.name || 'Minecraft 服务器'
  }

  // 按文档状态码映射友好错误信息
  function mapApiError(status: number, error: any): string {
    const serverMsg = (error && (error.error || error.message)) || String(error || '未知错误')
    switch (status) {
      case 401: return `API密钥无效或未授权: ${serverMsg}`
      case 403: return `无权限或IP被白名单拒绝: ${serverMsg}`
      case 404: return `实例不存在: ${serverMsg}`
      case 409: return `实例状态不允许此操作: ${serverMsg}`
      case 422: return `参数错误: ${serverMsg}`
      case 429: return `请求过于频繁，已触发限流(300次/分钟或60秒冷却)`
      default: return serverMsg
    }
  }

  function resolveServer(id: number): ServerConfig {
    const servers = config.servers || []
    const server = id >= 1 ? servers[id - 1] : undefined
    if (!server) {
      throw new Error(`未找到ID为 ${id} 的服务器，请使用"查服"查看服务器列表`)
    }
    if (!server.minekuaiInstanceId) {
      throw new Error(`${server.name} 未配置麦块实例ID`)
    }
    return server
  }

  // 通用API请求(无重试，用于读操作)
  async function minekuaiRequest(method: 'GET' | 'POST' | 'PUT', path: string, body?: any) {
    if (!config.apiKey) {
      throw new Error('未配置麦块API密钥，请在插件配置中设置 apiKey')
    }
    const baseUrl = config.minekuaiApiUrl.replace(/\/+$/, '')
    const url = `${baseUrl}${path}`
    const headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
    const data = body ? JSON.stringify(body) : undefined
    try {
      if (method === 'GET') {
        return await ctx.http.get(url, { headers })
      } else if (method === 'PUT') {
        return await ctx.http.put(url, data, { headers })
      } else {
        return await ctx.http.post(url, data, { headers })
      }
    } catch (error: any) {
      const status = error?.response?.status || error?.status || 0
      const respData = error?.response?.data || error?.data
      ctx.logger.warn(`麦块API ${method} ${path} 失败: status=${status}`, respData || error)
      throw new Error(mapApiError(status, respData || error))
    }
  }

  // 电源操作请求(带重试，用于电源/动作类)
  async function minekuaiPowerRequest(instanceId: string, operation: string, maxRetries = 3) {
    if (!config.apiKey) {
      throw new Error('未配置麦块API密钥，请在插件配置中设置 apiKey')
    }
    const baseUrl = config.minekuaiApiUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/servers/${instanceId}/power`
    const headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
    const body = JSON.stringify({ signal: operation })

    let lastError: any
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ctx.http.post(url, body, { headers })
        ctx.logger.info(`麦块API电源请求成功: 实例 ${instanceId} 操作 ${operation} (第${attempt}次尝试)`)
        return response
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status || error?.status || 0
        ctx.logger.warn(`麦块API电源请求失败 (第${attempt}次尝试): status=${status}`, error)
        // 4xx(除429)为确定性错误，不重试
        if (status >= 400 && status < 500 && status !== 429) {
          const respData = error?.response?.data || error?.data
          throw new Error(mapApiError(status, respData || error))
        }
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    const status = lastError?.response?.status || lastError?.status || 0
    const respData = lastError?.response?.data || lastError?.data
    throw new Error(`麦块API请求失败，已重试${maxRetries}次: ${mapApiError(status, respData || lastError)}`)
  }

  function formatState(state: string): string {
    const map: Record<string, string> = {
      running: '运行中',
      offline: '已关闭',
      starting: '启动中',
      stopping: '关闭中',
      restarting: '重启中',
    }
    return map[state] || state || '未知'
  }

  // ============ 电源控制命令 ============

  ctx.guild()
    .command('mc/开服 <id:number>', '启动麦块服务器')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：开服 1'
      try {
        const server = resolveServer(id)
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'start', 3)
        return `✅ 已发送启动指令到 ${server.name} (ID: ${id})`
      } catch (error) {
        return `❌ 启动服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/关服 <id:number>', '正常关闭麦块服务器', { authority: 3 })
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：关服 1'
      try {
        const server = resolveServer(id)
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'stop', 3)
        return `✅ 已发送关闭指令到 ${server.name} (ID: ${id})`
      } catch (error) {
        return `❌ 关闭服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/重启 <id:number>', '重启麦块服务器')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：重启 1'
      try {
        const server = resolveServer(id)
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'restart', 3)
        return `✅ ${server.name} 重启指令已发送完成，请稍后检查服务器状态`
      } catch (error) {
        return `❌ 重启服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/强关 <id:number>', '强制关闭麦块服务器(kill)', { authority: 3 })
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：强关 1'
      try {
        const server = resolveServer(id)
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'kill', 3)
        return `✅ 已发送强制关闭指令到 ${server.name} (ID: ${id})`
      } catch (error) {
        return `❌ 强制关闭服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/强制重启 <id:number>', '强制重启麦块服务器(stop→kill→start)')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：强制重启 1'
      try {
        const server = resolveServer(id)
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'stop', 3)
        await new Promise(resolve => setTimeout(resolve, 1000))
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'kill', 3)
        await new Promise(resolve => setTimeout(resolve, 3000))
        await minekuaiPowerRequest(server.minekuaiInstanceId, 'start', 3)
        return `✅ ${server.name} 强制重启指令已发送完成，请稍后检查服务器状态`
      } catch (error) {
        return `❌ 强制重启服务器失败: ${error.message}`
      }
    })

  // ============ 实例信息与资源 ============

  ctx.guild()
    .command('mc/查实例', '查询麦块API实例列表', { authority: 3 })
    .action(async ({ session }) => {
      if (!config.apiKey) return '❌ 未配置麦块API密钥，请在插件配置中设置 apiKey'
      try {
        const resp = await minekuaiRequest('GET', `/servers?per_page=50`)
        const items = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : [])
        if (items.length === 0) return '⚠️ 未查询到任何实例'

        let message = `📋 麦块实例列表 (共${items.length}个)\n\n`
        items.forEach((item: any, idx: number) => {
          const attr = item.attributes || item
          const identifier = attr.identifier || attr.id || '?'
          const name = attr.name || '未命名'
          const state = formatState(attr.current_state || attr.status || '未知')
          message += `[${idx + 1}] ${name}\n`
          message += `    ID: ${identifier} | 状态: ${state}\n`
        })
        message += `\n💡 实例ID即上述 identifier(8位短UUID)，可在插件配置中填入对应服务器的 minekuaiInstanceId`
        return message
      } catch (error) {
        return `❌ 查询实例列表失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/实例 <id:number>', '查询麦块实例信息与实时状态', { authority: 3 })
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：实例 1'
      try {
        const server = resolveServer(id)
        const resp = await minekuaiRequest('GET', `/servers/${server.minekuaiInstanceId}`)
        const attr = resp.attributes || resp
        const state = formatState(attr.current_state || '未知')
        const suspended = attr.is_suspended ? '是' : '否'
        const name = attr.name || server.name
        const limits = attr.limits || {}
        const feat = attr.feature_limits || {}

        let message = `📋 ${name} 实例信息\n`
        message += `🆔 标识: ${attr.identifier || server.minekuaiInstanceId}\n`
        message += `🔄 状态: ${state}\n`
        message += `⏸️ 暂停: ${suspended}\n`
        if (limits.memory) message += `💾 内存上限: ${limits.memory}MB\n`
        if (limits.swap) message += `💾 Swap上限: ${limits.swap}MB\n`
        if (limits.disk) message += `💿 磁盘上限: ${limits.disk}MB\n`
        if (limits.cpu) message += `🖥️ CPU上限: ${limits.cpu}%\n`
        if (feat.databases) message += `🗄️ 数据库: ${feat.databases}\n`
        if (feat.allocations) message += `🌐 端口分配: ${feat.allocations}\n`
        if (feat.backups) message += `💾 备份: ${feat.backups}\n`
        message += `⏰ 查询时间: ${new Date().toLocaleString('zh-CN')}`
        return message
      } catch (error) {
        return `❌ 查询实例信息失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/资源 <id:number>', '查看麦块服务器资源使用情况')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：资源 1'
      try {
        const server = resolveServer(id)
        const resp = await minekuaiRequest('GET', `/servers/${server.minekuaiInstanceId}`)
        const attributes = resp.attributes || resp
        const resources = attributes.resources || {}
        const currentState = attributes.current_state || '未知'
        const isSuspended = attributes.is_suspended

        const memoryUsed = (resources.memory_bytes || 0) / 1024 / 1024 / 1024
        const cpuUsage = resources.cpu_absolute || 0
        const diskUsed = (resources.disk_bytes || 0) / 1024 / 1024 / 1024
        const uptime = resources.uptime || 0

        const uptimeDays = Math.floor(uptime / 86400)
        const uptimeHours = Math.floor((uptime % 86400) / 3600)
        const uptimeMinutes = Math.floor((uptime % 3600) / 60)
        const uptimeSeconds = uptime % 60
        const formattedUptime = uptime > 0
          ? `${uptimeDays}天 ${uptimeHours}小时 ${uptimeMinutes}分钟 ${uptimeSeconds}秒`
          : '未运行'

        let message = `📊 ${server.name} 资源使用情况\n`
        message += `📋 状态: ${formatState(currentState)}\n`
        message += `🔄 暂停: ${isSuspended ? '是' : '否'}\n`
        message += `🖥️ CPU: ${cpuUsage.toFixed(2)}%\n`
        message += `💾 内存: ${memoryUsed.toFixed(2)}GB\n`
        message += `💿 磁盘: ${diskUsed.toFixed(2)}GB\n`
        message += `📡 网络接收: ${((resources.network_rx_bytes || 0) / 1024 / 1024).toFixed(2)}MB\n`
        message += `📡 网络发送: ${((resources.network_tx_bytes || 0) / 1024 / 1024).toFixed(2)}MB\n`
        message += `⏱️ 运行时间: ${formattedUptime}\n`
        message += `⏰ 查询时间: ${new Date().toLocaleString('zh-CN')}`
        return message
      } catch (error) {
        return `❌ 查询服务器资源使用情况失败: ${error.message}`
      }
    })

  // ============ 控制台命令 ============

  ctx.guild()
    .command('mc/发指令 <id:number> <command:text>', '向服务器控制台发送一条命令', { authority: 3 })
    .action(async ({ session }, id, command) => {
      if (id === undefined) return '请提供服务器ID，例如：发指令 1 say hello'
      if (!command) return '请提供要发送的命令，例如：发指令 1 say hello'
      try {
        const server = resolveServer(id)
        await minekuaiRequest('POST', `/servers/${server.minekuaiInstanceId}/command`, { command })
        return `✅ 已向 ${server.name} 控制台发送指令: ${command}`
      } catch (error) {
        return `❌ 发送指令失败: ${error.message}`
      }
    })

  // ============ 启动变量 ============

  ctx.guild()
    .command('mc/变量 <id:number>', '查看服务器启动变量与启动命令', { authority: 3 })
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：变量 1'
      try {
        const server = resolveServer(id)
        const resp = await minekuaiRequest('GET', `/servers/${server.minekuaiInstanceId}/startup`)
        const variables = resp.data || resp.variables || (Array.isArray(resp) ? resp : [])
        const cmd = resp.startup || resp.startup_command || (resp.attributes && resp.attributes.startup) || ''

        let message = `⚙️ ${server.name} 启动变量\n`
        if (cmd) {
          message += `📝 启动命令: ${cmd}\n\n`
        }
        if (Array.isArray(variables) && variables.length > 0) {
          variables.forEach((v: any) => {
            const attr = v.attributes || v
            const name = attr.name || attr.env_variable || '?'
            const val = attr.server_value ?? attr.value ?? ''
            const rules = attr.rules || ''
            message += `• ${name} = ${val}\n`
            if (rules) message += `    规则: ${rules}\n`
          })
        } else {
          message += '⚠️ 未获取到变量列表'
        }
        return message
      } catch (error) {
        return `❌ 查询启动变量失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/改变量 <id:number> <key:string> <value:text>', '修改服务器单个启动变量', { authority: 3 })
    .action(async ({ session }, id, key, value) => {
      if (id === undefined) return '请提供服务器ID，例如：改变量 1 MAX_PLAYERS 20'
      if (!key) return '请提供变量名，例如：改变量 1 MAX_PLAYERS 20'
      if (value === undefined || value === null) return '请提供变量值，例如：改变量 1 MAX_PLAYERS 20'
      try {
        const server = resolveServer(id)
        await minekuaiRequest('PUT', `/servers/${server.minekuaiInstanceId}/startup/variable`, { key, value })
        return `✅ 已修改 ${server.name} 的变量 ${key} = ${value}`
      } catch (error) {
        return `❌ 修改变量失败: ${error.message}`
      }
    })

  // ============ 文件读取 ============

  ctx.guild()
    .command('mc/文件 <id:number> <path:text>', '读取服务器文件内容(上限1MB)', { authority: 3 })
    .action(async ({ session }, id, path) => {
      if (id === undefined) return '请提供服务器ID，例如：文件 1 /server.properties'
      if (!path) return '请提供文件路径，例如：文件 1 /server.properties'
      try {
        const server = resolveServer(id)
        const baseUrl = config.minekuaiApiUrl.replace(/\/+$/, '')
        const url = `${baseUrl}/servers/${server.minekuaiInstanceId}/files/contents?file=${encodeURIComponent(path)}`
        const headers = {
          'Authorization': `Bearer ${config.apiKey}`,
          'Accept': 'text/plain, application/json',
        }
        let text: string
        try {
          text = await ctx.http.get(url, { headers })
        } catch (error: any) {
          const status = error?.response?.status || error?.status || 0
          const respData = error?.response?.data || error?.data
          throw new Error(mapApiError(status, respData || error))
        }
        const MAX = 3000
        let display = text || '(空文件)'
        let truncated = false
        if (text && text.length > MAX) {
          display = text.slice(0, MAX)
          truncated = true
        }
        let message = `📄 ${server.name} 文件: ${path}\n`
        message += `📏 大小: ${text ? text.length : 0} 字节\n\n`
        message += display
        if (truncated) message += `\n\n…(已截断，仅显示前${MAX}字符)`
        return message
      } catch (error) {
        return `❌ 读取文件失败: ${error.message}`
      }
    })

  // ============ 游戏切换 ============

  ctx.guild()
    .command('mc/游戏列表 <id:number>', '查看当前套餐可切换的游戏列表', { authority: 3 })
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：游戏列表 1'
      try {
        const server = resolveServer(id)
        const resp = await minekuaiRequest('GET', `/servers/${server.minekuaiInstanceId}/allowed-games`)
        const games = resp.data || resp.games || (Array.isArray(resp) ? resp : [])
        let message = `🎮 ${server.name} 可切换游戏列表\n\n`
        if (Array.isArray(games) && games.length > 0) {
          games.forEach((g: any, idx: number) => {
            const code = typeof g === 'string' ? g : (g.game_type || g.code || g.id || '?')
            const name = typeof g === 'string' ? g : (g.name || g.display_name || code)
            message += `[${idx + 1}] ${name} (${code})\n`
          })
          message += `\n💡 使用"切换游戏 <ID> <game_type>"进行切换(会清空实例文件)`
        } else {
          message += '⚠️ 未获取到游戏列表'
        }
        return message
      } catch (error) {
        return `❌ 查询游戏列表失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/切换游戏 <id:number> <gameType:string>', '切换游戏(会清空实例文件, 60秒冷却)', { authority: 3 })
    .action(async ({ session }, id, gameType) => {
      if (id === undefined) return '请提供服务器ID，例如：切换游戏 1 minecraft'
      if (!gameType) return '请提供游戏类型，例如：切换游戏 1 minecraft (使用"游戏列表"查看可用值)'
      try {
        const server = resolveServer(id)
        await minekuaiRequest('POST', `/servers/${server.minekuaiInstanceId}/game-switch`, { game_type: gameType })
        return `✅ ${server.name} 已发送切换游戏请求: ${gameType}\n⚠️ 此操作会清空实例文件并重装，60秒冷却`
      } catch (error) {
        return `❌ 切换游戏失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/切换整合包 <id:number> <modpack:text>', '切换我的世界整合包(会清空实例文件, 60秒冷却)', { authority: 3 })
    .action(async ({ session }, id, modpack) => {
      if (id === undefined) return '请提供服务器ID，例如：切换整合包 1 1'
      if (!modpack) return '请提供整合包ID或文件名，例如：切换整合包 1 1 或 切换整合包 1 xxx.zip'
      try {
        const server = resolveServer(id)
        // 纯数字 → modpack_id，否则视为 file_name
        const body = /^\d+$/.test(modpack)
          ? { modpack_id: parseInt(modpack) }
          : { file_name: modpack }
        await minekuaiRequest('POST', `/servers/${server.minekuaiInstanceId}/modpack-switch`, body)
        return `✅ ${server.name} 已发送切换整合包请求: ${modpack}\n⚠️ 此操作会清空实例文件并重装，60秒冷却`
      } catch (error) {
        return `❌ 切换整合包失败: ${error.message}`
      }
    })

  // ============ Minecraft 状态查询(保留原功能) ============

  function formatShortStatus(result: any, server: ServerConfig) {
    const displayName = getServerName(server)
    if (!result.online) {
      return `🔴 ${displayName} - 离线`
    }

    const players = result.players ? `${result.players.online}/${result.players.max}` : 'N/A'
    const version = result.version ? result.version.name : 'N/A'

    return `🟢 ${displayName} - 在线 | 玩家: ${players} | 版本: ${version}`
  }

  function formatDetailedStatus(result: any, server: ServerConfig, showIp: boolean) {
    const displayName = getServerName(server)
    if (!result.online) {
      return `🔴 ${displayName} 当前离线`
    }

    function parseChatComponent(component: any): string {
      if (!component) return ''
      if (typeof component === 'string') return component
      if (typeof component !== 'object') return String(component)

      let text = ''
      if (component.text) {
        text += component.text
      }
      if (component.translate) {
        text += component.translate
      }
      if (Array.isArray(component.extra)) {
        for (const extra of component.extra) {
          text += parseChatComponent(extra)
        }
      }
      if (Array.isArray(component.with)) {
        for (const w of component.with) {
          text += parseChatComponent(w)
        }
      }
      return text
    }

    let motdText = '暂无描述'
    if (result.description) {
      let descriptionStr = parseChatComponent(result.description)
      descriptionStr = descriptionStr.replace(/§[0-9a-fk-or]/gi, '')
      motdText = descriptionStr.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    }

    let message = `🟢 ${displayName} 状态信息\n`

    if (showIp) {
      const { host, port } = parseServerAddress(server.address, 25565)
      message += `📡 地址: ${host}:${port}\n`
    }

    message += `🎮 类型: ${server.serverType || 'Java'}\n`

    if (result.version) {
      message += `📦 版本: ${result.version.name}\n`
    }

    if (result.players) {
      message += `👥 人数: ${result.players.online}/${result.players.max}\n`
      if (result.players.sample && result.players.sample.length > 0) {
        const allPlayers = result.players.sample.map(p => p.name).join(', ')
        message += `👤 在线玩家: ${allPlayers}\n`
      }
    }

    message += `📋 MOTD: ${motdText}\n`
    message += `⏰ 查询时间: ${new Date().toLocaleString('zh-CN')}`

    return message
  }

  ctx.guild()
    .command('mc/查服 [target:text]', '查询Minecraft服务器状态')
    .action(async ({ session }, target) => {
      const servers = config.servers || []

      if (target === undefined) {
        if (servers.length === 0) {
          return '❌ 未配置任何服务器，请在插件配置中添加服务器'
        }

        const queries = servers.map(server => queryServerStatus(server))
        const results = await Promise.all(queries)

        const onlineCount = results.filter(r => r.success && r.data && r.data.online).length

        let message = `📊 服务器状态汇总 (当前在线${onlineCount}/${results.length}台)\n\n`
        results.forEach((result, index) => {
          const serverId = index + 1
          if (result.success) {
            const originalStatus = formatShortStatus(result.data, result.server)
            message += `[${serverId}] ${originalStatus}\n`
          } else {
            message += `[${serverId}] 🔴 ${getServerName(result.server)} - 离线 | 原因：${result.error}\n`
          }
        })

        message += `\n💡 输入"查服+服务器ID"即可查询详细状态，例如：查服 1`
        message += `\n💡 也可以直接输入IP地址查询`

        return message
      }

      // 尝试按服务器ID查找
      const id = parseInt(target)
      const serverById = !isNaN(id) && id >= 1 ? servers[id - 1] : undefined
      if (serverById) {
        const result = await queryServerStatus(serverById)
        if (!result.success) {
          return `🔴 ${getServerName(serverById)} - 离线 | 原因：${result.error}`
        }
        return formatDetailedStatus(result.data, serverById, config.showIpInDetail)
      }

      // 作为IP地址处理
      const host = String(target)
      const defaultPort = 25565
      const { host: parsedHost, port: parsedPort } = parseServerAddress(host, defaultPort)

      const tempServer: ServerConfig = {
        name: parsedHost,
        address: `${parsedHost}:${parsedPort}`,
        serverType: 'java',
        timeout: 5.0,
      }

      const result = await queryServerStatus(tempServer)
      if (!result.success) {
        return `🔴 服务器 - 离线 | 原因：${result.error}`
      }

      return formatDetailedStatus(result.data, tempServer, config.showIpInDetail)
    })
}
