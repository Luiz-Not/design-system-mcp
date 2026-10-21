/**
 * Lógica pura do catálogo do design system: busca, detalhes e validação de JSX.
 * Sem dependência do MCP, para ser testável e reutilizável (ex.: num lint de CI).
 */

import { readFileSync } from "node:fs";

export type Prop = {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
};

export type Component = {
  name: string;
  category: string;
  description: string;
  keywords: string[];
  props: Prop[];
  examples: string[];
  a11y?: string;
};

export type Catalog = {
  name: string;
  package: string;
  components: Component[];
  tokens: Record<string, unknown>;
};

export type Issue = {
  severity: "error" | "warning";
  component: string;
  message: string;
};

export function loadCatalog(path: string): Catalog {
  return JSON.parse(readFileSync(path, "utf-8")) as Catalog;
}

/** minúsculas e sem acentos, para "botao" encontrar "botão" */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function suggest(catalog: Catalog, name: string): string | undefined {
  const target = normalize(name);
  let best: { name: string; dist: number } | undefined;
  for (const c of catalog.components) {
    const dist = levenshtein(target, normalize(c.name));
    if (!best || dist < best.dist) best = { name: c.name, dist };
  }
  return best && best.dist <= Math.max(2, Math.floor(name.length / 3)) ? best.name : undefined;
}

/**
 * Busca por palavras-chave com pontuação simples.
 * TODO(estudo): trocar por busca semântica com embeddings (reaproveite o projeto de RAG)
 * e comparar a qualidade com evals.
 */
export function searchComponents(catalog: Catalog, query: string, limit = 5): Component[] {
  const terms = normalize(query).split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  const scored = catalog.components.map((c) => {
    const name = normalize(c.name);
    const keywords = c.keywords.map(normalize);
    const desc = normalize(`${c.category} ${c.description}`);
    let score = 0;
    for (const t of terms) {
      if (name === t) score += 10;
      else if (name.includes(t)) score += 5;
      if (keywords.some((k) => k === t)) score += 4;
      else if (keywords.some((k) => k.includes(t) || t.includes(k))) score += 2;
      if (desc.includes(t)) score += 1;
    }
    return { c, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.c);
}

export function getComponent(catalog: Catalog, name: string): Component | undefined {
  const target = normalize(name);
  return catalog.components.find((c) => normalize(c.name) === target);
}

/** Valores literais permitidos de um tipo união, ex.: "'sm' | 'md'" -> ["sm", "md"] */
export function literalOptions(type: string): string[] | undefined {
  const parts = type.split("|").map((p) => p.trim());
  if (parts.length < 2 || !parts.every((p) => /^'[^']*'$/.test(p))) return undefined;
  return parts.map((p) => p.slice(1, -1));
}

type ParsedTag = { name: string; attrs: Map<string, string | null>; hasSpread: boolean };

/**
 * Extrai as tags JSX de abertura com nome em PascalCase.
 * Scanner simples (não é um parser completo): respeita strings e chaves aninhadas,
 * e também encontra tags dentro de props, ex.: footer={<Button />}.
 */
export function parseTags(code: string): ParsedTag[] {
  const tags: ParsedTag[] = [];
  const startRe = /<([A-Z][A-Za-z0-9]*)/g;
  for (const match of code.matchAll(startRe)) {
    const name = match[1];
    let i = match.index! + match[0].length;
    let depth = 0;
    let quote: string | null = null;
    let body = "";
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      } else if (ch === ">" && depth === 0) {
        break;
      }
      body += ch;
    }
    tags.push({ name, ...parseAttrs(body.replace(/\/$/, "")) });
  }
  return tags;
}

/** Lê os atributos no nível de topo do corpo da tag. */
function parseAttrs(body: string): { attrs: Map<string, string | null>; hasSpread: boolean } {
  const attrs = new Map<string, string | null>();
  let hasSpread = false;
  let i = 0;
  const skipExpr = () => {
    // assume body[i] === "{"; avança até a chave correspondente
    let depth = 0;
    let quote: string | null = null;
    const start = i;
    for (; i < body.length; i++) {
      const ch = body[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        i++;
        break;
      }
    }
    return body.slice(start, i);
  };

  while (i < body.length) {
    const ch = body[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "{") {
      if (/^\{\s*\.\.\./.test(skipExpr())) hasSpread = true;
    } else {
      const nameMatch = /^[A-Za-z][\w-]*/.exec(body.slice(i));
      if (!nameMatch) {
        i++;
        continue;
      }
      const attr = nameMatch[0];
      i += attr.length;
      let value: string | null = null;
      if (body[i] === "=") {
        i++;
        if (body[i] === '"' || body[i] === "'") {
          const end = body.indexOf(body[i], i + 1);
          value = body.slice(i + 1, end === -1 ? undefined : end);
          i = end === -1 ? body.length : end + 1;
        } else if (body[i] === "{") {
          skipExpr();
        }
      }
      attrs.set(attr, value);
    }
  }
  return { attrs, hasSpread };
}

const ALWAYS_ALLOWED = new Set(["children", "key", "ref", "id", "aria-label", "data-testid"]);

export function validateJsx(catalog: Catalog, code: string): Issue[] {
  const issues: Issue[] = [];
  for (const tag of parseTags(code)) {
    const component = getComponent(catalog, tag.name);
    if (!component) {
      const hint = suggest(catalog, tag.name);
      issues.push({
        severity: "error",
        component: tag.name,
        message: `Componente não existe no ${catalog.name}.` + (hint ? ` Você quis dizer <${hint}>?` : ""),
      });
      continue;
    }

    if (component.name === "Toast") {
      issues.push({
        severity: "error",
        component: "Toast",
        message: "Toast não é renderizado diretamente; use o hook useToast().",
      });
      continue;
    }

    const known = new Map(component.props.map((p) => [p.name, p]));
    for (const [attr, value] of tag.attrs) {
      if (ALWAYS_ALLOWED.has(attr) || attr.startsWith("aria-") || attr.startsWith("data-")) continue;
      if (attr === "className" || attr === "style") {
        issues.push({
          severity: "warning",
          component: component.name,
          message: `Evite ${attr}: use as props e os tokens do design system.`,
        });
        continue;
      }
      const prop = known.get(attr);
      if (!prop) {
        issues.push({ severity: "error", component: component.name, message: `Prop desconhecida: ${attr}.` });
        continue;
      }
      const options = literalOptions(prop.type);
      if (options && value !== null && !options.includes(value)) {
        issues.push({
          severity: "error",
          component: component.name,
          message: `Valor inválido para ${attr}: "${value}". Opções: ${options.join(", ")}.`,
        });
      }
    }

    if (!tag.hasSpread) {
      for (const p of component.props) {
        if (p.required && !tag.attrs.has(p.name)) {
          issues.push({
            severity: "error",
            component: component.name,
            message: `Prop obrigatória ausente: ${p.name}.`,
          });
        }
      }
    }

    // TODO(estudo): checar a11y de botão só com ícone (sem texto e sem aria-label).
  }

  const primaries = parseTags(code).filter(
    (t) => t.name === "Button" && (t.attrs.get("variant") ?? "primary") === "primary",
  ).length;
  if (primaries > 1) {
    issues.push({
      severity: "warning",
      component: "Button",
      message: `Há ${primaries} botões primary; a diretriz é no máximo um por tela.`,
    });
  }
  return issues;
}
