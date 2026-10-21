# Design System MCP

Servidor [Model Context Protocol](https://modelcontextprotocol.io) que dá a agentes de IA
(Claude Code, Claude Desktop, Cursor etc.) acesso ao design system: quais componentes existem,
suas props, os tokens e uma **validação automática** do JSX gerado.

O problema que resolve: quando se pede a um agente "monte a tela de cancelamento de frete",
ele inventa componentes e props que não existem. Com este servidor, o agente
**busca → lê a documentação → gera → valida → corrige**, usando o design system real.

```
 agente ──search_components("confirmar cancelamento")──▶  [Modal, Button]
        ──get_component("Modal")──────────────────────▶  props, exemplos, a11y
        ──(gera o JSX)
        ──validate_jsx(código)────────────────────────▶  "Prop obrigatória ausente: onClose"
        ──(corrige e entrega)
```

## Ferramentas

| Ferramenta | Para quê |
|---|---|
| `search_components` | Descobrir componentes a partir de uma necessidade em português |
| `get_component` | Props (tipo, obrigatória, padrão), exemplos e regras de acessibilidade |
| `get_design_tokens` | Cores, espaçamentos, raios e tipografia |
| `validate_jsx` | Componentes inexistentes, props desconhecidas/ausentes, valores inválidos, diretrizes |

O catálogo de exemplo (`catalog/components.json`) é de um design system fictício, o "Cacau DS".
Aponte `DS_CATALOG_PATH` para o catálogo do seu design system real.

## Como rodar

```bash
npm install
npm test            # testes da lógica do catálogo
npm run inspect     # abre o MCP Inspector para chamar as ferramentas na mão
```

### Usar no Claude Code

```bash
claude mcp add design-system -- npx tsx /caminho/para/design-system-mcp/src/index.ts
```

Depois peça, por exemplo: *"Usando o design system, crie a tela de detalhes de um frete com
status, valores e um botão para cancelar com confirmação."*

### Usar no Claude Desktop

Em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "design-system": {
      "command": "npx",
      "args": ["tsx", "/caminho/para/design-system-mcp/src/index.ts"]
    }
  }
}
```

## Decisões de design

- **Lógica separada do protocolo.** `src/catalog.ts` não sabe nada de MCP: é testável
  e pode virar um lint de CI no futuro. `src/index.ts` só traduz para ferramentas.
- **Descrições de ferramenta escritas como documentação de SDK.** Elas dizem *quando* usar
  cada ferramenta ("use ANTES de escrever UI", "use DEPOIS de gerar código"). Isso guia o
  fluxo do agente sem precisar de prompt extra.
- **Erros que ensinam.** `get_component("Buton")` responde "Você quis dizer Button?",
  e o agente se corrige sozinho.
- **Logs em stderr.** No transporte stdio, stdout é o canal do protocolo.

## Roadmap

### Fase A — entender
- [ ] Rodar os testes e o MCP Inspector
- [ ] Conectar no Claude Code e gerar 3 telas diferentes
- [ ] Ler a especificação de tools do MCP e comparar com o código

### Fase B — dados reais
- [ ] `TODO(estudo)`: gerar o `components.json` a partir do Storybook
      (`index.json` + `argTypes` dos componentes) em vez de manter na mão
- [ ] Expor a documentação MDX dos componentes como *resources* do MCP
- [ ] Busca semântica com embeddings (reaproveite o projeto `docs-assistant-rag`)

### Fase C — validação mais forte
- [ ] Trocar o scanner de tags por um parser real (`@babel/parser` ou `typescript`)
- [ ] Checagem de a11y: botão só com ícone precisa de `aria-label`
- [ ] Verificar uso de cores fixas (`#hex`) em vez de tokens

### Fase D — medir
- [ ] Criar 20 pedidos de tela e medir com o `llm-evals-lab`:
      % de telas que passam no `validate_jsx` **com** e **sem** o servidor MCP.
      Esse número vai no topo deste README.
