// Teste de contrato (T06): valida os mesmos exemplos de schemas/examples/ que o pytest.
// Os dois lados devem aceitar e rejeitar exatamente os mesmos arquivos.
import { assert, assertEquals } from "@std/assert";
import {
  fieldValidationSchema,
  observationSchema,
  snapshotManifestSchema,
} from "./schemas.ts";

const EXAMPLES = new URL("../../../schemas/examples/", import.meta.url);

const KINDS = {
  observation: observationSchema,
  validation: fieldValidationSchema,
  manifest: snapshotManifestSchema,
} as const;

for (const [kind, schema] of Object.entries(KINDS)) {
  const dir = new URL(`${kind}/`, EXAMPLES);
  const files = [...Deno.readDirSync(dir)]
    .filter((e) => e.isFile && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  Deno.test(`${kind}: há exemplos válidos e inválidos`, () => {
    assert(files.some((n) => n.startsWith("valid-")));
    assert(files.some((n) => n.startsWith("invalid-")));
  });

  for (const name of files) {
    Deno.test(`${kind}/${name}`, () => {
      const data = JSON.parse(Deno.readTextFileSync(new URL(name, dir)));
      const result = schema.safeParse(data);
      if (name.startsWith("valid-")) {
        assert(
          result.success,
          `deveria aceitar: ${JSON.stringify(result.error?.issues)}`,
        );
      } else {
        assert(name.startsWith("invalid-"), `nome fora do padrão: ${name}`);
        assertEquals(result.success, false, "deveria rejeitar");
      }
    });
  }
}
