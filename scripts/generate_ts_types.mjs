// Gera os tipos TypeScript a partir do JSON Schema em `schemas/` (T06).
// Uso: npm run gen:types   (na raiz do repositório)
// Saída: supabase/functions/_shared/contracts.gen.ts (não edite à mão).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "schemas", name), "utf8"));

const roots = {
  Observation: load("observation.schema.json"),
  FieldValidation: load("validation.schema.json"),
  SnapshotManifest: load("manifest.schema.json"),
};

// Junta os três schemas num só para que enums compartilhados (Metric, Unit...)
// sejam declarados uma única vez.
const defs = {};
for (const [name, schema] of Object.entries(roots)) {
  const { $defs = {}, ...rest } = schema;
  for (const [key, value] of Object.entries($defs)) {
    const previous = defs[key];
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) {
      throw new Error(`Definição "${key}" difere entre schemas`);
    }
    defs[key] = value;
  }
  defs[name] = rest;
}

const combined = {
  title: "Contracts",
  type: "object",
  additionalProperties: false,
  $defs: defs,
  properties: Object.fromEntries(
    Object.keys(roots).map((name) => [name, { $ref: `#/$defs/${name}` }]),
  ),
};

const banner = `/* eslint-disable */
// ARQUIVO GERADO por scripts/generate_ts_types.mjs a partir de schemas/*.schema.json.
// Não edite à mão. Para atualizar: python scripts/export_schemas.py && npm run gen:types
`;

const ts = await compile(combined, "Contracts", {
  bannerComment: banner,
  additionalProperties: false,
  unreachableDefinitions: true,
  format: false,
});
writeFileSync(join(root, "supabase/functions/_shared/contracts.gen.ts"), ts);
console.log("gravado supabase/functions/_shared/contracts.gen.ts");
