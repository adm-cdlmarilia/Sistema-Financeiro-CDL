import { AlertTriangle } from 'lucide-react'

/** Mostrada quando o .env não foi encontrado — no lugar da antiga tela branca. */
export default function ConfigError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page p-6">
      <div className="w-full max-w-xl rounded-card border border-line bg-surface p-8 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-negative-soft text-negative">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold">Falta configurar a conexão</h1>
        </div>

        <p className="mt-4 text-sm text-ink-soft">
          O arquivo <code className="rounded bg-surface-page px-1.5 py-0.5">.env</code> não foi
          encontrado ou está incompleto. Ele precisa ficar na raiz do projeto, ao lado do{' '}
          <code className="rounded bg-surface-page px-1.5 py-0.5">package.json</code>, com estas
          duas linhas:
        </p>

        <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-page p-4 text-xs">
{`VITE_SUPABASE_URL=https://seuprojeto.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...`}
        </pre>

        <div className="mt-5 space-y-2 text-sm text-ink-soft">
          <p className="font-medium text-ink">Se o arquivo já existe e mesmo assim aparece isto:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              No Windows, confira se o nome não ficou <code>.env.txt</code>. O Explorer esconde a
              extensão — ative “Extensões de nomes de arquivos” na aba Exibir.
            </li>
            <li>
              Pare o servidor (Ctrl+C) e rode <code>npm run dev</code> de novo. O Vite só lê o{' '}
              <code>.env</code> ao iniciar.
            </li>
            <li>Os nomes das variáveis precisam começar com <code>VITE_</code>.</li>
            <li>Não use aspas nem espaços em volta do sinal de igual.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
