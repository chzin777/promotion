import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { listGroups, sendText, checkConnection } from './whatsapp.js'
import { loadItems, enrichItem, formatMessage } from './products.js'
import { startClient } from './wa.js'

const cmd = process.argv[2]

async function main(): Promise<void> {
  // preview e offline (nao precisa conectar WhatsApp)
  if (cmd === 'preview') {
    const items = loadItems()
    console.log(`${items.length} produto(s) na fila. Buscando titulo/foto...\n`)
    for (let i = 0; i < items.length; i++) {
      const it = await enrichItem(items[i])
      console.log(`----- ${i + 1} -----`)
      if (it.image) console.log(`🖼  ${it.image}`)
      console.log(formatMessage(it))
      console.log()
    }
    return
  }

  if (cmd === 'link') {
    // so conecta (mostra QR). Espera a sessao gravar no disco antes de fechar.
    const c = await startClient()
    await new Promise((r) => setTimeout(r, 4000))
    await c.destroy()
    console.log('Sessao salva. Pode rodar `npm start`.')
    process.exit(0)
  }

  if (cmd === 'logout') {
    // deleta a sessao do disco para deslogar
    try {
      const sessionPath = config.sessionDir
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true })
        console.log(`✅ Sessao deletada: ${sessionPath}`)
        console.log('Deslogado com sucesso. Na proxima execucao, escaneie um novo QR.')
      } else {
        console.log('Sessao nao encontrada. Ja esta deslogado.')
      }
    } catch (e) {
      console.error('Erro ao deslogar:', (e as Error).message)
      process.exit(1)
    }
    process.exit(0)
  }

  const client = await startClient()
  const finish = async () => { await client.destroy().catch(() => {}); process.exit(0) }
  switch (cmd) {
    case 'status': {
      await checkConnection(client)
      break
    }
    case 'groups': {
      const groups = await listGroups(client)
      if (!groups.length) {
        console.log('Nenhum grupo encontrado.')
        break
      }
      console.log('id                               | Nome')
      console.log('---------------------------------+----------------------')
      for (const g of groups) console.log(`${g.id}  |  ${g.subject ?? ''}`)
      console.log('\nCopie o id (...@g.us) do grupo pro WHATSAPP_GROUP_ID no .env')
      break
    }
    case 'test': {
      await sendText(client, '✅ Teste worker promotion — conexao OK.')
      console.log('Enviado teste pro grupo', config.groupId)
      break
    }
    default:
      console.log('Comandos: link | logout | status | groups | preview | test')
  }
  await finish()
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
