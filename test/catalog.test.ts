import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  getComponent,
  literalOptions,
  loadCatalog,
  parseTags,
  searchComponents,
  suggest,
  validateJsx,
} from "../src/catalog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = loadCatalog(resolve(here, "../catalog/components.json"));

const messages = (code: string) => validateJsx(catalog, code).map((i) => i.message);

test("busca por intenção, sem acento e por palavra-chave", () => {
  assert.equal(searchComponents(catalog, "botao")[0].name, "Button");
  assert.equal(searchComponents(catalog, "tabela de fretes")[0].name, "DataTable");
  assert.equal(searchComponents(catalog, "confirmação")[0].name, "Modal");
  assert.deepEqual(searchComponents(catalog, "xyzw"), []);
});

test("get_component ignora caixa e sugere nomes parecidos", () => {
  assert.equal(getComponent(catalog, "button")?.name, "Button");
  assert.equal(getComponent(catalog, "Buton"), undefined);
  assert.equal(suggest(catalog, "Buton"), "Button");
  assert.equal(suggest(catalog, "Textfield"), "TextField");
});

test("literalOptions lê uniões de string", () => {
  assert.deepEqual(literalOptions("'sm' | 'md' | 'lg'"), ["sm", "md", "lg"]);
  assert.equal(literalOptions("boolean"), undefined);
  assert.equal(literalOptions("string"), undefined);
});

test("parseTags lida com expressões aninhadas e tags dentro de props", () => {
  const tags = parseTags(
    `<Select label="UF" options={[{ value: "mg", label: "MG" }]} value={uf} onChange={(v) => set(v)} />
     <Modal open={o} onClose={c} title="X" footer={<Button variant="danger">Ok</Button>}>t</Modal>`,
  );
  assert.deepEqual(tags.map((t) => t.name), ["Select", "Modal", "Button"]);
  assert.deepEqual([...tags[0].attrs.keys()], ["label", "options", "value", "onChange"]);
  assert.equal(tags[2].attrs.get("variant"), "danger");
});

test("JSX válido não gera problemas", () => {
  const code = `
    <Card title="Resumo" footer={<Stack direction="row" gap="sm"><Button variant="secondary">Voltar</Button><Button>Confirmar</Button></Stack>}>
      <TextField label="E-mail" type="email" value={email} onChange={setEmail} />
      <Badge tone="success">Entregue</Badge>
    </Card>`;
  assert.deepEqual(validateJsx(catalog, code), []);
});

test("detecta componente inexistente com sugestão", () => {
  assert.match(messages("<Buton>Oi</Buton>")[0], /Você quis dizer <Button>/);
});

test("detecta prop obrigatória ausente, prop desconhecida e valor inválido", () => {
  const msgs = messages(`<TextField label="Nome" value={v} color="red" type="date" />`);
  assert.ok(msgs.includes("Prop obrigatória ausente: onChange."));
  assert.ok(msgs.includes("Prop desconhecida: color."));
  assert.ok(msgs.some((m) => m.startsWith('Valor inválido para type: "date"')));
});

test("spread de props desliga a checagem de obrigatórias", () => {
  assert.deepEqual(validateJsx(catalog, `<TextField {...field} label="Nome" />`), []);
});

test("diretrizes: Toast via hook, className e mais de um primary", () => {
  assert.match(messages(`<Toast tone="success" message="ok" />`)[0], /useToast/);
  assert.match(messages(`<Badge className="x">a</Badge>`)[0], /Evite className/);
  assert.ok(messages(`<Button>A</Button><Button variant="primary">B</Button>`).some((m) => m.includes("2 botões primary")));
});
