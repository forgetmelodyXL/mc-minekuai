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
    minekuaiApiUrl: Schema.string().description('麦块API地址').default('https://minekuai.com/api/client'),
    apiKey: Schema.string().description('麦块API密钥').role('secret'),
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
      minekuaiInstanceId: Schema.string().description('麦块实例ID(可选)'),
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

  async function minekuaiApiRequest(instanceId: string, operation: string, maxRetries = 3) {
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

    let lastError: Error
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ctx.http.post(url, body, { headers })
        ctx.logger.info(`麦块API请求成功: 实例 ${instanceId} 操作 ${operation} (第${attempt}次尝试)`)
        return response
      } catch (error) {
        lastError = error
        ctx.logger.warn(`麦块API请求失败 (第${attempt}次尝试):`, error)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    throw new Error(`麦块API请求失败，已重试${maxRetries}次: ${lastError.message}`)
  }

  ctx.guild()
    .command('mc/开服 <id:number>', '启动麦块服务器')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：开服 1'
      const servers = config.servers || []
      const server = servers[id - 1]
      if (!server) return `❌ 未找到ID为 ${id} 的服务器，请使用"查服"查看服务器列表`
      if (!server.minekuaiInstanceId) return `${server.name} 未配置麦块实例ID`

      try {
        await minekuaiApiRequest(server.minekuaiInstanceId, 'start', 3)
        return `✅ 已发送启动指令到 ${server.name} (ID: ${id})`
      } catch (error) {
        return `❌ 启动服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/重启 <id:number>', '重启麦块服务器')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：重启 1'
      const servers = config.servers || []
      const server = servers[id - 1]
      if (!server) return `❌ 未找到ID为 ${id} 的服务器，请使用"查服"查看服务器列表`
      if (!server.minekuaiInstanceId) return `${server.name} 未配置麦块实例ID`

      try {
        await minekuaiApiRequest(server.minekuaiInstanceId, 'restart', 3)
        return `✅ ${server.name} 重启指令已发送完成，请稍后检查服务器状态`
      } catch (error) {
        return `❌ 重启服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/强制重启 <id:number>', '强制重启麦块服务器')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：强制重启 1'
      const servers = config.servers || []
      const server = servers[id - 1]
      if (!server) return `❌ 未找到ID为 ${id} 的服务器，请使用"查服"查看服务器列表`
      if (!server.minekuaiInstanceId) return `${server.name} 未配置麦块实例ID`

      try {
        await minekuaiApiRequest(server.minekuaiInstanceId, 'stop', 3)
        await new Promise(resolve => setTimeout(resolve, 1000))
        await minekuaiApiRequest(server.minekuaiInstanceId, 'kill', 3)
        await new Promise(resolve => setTimeout(resolve, 3000))
        await minekuaiApiRequest(server.minekuaiInstanceId, 'start', 3)

        return `✅ ${server.name} 强制重启指令已发送完成，请稍后检查服务器状态`
      } catch (error) {
        return `❌ 强制重启服务器失败: ${error.message}`
      }
    })

  ctx.guild()
    .command('mc/资源 <id:number>', '查看麦块服务器资源使用情况')
    .action(async ({ session }, id) => {
      if (id === undefined) return '请提供服务器ID，例如：资源 1'
      const servers = config.servers || []
      const server = servers[id - 1]
      if (!server) return `❌ 未找到ID为 ${id} 的服务器，请使用"查服"查看服务器列表`
      if (!server.minekuaiInstanceId) return `${server.name} 未配置麦块实例ID`

      if (!config.apiKey) {
        return '❌ 未配置麦块API密钥，请在插件配置中设置 apiKey'
      }

      try {
        const baseUrl = config.minekuaiApiUrl.replace(/\/+$/, '')
        const url = `${baseUrl}/servers/${server.minekuaiInstanceId}/resources`
        const headers = {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }

        const response = await ctx.http.get(url, { headers })
        ctx.logger.info(`麦块API资源查询成功: 实例 ${server.minekuaiInstanceId}`)

        const attributes = response.attributes
        const resources = attributes.resources
        const currentState = attributes.current_state
        const isSuspended = attributes.is_suspended

        const memoryUsed = resources.memory_bytes / 1024 / 1024 / 1024
        const cpuUsage = resources.cpu_absolute
        const diskUsed = resources.disk_bytes / 1024 / 1024 / 1024
        const uptime = resources.uptime

        const uptimeDays = Math.floor(uptime / 86400)
        const uptimeHours = Math.floor((uptime % 86400) / 3600)
        const uptimeMinutes = Math.floor((uptime % 3600) / 60)
        const uptimeSeconds = uptime % 60
        const formattedUptime = `${uptimeDays}天 ${uptimeHours}小时 ${uptimeMinutes}分钟 ${uptimeSeconds}秒`

        let message = `📊 ${server.name} 资源使用情况\n`
        message += `📋 状态: ${currentState === 'running' ? '运行中' : currentState}\n`
        message += `🔄 暂停: ${isSuspended ? '是' : '否'}\n`
        message += `🖥️ CPU: ${cpuUsage.toFixed(2)}%\n`
        message += `💾 内存: ${memoryUsed.toFixed(2)}GB\n`
        message += `💿 磁盘: ${diskUsed.toFixed(2)}GB\n`
        message += `📡 网络接收: ${(resources.network_rx_bytes / 1024 / 1024).toFixed(2)}MB\n`
        message += `📡 网络发送: ${(resources.network_tx_bytes / 1024 / 1024).toFixed(2)}MB\n`
        message += `⏱️ 运行时间: ${formattedUptime}\n`
        message += `⏰ 查询时间: ${new Date().toLocaleString('zh-CN')}`

        return message
      } catch (error) {
        return `❌ 查询服务器资源使用情况失败: ${error.message}`
      }
    })

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
