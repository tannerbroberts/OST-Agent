/**
 * Walk every `expect(actual).matcher(expected)` call in a TypeScript source
 * file and report the ones where `actual` and `expected` trace back to the
 * same local module, constant, or generator — the shape that cannot disagree,
 * because both sides were computed from the same place.
 *
 * Read-only. This produces a list, not a repair; see
 * `Census every check whose expected and actual sides are drawn from the same
 * source` in the vault for why that is the whole point of this pass.
 *
 * **What "same source" means here, precisely.** For each side of an
 * assertion, collect the free identifiers it references and resolve each one,
 * within the same file, to either:
 *   - a named import from a *relative* module specifier (`../../scripts/x.js`),
 *     identified by `<module>#<importedName>`; or
 *   - a top-level `const`/`function` declaration, identified by
 *     `<file>#<name>@<line>` — its own declaration site, not what it computes.
 * Two sides "share a source" when this resolution produces the same id on
 * both. Bare imports (`vitest`, `node:fs`, npm packages) are deliberately
 * excluded: every file imports `fs`, so tracking it would flag nearly every
 * assertion in the suite and say nothing. That scoping is a real limit, not
 * an oversight — see the caveats in the vault node above. In particular, two
 * files that each derive the same value independently (no import edge between
 * them) look identical to this census and are never flagged; that is the
 * exact shape of the bug that motivated it, and `provenance-census.test.ts`
 * pins the false negative so it stays a known limit rather than a surprise.
 */
import ts from "typescript";

export interface CensusFinding {
  file: string;
  line: number;
  matcher: string;
  sharedOrigin: string;
  actualText: string;
  expectedText: string;
}

interface Origin {
  id: string;
}

type SymbolTable = Map<string, Origin>;

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

/** Top-level imports and declarations this file makes resolvable, by local name. */
function buildSymbolTable(sourceFile: ts.SourceFile): SymbolTable {
  const table: SymbolTable = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleSpecifier = statement.moduleSpecifier.text;
      if (!isRelativeSpecifier(moduleSpecifier)) continue;
      const bindings = statement.importClause;
      if (!bindings) continue;
      if (bindings.name) {
        table.set(bindings.name.text, { id: `${moduleSpecifier}#default` });
      }
      const named = bindings.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const spec of named.elements) {
          const importedName = (spec.propertyName ?? spec.name).text;
          table.set(spec.name.text, { id: `${moduleSpecifier}#${importedName}` });
        }
      } else if (named && ts.isNamespaceImport(named)) {
        table.set(named.name.text, { id: `${moduleSpecifier}#*` });
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const line = sourceFile.getLineAndCharacterOfPosition(decl.getStart()).line + 1;
          table.set(decl.name.text, { id: `${sourceFile.fileName}#${decl.name.text}@${line}` });
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
      table.set(statement.name.text, { id: `${sourceFile.fileName}#${statement.name.text}@${line}` });
    }
  }

  return table;
}

/** Every identifier referenced anywhere inside `node`, including nested calls. */
function freeIdentifiers(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      // `ns.member` resolves through `ns`; the property name is not itself an
      // identifier reference in this file's symbol table.
      visit(n.expression);
      return;
    }
    if (ts.isIdentifier(n)) {
      names.add(n.text);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

function originsOf(node: ts.Node, table: SymbolTable): Set<string> {
  const origins = new Set<string>();
  for (const name of freeIdentifiers(node)) {
    const origin = table.get(name);
    if (origin) origins.add(origin.id);
  }
  return origins;
}

/** `expect(<actual>)` — the call this `matcher` call sits on. */
function expectCallOf(matcherCall: ts.CallExpression): ts.CallExpression | null {
  if (!ts.isPropertyAccessExpression(matcherCall.expression)) return null;
  const receiver = matcherCall.expression.expression;
  if (!ts.isCallExpression(receiver)) return null;
  if (!ts.isIdentifier(receiver.expression) || receiver.expression.text !== "expect") return null;
  return receiver;
}

export function censusSource(fileName: string, text: string): CensusFinding[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const table = buildSymbolTable(sourceFile);
  const findings: CensusFinding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expectCall = expectCallOf(node);
      const actualArg = expectCall?.arguments[0];
      const expectedArg = node.arguments[0];
      if (expectCall && actualArg && expectedArg && ts.isPropertyAccessExpression(node.expression)) {
        const actualOrigins = originsOf(actualArg, table);
        const expectedOrigins = originsOf(expectedArg, table);
        const shared = [...actualOrigins].find((id) => expectedOrigins.has(id));
        if (shared) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          findings.push({
            file: fileName,
            line,
            matcher: node.expression.name.text,
            sharedOrigin: shared,
            actualText: actualArg.getText(sourceFile),
            expectedText: expectedArg.getText(sourceFile),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return findings;
}
