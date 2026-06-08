// Sobe painel (next start) + worker (tsx) no mesmo container.
// Se qualquer um dos dois morrer, derruba o processo todo -> o Docker reinicia
// o container (restart: unless-stopped). Encaminha SIGTERM/SIGINT pros filhos.
import { spawn } from 'node:child_process'

const procs = [
  { name: 'painel', cmd: 'npm', args: ['run', 'start'] },
  { name: 'worker', cmd: 'npm', args: ['--prefix', 'backend/worker', 'run', 'start'] },
]

const children = procs.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  child.on('exit', (code, signal) => {
    console.error(`[start] ${name} saiu (code=${code} signal=${signal}) — derrubando container`)
    shutdown(code ?? 1)
  })
  return child
})

let down = false
function shutdown(code) {
  if (down) return
  down = true
  for (const c of children) c.kill('SIGTERM')
  // da um tempo pro worker salvar a sessao do WhatsApp antes de sair
  setTimeout(() => process.exit(code), 5000)
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
