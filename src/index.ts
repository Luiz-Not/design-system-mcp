#!/usr/bin/env node
/**
 * Servidor MCP do design system.
 *
 * Ferramentas expostas ao agente:
 *  - search_components  busca componentes por intenção ("botão de excluir", "tabela")
 *  - get_component      props, exemplos e regras de acessibilidade de um componente
 *  - get_design_tokens  cores, espaçamentos, raios e tipografia
 *  - validate_jsx       confere se um trecho de JSX respeita o design system
 *
 * A qualidade das descrições abaixo importa tanto quanto o código: é com elas
 * que o modelo decide QUAL ferramenta chamar e COMO. Trate-as como documentação
 * de SDK para parceiros.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { getComponent, loadCatalog, searchComponents, suggest, validateJsx } from "./catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = process.env.DS_CATALOG_PATH ?? resolve(here, "../catalog/components.json");
const catalog = loadCatalog(catalogPath);

const server = new McpServer({ name: "design-system", version: "0.1.0" });

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

server.registerTool(
  "search_components",
  {
    description:
      `Busca componentes do design system ${catalog.name} (pacote ${catalog.package}) a partir de uma ` +
      "necessidade de interface, em português. Use ANTES de escrever qualquer UI, para descobrir quais " +
      "componentes existem. Retorna nome, categoria e descrição de até `limit` componentes.",
    inputSchema: z.object({
      query: z.string().min(2).describe('Necessidade de UI, ex.: "confirmar exclusão", "lista de fretes"'),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  },
  async ({ query, limit }) => {
    const results = searchComponents(catalog, query, limit);
    if (results.length === 0) {
      return text(
        `Nenhum componente encontrado para "${query}". Categorias disponíveis: ` +
          [...new Set(catalog.components.map((c) => c.category))].join(", "),
      );
    }
    return text(results.map(({ name, category, description }) => ({ name, category, description })));
  },
);

server.registerTool(
  "get_component",
  {
    description:
      "Retorna a documentação completa de um componente: props (tipo, obrigatoriedade, padrão), " +
      "exemplos de uso e regras de acessibilidade. Use antes de usar um componente pela primeira vez.",
    inputSchema: z.object({
      name: z.string().describe('Nome exato do componente, ex.: "Button"'),
    }),
  },
  async ({ name }) => {
    const component = getComponent(catalog, name);
    if (!component) {
      const hint = suggest(catalog, name);
      return {
        ...text(`Componente "${name}" não existe.` + (hint ? ` Você quis dizer "${hint}"?` : "")),
        isError: true,
      };
    }
    return text({ import: `import { ${component.name} } from "${catalog.package}";`, ...component });
  },
);

server.registerTool(
  "get_design_tokens",
  {
    description:
      "Retorna os design tokens (cores, espaçamentos, raios, tipografia). Use os nomes dos tokens " +
      "em vez de valores fixos ao estilizar.",
    inputSchema: z.object({
      group: z.enum(["color", "spacing", "radius", "font"]).optional().describe("Omita para todos"),
    }),
  },
  async ({ group }) => text(group ? { [group]: catalog.tokens[group] } : catalog.tokens),
);

server.registerTool(
  "validate_jsx",
  {
    description:
      "Valida um trecho de JSX contra o design system: componentes inexistentes, props desconhecidas " +
      "ou obrigatórias ausentes, valores inválidos e violações de diretrizes. Use DEPOIS de gerar código " +
      "e corrija todos os erros antes de entregar.",
    inputSchema: z.object({
      code: z.string().min(1).describe("Código JSX/TSX a validar"),
    }),
  },
  async ({ code }) => {
    const issues = validateJsx(catalog, code);
    if (issues.length === 0) return text("Nenhum problema encontrado.");
    const errors = issues.filter((i) => i.severity === "error").length;
    return text({ summary: `${errors} erro(s), ${issues.length - errors} aviso(s)`, issues });
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
  // stdout é o canal do protocolo: logs vão para stderr
  console.error(`design-system MCP pronto (${catalog.components.length} componentes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
