# Cobrinha.io

Jogo multiplayer em Node.js, Express e Socket.IO.

## Executar localmente

```bash
npm install
cp .env.example .env
npm start
```

O servidor fica disponível em http://localhost:3000.

## Configuração de segurança

Defina no arquivo local `.env` (não versionado) ou nas variáveis de ambiente:

- `ADMIN_PASSWORD`: senha forte para entrar em `/admin.html`.
- `ADMIN_SECRET`: segredo aleatório longo usado para assinar tokens do painel (recomendado: pelo menos 32 bytes aleatórios).

Sem essas duas variáveis, o painel administrativo permanece desativado. Não existe senha padrão.

## Socket.IO

Cliente e servidor usam WebSocket diretamente, sem fallback para HTTP long-polling. Os inputs são limitados a 20 atualizações por segundo, alinhados ao tick do servidor.

## Atenção antes de publicar na Vercel

A Vercel oferece suporte a WebSockets em Functions, mas cada conexão fica presa a uma instância; conexões diferentes podem cair em instâncias diferentes. Este jogo ainda mantém jogadores, comida, ranking, bans e o loop de simulação na memória do processo Node.js. Portanto, **o backend multiplayer ainda não está pronto para ser executado em múltiplas instâncias da Vercel**: jogadores podem acabar em mundos separados.

Para produção na Vercel, falta implementar um coordenador compartilhado de jogo (estado autoritativo, presença, entradas e broadcast entre instâncias) com Redis ou serviço equivalente, além de reconexão e restauração de estado quando a Function atingir a duração máxima. Até essa etapa, execute o backend como processo Node.js persistente em uma única instância. Não configure um deploy do backend Vercel antes dessa etapa.

## Correções desta revisão

- Removida senha administrativa padrão e leitura de arquivo de senha local.
- Tokens administrativos assinados, verificáveis entre instâncias e com expiração de uma hora.
- Limitação básica de tentativas de login.
- Validação de ângulo, cores, skin, nome e parâmetros das ações administrativas.
- Corrigida colisão com o próprio corpo e o desbanimento que removia o IP duas vezes.
- Removido risco de XSS no ranking e no painel administrativo.
- Corrigido posicionamento de comida em coordenadas zero.
- Reduzido o tráfego de input do cliente para 20 atualizações por segundo.
